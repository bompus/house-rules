import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  SEAT_AGENT,
  deniedFiles,
  openCodeEnv,
  rootCovers,
  runArgs,
  sandboxArgs,
  userReadDenials,
} from "../scripts/opencode-seat.mjs";
const script = fileURLToPath(new URL("../scripts/opencode-seat.mjs", import.meta.url));
const POSIX_ONLY = { skip: process.platform === "win32" ? "needs POSIX executables" : false };
const LINUX_ONLY = { skip: process.platform === "linux" ? false : "the sandbox is Linux only" };
const PARENT = {
  PATH: "/bin",
  HOME: "/home/u",
  TMPDIR: "/tmp",
  LANG: "C",
  XDG_CONFIG_HOME: "/c",
  XDG_DATA_HOME: "/d",
  XDG_CACHE_HOME: "/k",
  OPENAI_API_KEY: "o",
  ANTHROPIC_API_KEY: "a",
  GH_TOKEN: "g",
  SSH_AUTH_SOCK: "/agent",
  XDG_RUNTIME_DIR: "/run/user/1",
  PWD: "/elsewhere",
};
/** @param {string} prefix */
const scratch = (prefix) =>
  mkdtempSync(join(process.env.HOUSE_RULES_TEST_TMP || tmpdir(), `${prefix}-`));
test("the seat's environment holds the named variables, PWD and OpenCode's switches only", () => {
  const env = openCodeEnv(PARENT, "/work");
  assert.deepEqual(
    Object.keys(env).sort(),
    [
      "HOME",
      "LANG",
      "OPENCODE_CONFIG_CONTENT",
      "OPENCODE_DISABLE_AUTOUPDATE",
      "OPENCODE_DISABLE_CLAUDE_CODE",
      "OPENCODE_DISABLE_PROJECT_CONFIG",
      "PATH",
      "PWD",
      "TMPDIR",
      "XDG_CACHE_HOME",
      "XDG_CONFIG_HOME",
      "XDG_DATA_HOME",
    ].sort(),
  );
  assert.equal(env.PWD, "/work");
  assert.equal(env.OPENCODE_DISABLE_PROJECT_CONFIG, "1");
  assert.equal(env.OPENCODE_DISABLE_CLAUDE_CODE, "1");
});
test("only read, glob and list are allowed, .env files stay denied, globally and on the seat's agent", () => {
  const config = JSON.parse(openCodeEnv(PARENT, "/work").OPENCODE_CONFIG_CONTENT ?? "");
  const rules = {
    "*": "deny",
    read: { "*": "allow", "*.env": "deny", "*.env.*": "deny", "*.env.example": "allow" },
    glob: "allow",
    list: "allow",
  };
  assert.deepEqual(config.permission, rules);
  assert.deepEqual(config.tools, { "*": false, read: true, glob: true, list: true });
  assert.equal("grep" in config.permission, false, "grep's rules match patterns, not files");
  // OpenCode applies an agent's permissions after the global ones, so the seat's agent carries the rules.
  assert.deepEqual(config.agent[SEAT_AGENT].permission, rules);
  assert.deepEqual(config.agent[SEAT_AGENT].tools, config.tools);
  assert.equal(config.agent[SEAT_AGENT].mode, "primary");
});
test("the user's own read denials follow the seat's allow, and a whole-tool denial denies everything", () => {
  const read = (/** @type {string[]} */ denied) =>
    JSON.parse(openCodeEnv(PARENT, "/work", denied).OPENCODE_CONFIG_CONTENT ?? "").permission.read;
  assert.deepEqual(Object.keys(read(["secrets/*"])), [
    "*",
    "*.env",
    "*.env.*",
    "*.env.example",
    "secrets/*",
  ]);
  assert.equal(read(["secrets/*"])["secrets/*"], "deny");
  assert.deepEqual(read(["*"]), { "*": "deny" });
});
test("the user's config yields its read denials, or a final deny-all for a whole-tool deny or ask", () => {
  const dir = scratch("opencode-config");
  try {
    assert.deepEqual(userReadDenials(dir), []);
    writeFileSync(
      join(dir, "opencode.json"),
      JSON.stringify({
        permission: { read: { "*.pem": "deny", "docs/*": "ask", "src/*": "allow" } },
      }),
    );
    assert.deepEqual(userReadDenials(dir), ["*.pem", "docs/*"]);
    for (const read of ["deny", "ask"]) {
      writeFileSync(join(dir, "opencode.json"), JSON.stringify({ permission: { read } }));
      assert.deepEqual(userReadDenials(dir), ["*"]);
    }
    writeFileSync(join(dir, "opencode.json"), "{not json");
    assert.deepEqual(userReadDenials(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("the run arguments pick the model with its effort, the seat's agent and an attached prompt", () => {
  assert.deepEqual(runArgs("opencode-go/deepseek-v4.1-flash", "high", "prompt.md", "slug"), [
    "run",
    "--standalone",
    "--format",
    "json",
    "--model",
    "opencode-go/deepseek-v4.1-flash#high",
    "--agent",
    SEAT_AGENT,
    "--title",
    "slug",
    "Do the panel task in the attached file.",
    "--file",
    resolve("prompt.md"),
  ]);
});
test(
  "the sandbox shows the system folders, an empty home, a private /tmp and only the shown paths",
  LINUX_ONLY,
  () => {
    const dir = scratch("opencode-box");
    try {
      const home = join(dir, "home");
      mkdirSync(home);
      const seat = join(dir, "seat");
      mkdirSync(seat);
      const args = sandboxArgs(home, [seat, join(dir, "absent")]);
      assert.equal(args[0], "bwrap");
      assert.ok(args.includes("--die-with-parent"));
      const pairs = [];
      for (let i = 0; i < args.length - 2; i++) {
        if (args[i] === "--ro-bind") {
          pairs.push(args[i + 1]);
        }
      }
      assert.ok(pairs.includes(seat), "the seat's directory is shown");
      assert.equal(pairs.includes(dir), false);
      assert.equal(
        pairs.includes(join(dir, "absent")),
        false,
        "a path that does not exist is left out",
      );
      for (const wholeFolder of ["/etc", "/var", "/opt", "/home", "/root", "/mnt", "/srv"]) {
        assert.equal(pairs.includes(wholeFolder), false, wholeFolder);
      }
      assert.ok(args.join(" ").includes(`--tmpfs ${home}`), "the home folder is empty");
      assert.ok(args.join(" ").includes("--tmpfs /tmp"));
      assert.ok(args.includes("--unshare-pid"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
test("the script refuses missing arguments", () => {
  const r = spawnSync(process.execPath, [script, "only-model"], { encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^usage:/);
});
/** Stand-ins on PATH: `opencode` records what it sees; `bwrap` (Linux) records its arguments and runs what follows `--`. */
function withShims(
  /** @type {(dir: string, env: Record<string, string>, state: string) => void} */ body,
) {
  const dir = scratch("opencode-seat");
  // The home folder and OpenCode's own folders are outside the review root, as they are in real use.
  const state = scratch("opencode-state");
  try {
    const out = join(dir, "seen");
    writeFileSync(
      join(dir, "opencode"),
      `#!/bin/sh\npwd > "${out}.cwd"\nenv > "${out}.env"\nprintf '%s\\n' "$@" > "${out}.args"\nexit 7\n`,
    );
    writeFileSync(
      join(dir, "bwrap"),
      `#!/bin/sh\nprintf '%s\\n' "$@" > "${out}.bwrap"\nwhile [ "$1" != "--" ]; do shift; done\nshift\nexec "$@"\n`,
    );
    chmodSync(join(dir, "opencode"), 0o755);
    chmodSync(join(dir, "bwrap"), 0o755);
    writeFileSync(join(dir, "prompt.md"), "task");
    mkdirSync(join(state, "home"));
    mkdirSync(join(state, "data", "opencode"), { recursive: true });
    writeFileSync(
      join(state, "data", "opencode", "auth.json"),
      JSON.stringify({ "opencode-go": { key: "go-key" }, other: { key: "other-key" } }),
    );
    body(
      dir,
      {
        ...PARENT,
        PATH: `${dir}${delimiter}${process.env.PATH}`,
        HOME: join(state, "home"),
        XDG_DATA_HOME: join(state, "data"),
        XDG_CONFIG_HOME: join(state, "config"),
      },
      state,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(state, { recursive: true, force: true });
  }
}
test(
  "the script starts opencode in the current directory with the narrowed environment",
  POSIX_ONLY,
  () => {
    withShims((dir, env) => {
      const r = spawnSync(
        process.execPath,
        [script, "opencode-go/m", "max", "prompt.md", "title"],
        {
          cwd: dir,
          encoding: "utf8",
          env,
        },
      );
      assert.equal(r.status, 7, "opencode's exit status passes through");
      const seen = readFileSync(join(dir, "seen.env"), "utf8");
      for (const secret of [
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "GH_TOKEN",
        "SSH_AUTH_SOCK",
        "XDG_RUNTIME_DIR",
      ]) {
        assert.doesNotMatch(seen, new RegExp(`^${secret}=`, "m"));
      }
      assert.match(seen, /^OPENCODE_DISABLE_PROJECT_CONFIG=1$/m);
      assert.equal(readFileSync(join(dir, "seen.args"), "utf8").split("\n")[0], "run");
    });
  },
);
test(
  "on Linux the seat runs under bubblewrap with the provider's key from OpenCode's auth file",
  LINUX_ONLY,
  () => {
    withShims((dir, env) => {
      const r = spawnSync(
        process.execPath,
        [script, "opencode-go/m", "max", "prompt.md", "title"],
        {
          cwd: dir,
          encoding: "utf8",
          env,
        },
      );
      assert.equal(r.status, 7, r.stderr);
      const seen = readFileSync(join(dir, "seen.env"), "utf8");
      assert.match(seen, /^OPENCODE_API_KEY=go-key$/m, "the model's provider key");
      assert.doesNotMatch(seen, /other-key/);
      const box = readFileSync(join(dir, "seen.bwrap"), "utf8").split("\n");
      assert.ok(box.includes("--chdir") && box.includes("--setenv"));
      assert.ok(box.includes("--die-with-parent"));
      assert.match(box[box.indexOf("--") + 1] ?? "", /opencode$/, "the real binary runs after --");
    });
  },
);
test("the script reports an opencode that cannot start", POSIX_ONLY, () => {
  const r = spawnSync(process.execPath, [script, "m", "max", "prompt.md"], {
    encoding: "utf8",
    env: { PATH: "/nonexistent" },
  });
  assert.equal(r.status, 127);
  assert.match(r.stderr, /opencode is not on PATH|cannot start opencode/);
});

/** OpenCode's rule: the last matching pattern decides; `*` matches any run of characters. */
function decision(/** @type {Record<string, string>} */ read, /** @type {string} */ name) {
  let result = "ask";
  for (const [pattern, value] of Object.entries(read)) {
    const re = new RegExp(
      `^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*")}$`,
    );
    if (re.test(name)) {
      result = value;
    }
  }
  return result;
}
test("a user's read denial wins over the seat's allow, whichever pattern it names", () => {
  const read = (/** @type {string[]} */ denied) =>
    JSON.parse(openCodeEnv(PARENT, "/work", denied).OPENCODE_CONFIG_CONTENT ?? "").permission.read;
  assert.equal(decision(read([]), ".env.example"), "allow");
  assert.equal(decision(read([]), ".env"), "deny");
  assert.equal(decision(read(["*.env.*"]), ".env.example"), "deny", "the user's denial is last");
  assert.equal(decision(read(["*.env.example"]), ".env.example"), "deny");
  assert.equal(decision(read(["*.pem"]), "key.pem"), "deny");
  assert.equal(decision(read(["*.pem"]), "README.md"), "allow");
});
test(
  "the environment files and .git/config of a checkout are found without following links or reading .git/objects",
  POSIX_ONLY,
  () => {
    const dir = scratch("opencode-env");
    try {
      mkdirSync(join(dir, "a", "b"), { recursive: true });
      mkdirSync(join(dir, ".git", "objects", "ab"), { recursive: true });
      for (const name of [
        ".env",
        ".env.local",
        "a/prod.env",
        "a/b/.env.production",
        ".git/.env",
        ".git/config",
        ".git/objects/ab/.env",
        "a/config",
        ".env.example",
        "README.md",
      ]) {
        writeFileSync(join(dir, name), "x");
      }
      symlinkSync(join(dir, ".env"), join(dir, "notes.txt"));
      symlinkSync(join(dir, "a"), join(dir, "a-link"));
      assert.deepEqual(
        deniedFiles(dir)
          .map((p) => p.slice(dir.length + 1))
          .sort(),
        [".env", ".env.local", ".git/.env", ".git/config", "a/b/.env.production", "a/prod.env"],
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
test("the sandbox replaces each masked path with an empty file", LINUX_ONLY, () => {
  const dir = scratch("opencode-mask");
  try {
    const home = join(dir, "home");
    mkdirSync(home);
    const secret = join(dir, ".env");
    writeFileSync(secret, "x");
    const args = sandboxArgs(home, [dir], [secret]);
    const at = args.lastIndexOf("--ro-bind");
    assert.deepEqual(args.slice(at, at + 3), ["--ro-bind", "/dev/null", secret]);
    assert.ok(
      args.lastIndexOf("--ro-bind", at - 1) < at,
      "the mask comes after the folder it sits in",
    );
    assert.ok(args.indexOf(dir) < at);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("on Linux the script masks the checkout's .env files", LINUX_ONLY, () => {
  withShims((dir, env) => {
    writeFileSync(join(dir, ".env"), "SECRET=1");
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub", "prod.env"), "SECRET=2");
    writeFileSync(join(dir, ".env.example"), "SECRET=");
    const r = spawnSync(process.execPath, [script, "opencode-go/m", "max", "prompt.md"], {
      cwd: dir,
      encoding: "utf8",
      env,
    });
    assert.equal(r.status, 7, r.stderr);
    const box = readFileSync(join(dir, "seen.bwrap"), "utf8").split("\n");
    const real = (/** @type {string} */ name) => join(realpathSync(dir), name);
    const masked = [];
    for (let i = 0; i < box.length - 2; i++) {
      if (box[i] === "--ro-bind" && box[i + 1] === "/dev/null") {
        masked.push(box[i + 2]);
      }
    }
    assert.deepEqual(masked.sort(), [real(".env"), real("sub/prod.env")].sort());
  });
});

test(
  "files the user's own config denies are masked too, by name or by path, and a deny-all needs none",
  POSIX_ONLY,
  () => {
    const dir = scratch("opencode-denied");
    try {
      mkdirSync(join(dir, "secrets"));
      mkdirSync(join(dir, "docs"));
      for (const name of [
        "private.pem",
        "secrets/token.txt",
        "docs/guide.md",
        "README.md",
        ".env",
      ]) {
        writeFileSync(join(dir, name), "x");
      }
      symlinkSync(join(dir, "private.pem"), join(dir, "notes.txt"));
      const names = (/** @type {string[]} */ denied) =>
        deniedFiles(dir, denied)
          .map((p) => p.slice(dir.length + 1))
          .sort();
      assert.deepEqual(names([]), [".env"]);
      assert.deepEqual(names(["*.pem"]), [".env", "private.pem"]);
      assert.deepEqual(names(["secrets/*"]), [".env", "secrets/token.txt"]);
      assert.deepEqual(names(["**/token.*", "docs/?uide.md"]), [
        ".env",
        "docs/guide.md",
        "secrets/token.txt",
      ]);
      assert.deepEqual(names(["*"]), [".env"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test("on Linux the script also masks files the user's OpenCode config denies", LINUX_ONLY, () => {
  withShims((dir, env, state) => {
    mkdirSync(join(state, "config", "opencode"), { recursive: true });
    writeFileSync(
      join(state, "config", "opencode", "opencode.json"),
      JSON.stringify({ permission: { read: { "*.pem": "deny" } } }),
    );
    writeFileSync(join(dir, "private.pem"), "KEY");
    const r = spawnSync(process.execPath, [script, "opencode-go/m", "max", "prompt.md"], {
      cwd: dir,
      encoding: "utf8",
      env,
    });
    assert.equal(r.status, 7, r.stderr);
    const box = readFileSync(join(dir, "seen.bwrap"), "utf8").split("\n");
    assert.ok(box.includes(join(realpathSync(dir), "private.pem")));
  });
});

test("a user's default that denies or asks for everything becomes a deny-all for reads", () => {
  const dir = scratch("opencode-default");
  try {
    for (const permission of ["deny", "ask", { "*": "deny" }, { "*": "ask", edit: "allow" }]) {
      writeFileSync(join(dir, "opencode.json"), JSON.stringify({ permission }));
      assert.deepEqual(userReadDenials(dir), ["*"], JSON.stringify(permission));
    }
    for (const permission of ["allow", { "*": "allow", bash: "deny" }, {}]) {
      writeFileSync(join(dir, "opencode.json"), JSON.stringify({ permission }));
      assert.deepEqual(userReadDenials(dir), [], JSON.stringify(permission));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("a user's denial by absolute path masks that checkout file too", POSIX_ONLY, () => {
  const dir = scratch("opencode-absolute");
  try {
    writeFileSync(join(dir, "plain.txt"), "x");
    writeFileSync(join(dir, "creds.json"), "x");
    const names = (/** @type {string[]} */ denied) =>
      deniedFiles(dir, denied)
        .map((p) => p.slice(dir.length + 1))
        .sort();
    assert.deepEqual(names([join(dir, "creds.json")]), ["creds.json"]);
    assert.deepEqual(names([`${dir}/*`]), ["creds.json", "plain.txt"]);
    assert.deepEqual(names(["/somewhere/else/*"]), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test(
  "the sandbox shows the target of a linked /etc file that points outside /run/systemd/resolve",
  LINUX_ONLY,
  () => {
    const dir = scratch("opencode-links");
    try {
      const home = join(dir, "home");
      mkdirSync(home);
      const args = sandboxArgs(home, []);
      for (let i = 0; i < args.length - 2; i++) {
        if (args[i] === "--symlink" && String(args[i + 2]).startsWith("/etc/")) {
          const target = String(args[i + 1]);
          if (!target.startsWith("/run/systemd/resolve/") && !target.startsWith("/usr/")) {
            assert.ok(
              args.some(
                (a, j) => a === "--ro-bind" && args[j + 1] === target && args[j + 2] === target,
              ),
              `${args[i + 2]} points to ${target}, which must be shown`,
            );
          }
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test("a user's denial of a file under .git masks it, objects excepted", POSIX_ONLY, () => {
  const dir = scratch("opencode-git");
  try {
    mkdirSync(join(dir, ".git", "objects", "ab"), { recursive: true });
    writeFileSync(join(dir, ".git", "HEAD"), "ref");
    writeFileSync(join(dir, ".git", "config"), "[remote]");
    writeFileSync(join(dir, ".git", "objects", "ab", "cd"), "x");
    symlinkSync(join(dir, ".git", "HEAD"), join(dir, "notes.txt"));
    const names = deniedFiles(dir, [".git/HEAD", ".git/*"])
      .map((p) => p.slice(dir.length + 1))
      .sort();
    assert.deepEqual(names, [".git/HEAD", ".git/config"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test(
  "every other name of a denied file inside the root is masked too, hard links included",
  POSIX_ONLY,
  () => {
    const dir = scratch("opencode-hardlink");
    try {
      writeFileSync(join(dir, ".env"), "SECRET");
      linkSync(join(dir, ".env"), join(dir, "notes.txt"));
      writeFileSync(join(dir, "creds.json"), "SECRET");
      mkdirSync(join(dir, "sub"));
      linkSync(join(dir, "creds.json"), join(dir, "sub", "copy.txt"));
      writeFileSync(join(dir, "other.txt"), "fine");
      writeFileSync(join(dir, "twin-a.txt"), "x");
      linkSync(join(dir, "twin-a.txt"), join(dir, "twin-b.txt"));
      const names = (/** @type {string[]} */ denied) =>
        deniedFiles(dir, denied)
          .map((p) => p.slice(dir.length + 1))
          .sort();
      assert.deepEqual(names([]), [".env", "notes.txt"]);
      assert.deepEqual(names(["creds.json"]), [".env", "creds.json", "notes.txt", "sub/copy.txt"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
test("a review root that is or contains the home folder or OpenCode's folders is detected", () => {
  assert.equal(rootCovers("/h", ["/h"]), "/h");
  assert.equal(rootCovers("/", ["/h/u", "/h/u/.config/opencode"]), "/h/u");
  assert.equal(
    rootCovers("/h/u/.local", ["/h/u", "/h/u/.local/share/opencode"]),
    "/h/u/.local/share/opencode",
  );
  assert.equal(rootCovers("/h/u/work/repo", ["/h/u", "/h/u/.local/share/opencode"]), undefined);
  assert.equal(rootCovers("/h/u2", ["/h/u"]), undefined);
});
test("on Linux the script refuses a review root that contains the home folder", LINUX_ONLY, () => {
  withShims((dir, env, state) => {
    const r = spawnSync(
      process.execPath,
      [script, "opencode-go/m", "max", join(dir, "prompt.md")],
      {
        cwd: state,
        encoding: "utf8",
        env,
      },
    );
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /the review root contains .*home/);
  });
});

test(
  "a user's denial written with ~ or $HOME reaches the files it names under the review root",
  POSIX_ONLY,
  () => {
    const home = scratch("opencode-tilde");
    try {
      const dir = join(home, "project");
      mkdirSync(join(dir, "secrets"), { recursive: true });
      writeFileSync(join(dir, "secrets", "token.txt"), "x");
      writeFileSync(join(dir, "plain.txt"), "x");
      const names = (/** @type {string[]} */ denied) =>
        deniedFiles(dir, denied, home)
          .map((p) => p.slice(dir.length + 1))
          .sort();
      assert.deepEqual(names(["~/project/secrets/*"]), ["secrets/token.txt"]);
      assert.deepEqual(names(["$HOME/project/secrets/*"]), ["secrets/token.txt"]);
      assert.deepEqual(names(["${HOME}/project/secrets/token.txt"]), ["secrets/token.txt"]);
      assert.deepEqual(names(["~/elsewhere/*"]), []);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  },
);
test(
  "on Linux the script refuses OpenCode's data folder inside the review root and a provider it cannot supply",
  LINUX_ONLY,
  () => {
    withShims((dir, env) => {
      mkdirSync(join(dir, "data", "opencode"), { recursive: true });
      writeFileSync(join(dir, "data", "opencode", "auth.json"), "{}");
      const inside = spawnSync(process.execPath, [script, "opencode-go/m", "max", "prompt.md"], {
        cwd: dir,
        encoding: "utf8",
        env: { ...env, XDG_DATA_HOME: join(dir, "data") },
      });
      assert.equal(inside.status, 2, inside.stderr);
      assert.match(inside.stderr, /the review root contains .*opencode/);
      const other = spawnSync(process.execPath, [script, "openai/gpt", "max", "prompt.md"], {
        cwd: dir,
        encoding: "utf8",
        env,
      });
      assert.equal(other.status, 2, other.stderr);
      assert.match(other.stderr, /provider openai is not supported/);
      const supported = spawnSync(process.execPath, [script, "opencode/m", "max", "prompt.md"], {
        cwd: dir,
        encoding: "utf8",
        env,
      });
      assert.equal(supported.status, 7, supported.stderr);
    });
  },
);

test("a child named with two leading dots is inside the review root, a parent is not", () => {
  assert.equal(rootCovers("/repo", ["/repo/..home"]), "/repo/..home");
  assert.equal(rootCovers("/repo", ["/repo/..", "/repo2", "/other"]), undefined);
  assert.equal(rootCovers("/repo/sub", ["/repo"]), undefined);
});
test(
  "the sandbox shows public TLS material only, not the whole of /etc/ssl or /etc/pki",
  LINUX_ONLY,
  () => {
    const dir = scratch("opencode-tls");
    try {
      const home = join(dir, "home");
      mkdirSync(home);
      const args = sandboxArgs(home, []);
      for (const wholeFolder of ["/etc/ssl", "/etc/pki", "/etc/ssl/private", "/etc/pki/tls"]) {
        assert.equal(args.includes(wholeFolder), false, wholeFolder);
      }
      assert.equal(
        args.some((a) => a.startsWith("/etc/ssl/private")),
        false,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
test("a hard link of a denied file hidden among the git objects is masked too", POSIX_ONLY, () => {
  const dir = scratch("opencode-objects");
  try {
    mkdirSync(join(dir, ".git", "objects", "ab"), { recursive: true });
    writeFileSync(join(dir, ".env"), "SECRET");
    linkSync(join(dir, ".env"), join(dir, ".git", "objects", "ab", "notes.txt"));
    writeFileSync(join(dir, ".git", "objects", "ab", "plain"), "x");
    const names = deniedFiles(dir)
      .map((p) => p.slice(dir.length + 1))
      .sort();
    assert.deepEqual(names, [".env", ".git/objects/ab/notes.txt"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test(
  "a link named like a denied file also hides the file it points to inside the root",
  POSIX_ONLY,
  () => {
    const dir = scratch("opencode-denied-link");
    try {
      writeFileSync(join(dir, "secret.txt"), "SECRET");
      symlinkSync(join(dir, "secret.txt"), join(dir, ".env"));
      symlinkSync(join(dir, ".env"), join(dir, "notes.txt"));
      writeFileSync(join(dir, "plain.txt"), "x");
      symlinkSync(join(dir, "plain.txt"), join(dir, "link.txt"));
      const names = deniedFiles(dir)
        .map((p) => p.slice(dir.length + 1))
        .sort();
      assert.deepEqual(names, ["secret.txt"]);
      // A user's pattern that names a link works the same way.
      const byPattern = deniedFiles(dir, ["link.txt"])
        .map((p) => p.slice(dir.length + 1))
        .sort();
      assert.deepEqual(byPattern, ["plain.txt", "secret.txt"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
test("the denials of opencode.json and opencode.jsonc both count", () => {
  const dir = scratch("opencode-both");
  try {
    writeFileSync(
      join(dir, "opencode.json"),
      JSON.stringify({ permission: { read: { "*.key": "deny" } } }),
    );
    writeFileSync(
      join(dir, "opencode.jsonc"),
      '{ // comment\n "permission": { "read": { "*.pem": "ask" } } }',
    );
    assert.deepEqual(userReadDenials(dir).sort(), ["*.key", "*.pem"]);
    writeFileSync(join(dir, "opencode.json"), JSON.stringify({ permission: { bash: "allow" } }));
    assert.deepEqual(userReadDenials(dir), ["*.pem"]);
    writeFileSync(join(dir, "opencode.jsonc"), '{ "permission": "deny" }');
    assert.deepEqual(userReadDenials(dir), ["*"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test(
  "files behind a directory link that a denied path would name are masked where they are",
  POSIX_ONLY,
  () => {
    const dir = scratch("opencode-dirlink");
    try {
      mkdirSync(join(dir, "backing", "deep"), { recursive: true });
      writeFileSync(join(dir, "backing", "token.json"), "SECRET");
      writeFileSync(join(dir, "backing", "deep", "more.json"), "SECRET");
      writeFileSync(join(dir, "backing", "readme.md"), "fine");
      symlinkSync(join(dir, "backing"), join(dir, "secrets"));
      symlinkSync(join(dir, "secrets"), join(dir, "loop-a"));
      symlinkSync(dir, join(dir, "backing", "up"));
      const names = (/** @type {string[]} */ denied) =>
        deniedFiles(dir, denied)
          .map((p) => p.slice(dir.length + 1))
          .sort();
      assert.deepEqual(names(["secrets/*"]), [
        "backing/deep/more.json",
        "backing/readme.md",
        "backing/token.json",
      ]);
      assert.deepEqual(names(["secrets/token.json"]), ["backing/token.json"]);
      assert.deepEqual(names([]), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
test(
  "a git config is masked in a nested repository and when it is a link, by default",
  POSIX_ONLY,
  () => {
    const dir = scratch("opencode-gitconfig");
    try {
      mkdirSync(join(dir, "vendor", "lib", ".git"), { recursive: true });
      writeFileSync(join(dir, "vendor", "lib", ".git", "config"), "[remote]");
      mkdirSync(join(dir, ".git"));
      writeFileSync(join(dir, "remote-config"), "[remote]");
      symlinkSync(join(dir, "remote-config"), join(dir, ".git", "config"));
      const names = deniedFiles(dir)
        .map((p) => p.slice(dir.length + 1))
        .sort();
      assert.deepEqual(names, ["remote-config", "vendor/lib/.git/config"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
