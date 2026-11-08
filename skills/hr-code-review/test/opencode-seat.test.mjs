import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  SEAT_AGENT,
  copyReviewRoot,
  openCodeEnv,
  rootCovers,
  runArgs,
  findBwrap,
  readPrompt,
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
      `#!/bin/sh\npwd > "${out}.cwd"\nenv > "${out}.env"\nprintf '%s\\n' "$@" > "${out}.args"\nfind . ! -name . | sort > "${out}.files"\nexit 7\n`,
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
        [script, "opencode-go/m", "max", "prompt.md", "title", "--bwrap", join(dir, "bwrap")],
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
        [script, "opencode-go/m", "max", "prompt.md", "title", "--bwrap", join(dir, "bwrap")],
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
      [script, "opencode-go/m", "max", join(dir, "prompt.md"), "--bwrap", join(dir, "bwrap")],
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
  "on Linux the script refuses OpenCode's data folder inside the review root and a provider it cannot supply",
  LINUX_ONLY,
  () => {
    withShims((dir, env) => {
      mkdirSync(join(dir, "data", "opencode"), { recursive: true });
      writeFileSync(join(dir, "data", "opencode", "auth.json"), "{}");
      const inside = spawnSync(
        process.execPath,
        [script, "opencode-go/m", "max", "prompt.md", "--bwrap", join(dir, "bwrap")],
        {
          cwd: dir,
          encoding: "utf8",
          env: { ...env, XDG_DATA_HOME: join(dir, "data") },
        },
      );
      assert.equal(inside.status, 2, inside.stderr);
      assert.match(inside.stderr, /the review root contains .*opencode/);
      const other = spawnSync(
        process.execPath,
        [script, "openai/gpt", "max", "prompt.md", "--bwrap", join(dir, "bwrap")],
        {
          cwd: dir,
          encoding: "utf8",
          env,
        },
      );
      assert.equal(other.status, 2, other.stderr);
      assert.match(other.stderr, /provider openai is not supported/);
      const supported = spawnSync(
        process.execPath,
        [script, "opencode/m", "max", "prompt.md", "--bwrap", join(dir, "bwrap")],
        {
          cwd: dir,
          encoding: "utf8",
          env,
        },
      );
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

/**
 * The regular files copyReviewRoot puts in its copy of `dir`, relative and sorted; the copy must hold
 * nothing else (no link, no special file, no `.git`).
 * @param {string} dir
 * @param {string[]} [denied]
 * @param {string} [home]
 * @param {string[]} [keep]
 */
async function copied(dir, denied = [], home = undefined, keep = []) {
  const parent = scratch("opencode-copy-parent");
  try {
    const { copy } = await copyReviewRoot(dir, parent, denied, home, keep);
    /** @type {string[]} */
    const found = [];
    for (const stack = [copy]; stack.length > 0;) {
      const here = /** @type {string} */ (stack.pop());
      for (const entry of readdirSync(here, { withFileTypes: true })) {
        const path = join(here, entry.name);
        const rel = path.slice(copy.length + 1);
        assert.ok(!rel.split("/").includes(".git"), `${rel} is a .git entry`);
        if (entry.isDirectory()) {
          stack.push(path);
        } else {
          assert.ok(entry.isFile(), `${rel} is neither a regular file nor a folder`);
          found.push(rel);
        }
      }
    }
    return found.sort();
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
}
test(
  "the copy holds the regular files minus the environment files, with no link and no .git",
  POSIX_ONLY,
  async () => {
    const dir = scratch("opencode-env");
    try {
      mkdirSync(join(dir, "a", "b"), { recursive: true });
      mkdirSync(join(dir, ".git", "objects", "ab"), { recursive: true });
      mkdirSync(join(dir, "vendor", "lib", ".git"), { recursive: true });
      for (const name of [
        ".env",
        ".env.local",
        "a/prod.env",
        "a/b/.env.production",
        ".git/config",
        ".git/objects/ab/cd",
        "vendor/lib/.git/config",
        "vendor/lib/code.js",
        "a/config",
        ".env.example",
        "README.md",
      ]) {
        writeFileSync(join(dir, name), "x");
      }
      symlinkSync(join(dir, ".env"), join(dir, "notes.txt"));
      symlinkSync(join(dir, "a"), join(dir, "a-link"));
      symlinkSync("/etc/hostname", join(dir, "outside"));
      writeFileSync(join(dir, "gitfile-target"), "x");
      symlinkSync(join(dir, "gitfile-target"), join(dir, "vendor", ".git"));
      assert.deepEqual(await copied(dir), [
        ".env.example",
        "README.md",
        "a/config",
        "gitfile-target",
        "vendor/lib/code.js",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
test(
  "the copy is private, its files are read-only, and it is made outside the root",
  POSIX_ONLY,
  async () => {
    const dir = scratch("opencode-modes");
    const parent = scratch("opencode-modes-parent");
    try {
      mkdirSync(join(dir, "sub"));
      writeFileSync(join(dir, "sub", "a.txt"), "hello");
      writeFileSync(join(dir, "empty.txt"), "");
      const { copy, files, bytes } = await copyReviewRoot(dir, parent);
      assert.equal(files, 2);
      assert.equal(bytes, 5);
      assert.equal(join(copy, ".."), parent);
      assert.equal(lstatSync(copy).mode & 0o777, 0o700);
      assert.equal(lstatSync(join(copy, "sub")).mode & 0o777, 0o700);
      assert.equal(lstatSync(join(copy, "sub", "a.txt")).mode & 0o222, 0, "no write bit");
      assert.equal(readFileSync(join(copy, "sub", "a.txt"), "utf8"), "hello");
      assert.notEqual(
        lstatSync(join(copy, "sub", "a.txt")).ino,
        lstatSync(join(dir, "sub", "a.txt")).ino,
        "a new file, not a hard link",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(parent, { recursive: true, force: true });
    }
  },
);
test(
  "files the user's own config denies are left out, by name or by path, and a deny-all leaves none",
  POSIX_ONLY,
  async () => {
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
      const all = ["README.md", "docs/guide.md", "private.pem", "secrets/token.txt"];
      assert.deepEqual(await copied(dir, []), all);
      assert.deepEqual(
        await copied(dir, ["*.pem"]),
        all.filter((n) => n !== "private.pem"),
      );
      assert.deepEqual(
        await copied(dir, ["secrets/*"]),
        all.filter((n) => n !== "secrets/token.txt"),
      );
      assert.deepEqual(await copied(dir, ["**/token.*", "docs/?uide.md"]), [
        "README.md",
        "private.pem",
      ]);
      assert.deepEqual(await copied(dir, ["*"]), [], "a denied * copies nothing");
      await assert.rejects(
        copied(dir, ["secrets/*"], undefined, [join(dir, "secrets/token.txt")]),
        /cannot be the prompt/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
test(
  "a denial by absolute path leaves out that checkout file, and one elsewhere changes nothing",
  POSIX_ONLY,
  async () => {
    const dir = scratch("opencode-absolute");
    try {
      writeFileSync(join(dir, "plain.txt"), "x");
      writeFileSync(join(dir, "creds.json"), "x");
      assert.deepEqual(await copied(dir, [join(dir, "creds.json")]), ["plain.txt"]);
      assert.deepEqual(await copied(dir, [`${dir}/*`]), []);
      assert.deepEqual(await copied(dir, ["/somewhere/else/*"]), ["creds.json", "plain.txt"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
test(
  "a denial written with ~ or $HOME reaches the files it names under the review root",
  POSIX_ONLY,
  async () => {
    const home = scratch("opencode-tilde");
    try {
      const dir = join(home, "project");
      mkdirSync(join(dir, "secrets"), { recursive: true });
      writeFileSync(join(dir, "secrets", "token.txt"), "x");
      writeFileSync(join(dir, "plain.txt"), "x");
      for (const pattern of [
        "~/project/secrets/*",
        "$HOME/project/secrets/*",
        "${HOME}/project/secrets/token.txt",
      ]) {
        assert.deepEqual(await copied(dir, [pattern], home), ["plain.txt"], pattern);
      }
      assert.deepEqual(await copied(dir, ["~/elsewhere/*"], home), [
        "plain.txt",
        "secrets/token.txt",
      ]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  },
);
test(
  "every other name of a left-out file is left out too, hard links included",
  POSIX_ONLY,
  async () => {
    const dir = scratch("opencode-hardlink");
    try {
      mkdirSync(join(dir, "sub"));
      mkdirSync(join(dir, ".git", "hooks"), { recursive: true });
      writeFileSync(join(dir, ".env"), "SECRET");
      linkSync(join(dir, ".env"), join(dir, "notes.txt"));
      linkSync(join(dir, ".env"), join(dir, ".git", "hooks", "alias"));
      writeFileSync(join(dir, "creds.json"), "SECRET");
      linkSync(join(dir, "creds.json"), join(dir, "sub", "copy.txt"));
      writeFileSync(join(dir, "other.txt"), "fine");
      writeFileSync(join(dir, "twin-a.txt"), "x");
      linkSync(join(dir, "twin-a.txt"), join(dir, "twin-b.txt"));
      assert.deepEqual(await copied(dir), [
        "creds.json",
        "other.txt",
        "sub/copy.txt",
        "twin-a.txt",
        "twin-b.txt",
      ]);
      assert.deepEqual(await copied(dir, ["creds.json"]), [
        "other.txt",
        "twin-a.txt",
        "twin-b.txt",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
test(
  "a link named like a denied file also leaves out the file it points to; the link itself is never copied",
  POSIX_ONLY,
  async () => {
    const dir = scratch("opencode-denied-link");
    try {
      writeFileSync(join(dir, "secret.txt"), "SECRET");
      symlinkSync(join(dir, "secret.txt"), join(dir, ".env"));
      symlinkSync(join(dir, ".env"), join(dir, "notes.txt"));
      writeFileSync(join(dir, "plain.txt"), "x");
      symlinkSync(join(dir, "plain.txt"), join(dir, "link.txt"));
      assert.deepEqual(await copied(dir), ["plain.txt"]);
      // A user's pattern that names a link works the same way.
      assert.deepEqual(await copied(dir, ["link.txt"]), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
test(
  "files behind a directory link that a denied path would name are left out where they are, nested links too",
  POSIX_ONLY,
  async () => {
    const dir = scratch("opencode-dirlink");
    try {
      mkdirSync(join(dir, "backing", "deep"), { recursive: true });
      mkdirSync(join(dir, "store"));
      writeFileSync(join(dir, "backing", "token.json"), "SECRET");
      writeFileSync(join(dir, "backing", "deep", "more.json"), "SECRET");
      writeFileSync(join(dir, "backing", "readme.md"), "fine");
      writeFileSync(join(dir, "store", "key.txt"), "SECRET");
      writeFileSync(join(dir, "exposed.txt"), "SECRET");
      symlinkSync(join(dir, "backing"), join(dir, "secrets"));
      symlinkSync(join(dir, "secrets"), join(dir, "loop-a"));
      // A link inside a linked folder, to a folder and to a file, is followed with its virtual name.
      symlinkSync(join(dir, "store"), join(dir, "backing", "vault"));
      symlinkSync(join(dir, "exposed.txt"), join(dir, "backing", "config"));
      const kept = [
        "backing/deep/more.json",
        "backing/readme.md",
        "backing/token.json",
        "exposed.txt",
        "store/key.txt",
      ];
      assert.deepEqual(await copied(dir, []), kept);
      assert.deepEqual(await copied(dir, ["secrets/*"]), []);
      assert.deepEqual(
        await copied(dir, ["secrets/token.json"]),
        kept.filter((n) => n !== "backing/token.json"),
      );
      assert.deepEqual(
        await copied(dir, ["secrets/vault/*"]),
        kept.filter((n) => n !== "store/key.txt"),
      );
      assert.deepEqual(
        await copied(dir, ["secrets/config"]),
        kept.filter((n) => n !== "exposed.txt"),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
test(
  "a link to a file outside the root, in /usr or elsewhere, leaves nothing to copy or to hide",
  POSIX_ONLY,
  async () => {
    const dir = scratch("opencode-outside");
    const outside = scratch("opencode-outside-target");
    try {
      writeFileSync(join(outside, "secret.env"), "SECRET");
      symlinkSync(join(outside, "secret.env"), join(dir, ".env"));
      symlinkSync(join(outside, "secret.env"), join(dir, "notes.txt"));
      symlinkSync(outside, join(dir, "linked-folder"));
      writeFileSync(join(dir, "plain.txt"), "x");
      assert.deepEqual(await copied(dir, ["linked-folder/*"]), ["plain.txt"]);
      assert.ok(existsSync(join(outside, "secret.env")), "the outside file is untouched");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  },
);
test(
  "the copy refuses a root over the entry, file or byte limit and leaves no folder behind",
  POSIX_ONLY,
  async () => {
    const dir = scratch("opencode-cap");
    const parent = scratch("opencode-cap-parent");
    try {
      for (const name of ["a", "b", "c"]) {
        writeFileSync(join(dir, name), "12345");
      }
      const limited = (/** @type {{ entries: number, files: number, bytes: number }} */ limits) =>
        copyReviewRoot(dir, parent, [], undefined, [], { limits });
      await assert.rejects(limited({ entries: 2, files: 10, bytes: 100 }), /more than 2 entries/);
      await assert.rejects(limited({ entries: 10, files: 2, bytes: 100 }), /more than 2 files/);
      await assert.rejects(limited({ entries: 10, files: 10, bytes: 14 }), /more than 14 bytes/);
      assert.deepEqual(readdirSync(parent), [], "nothing is left in the parent");
      assert.equal((await limited({ entries: 3, files: 3, bytes: 15 })).files, 3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(parent, { recursive: true, force: true });
    }
  },
);
test(
  "the sandbox shows a mount's source at the path the seat knows, after the empty home",
  LINUX_ONLY,
  () => {
    const dir = scratch("opencode-mount");
    try {
      const home = join(dir, "home");
      mkdirSync(home);
      mkdirSync(join(dir, "src"));
      const args = sandboxArgs(home, [], [[join(dir, "src"), "/checkout"]]);
      const at = args.indexOf("/checkout");
      assert.deepEqual(args.slice(at - 2, at + 1), [
        "--ro-bind",
        realpathSync(join(dir, "src")),
        "/checkout",
      ]);
      assert.ok(args.indexOf("--tmpfs") < at, "the empty home comes first");
      assert.equal(args.includes("/dev/null"), false, "nothing is masked");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
test(
  "on Linux the seat runs on a copy shown at the checkout's path, never the checkout",
  LINUX_ONLY,
  () => {
    withShims((dir, env, state) => {
      mkdirSync(join(state, "config", "opencode"), { recursive: true });
      writeFileSync(
        join(state, "config", "opencode", "opencode.json"),
        JSON.stringify({ permission: { read: { "*.pem": "deny" } } }),
      );
      writeFileSync(join(dir, ".env"), "SECRET=1");
      mkdirSync(join(dir, "sub"));
      writeFileSync(join(dir, "sub", "prod.env"), "SECRET=2");
      writeFileSync(join(dir, ".env.example"), "SECRET=");
      writeFileSync(join(dir, "private.pem"), "KEY");
      mkdirSync(join(dir, ".git"));
      writeFileSync(join(dir, ".git", "config"), "[remote]");
      symlinkSync("/etc/hostname", join(dir, "hostname-link"));
      const r = spawnSync(
        process.execPath,
        [script, "opencode-go/m", "max", "prompt.md", "--bwrap", join(dir, "bwrap")],
        {
          cwd: dir,
          encoding: "utf8",
          env,
        },
      );
      assert.equal(r.status, 7, r.stderr);
      const real = realpathSync(dir);
      const box = readFileSync(join(dir, "seen.bwrap"), "utf8").split("\n");
      const at = box.findIndex((a, i) => a === "--ro-bind" && box[i + 2] === real);
      assert.notEqual(at, -1, "a bind to the checkout's path");
      const copy = box[at + 1] ?? "";
      assert.notEqual(copy, real, "the source is not the checkout");
      assert.equal(
        box.some((a, i) => a === "--ro-bind" && box[i + 1] === real),
        false,
        "the checkout itself is never bound",
      );
      assert.equal(box.includes("/dev/null"), false, "no path is masked");
      assert.equal(box[box.indexOf("--chdir") + 1], real);
      assert.equal(
        readFileSync(join(dir, "seen.cwd"), "utf8").trim(),
        copy,
        "the seat starts in the copy",
      );
      assert.equal(
        readFileSync(join(dir, "seen.files"), "utf8"),
        ["./.env.example", "./opencode", "./bwrap", "./prompt.md", "./seen", "./sub"]
          .filter((n) => n !== "./seen")
          .sort()
          .join("\n") + "\n",
        "the seat's folder holds the checkout's files without its secrets, links or .git",
      );
      assert.equal(existsSync(copy), false, "the copy is removed when the seat ends");
    });
  },
);
test(
  "the copy is removed when the sandbox cannot start after the copy was made",
  LINUX_ONLY,
  () => {
    withShims((dir, env) => {
      // An executable whose interpreter is missing cannot start: the failure comes after the copy exists.
      writeFileSync(join(dir, "bwrap"), "#!/nonexistent/interpreter\n");
      chmodSync(join(dir, "bwrap"), 0o755);
      const tmp = scratch("opencode-tmp");
      try {
        const r = spawnSync(
          process.execPath,
          [script, "opencode-go/m", "max", "prompt.md", "--bwrap", join(dir, "bwrap")],
          {
            cwd: dir,
            encoding: "utf8",
            env: { ...env, TMPDIR: tmp },
          },
        );
        assert.equal(r.status, 127, r.stderr);
        assert.match(r.stderr, /cannot start .*bwrap/);
        assert.deepEqual(
          readdirSync(tmp).filter((n) => n.startsWith("opencode-seat-")),
          [],
          r.stderr,
        );
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });
  },
);
test("a stop sent while opencode runs ends it and removes the copy", LINUX_ONLY, async () => {
  const dir = scratch("opencode-stop");
  const state = scratch("opencode-stop-state");
  try {
    const shim = join(dir, "opencode");
    writeFileSync(shim, `#!/bin/sh\necho $$ > "${join(dir, "ready")}"\nexec sleep 30\n`);
    writeFileSync(
      join(dir, "bwrap"),
      `#!/bin/sh\nprintf '%s\\n' "$@" > "${join(dir, "box")}"\nwhile [ "$1" != "--" ]; do shift; done\nshift\nexec "$@"\n`,
    );
    chmodSync(shim, 0o755);
    chmodSync(join(dir, "bwrap"), 0o755);
    writeFileSync(join(dir, "prompt.md"), "task");
    writeFileSync(join(dir, ".env"), "SECRET");
    mkdirSync(join(state, "home"));
    mkdirSync(join(state, "data", "opencode"), { recursive: true });
    writeFileSync(
      join(state, "data", "opencode", "auth.json"),
      JSON.stringify({ "opencode-go": { key: "k" } }),
    );
    const tmp = scratch("opencode-stop-tmp");
    const child = spawn(
      process.execPath,
      [script, "opencode-go/m", "max", "prompt.md", "--bwrap", join(dir, "bwrap")],
      {
        cwd: dir,
        stdio: "ignore",
        env: {
          ...PARENT,
          PATH: `${dir}${delimiter}${process.env.PATH}`,
          HOME: join(state, "home"),
          XDG_DATA_HOME: join(state, "data"),
          XDG_CONFIG_HOME: join(state, "config"),
          TMPDIR: tmp,
        },
      },
    );
    const closed = new Promise((done) => child.on("close", (code) => done(code)));
    for (let i = 0; i < 200 && !existsSync(join(dir, "ready")); i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(existsSync(join(dir, "ready")), "opencode started");
    assert.equal(
      readdirSync(tmp).filter((n) => n.startsWith("opencode-seat-")).length,
      1,
      "one copy exists while the seat runs",
    );
    child.kill("SIGTERM");
    assert.equal(await closed, 128 + 15);
    assert.deepEqual(
      readdirSync(tmp).filter((n) => n.startsWith("opencode-seat-")),
      [],
      "the copy is gone",
    );
    rmSync(tmp, { recursive: true, force: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(state, { recursive: true, force: true });
  }
});

test(
  "a link to .git/config and a hard link to it are left out like any denied name",
  POSIX_ONLY,
  async () => {
    const dir = scratch("opencode-gitconfig");
    try {
      mkdirSync(join(dir, ".git"));
      mkdirSync(join(dir, "vendor", "lib", ".git"), { recursive: true });
      writeFileSync(join(dir, "remote-config"), "[remote] url=https://token@host");
      symlinkSync(join(dir, "remote-config"), join(dir, ".git", "config"));
      writeFileSync(
        join(dir, "vendor", "lib", ".git", "config"),
        "[remote] url=https://token@host",
      );
      linkSync(
        join(dir, "vendor", "lib", ".git", "config"),
        join(dir, "vendor", "lib", "alias.txt"),
      );
      writeFileSync(join(dir, "plain.txt"), "x");
      assert.deepEqual(await copied(dir), ["plain.txt"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
test(
  "a folder reached by two paths is checked under each, not skipped the second time",
  POSIX_ONLY,
  async () => {
    const dir = scratch("opencode-alias");
    try {
      mkdirSync(join(dir, "backing"));
      mkdirSync(join(dir, "vault"));
      writeFileSync(join(dir, "vault", "token.json"), "SECRET");
      writeFileSync(join(dir, "plain.txt"), "x");
      symlinkSync(join(dir, "backing"), join(dir, "secrets"));
      symlinkSync(join(dir, "vault"), join(dir, "backing", "a"));
      symlinkSync(join(dir, "vault"), join(dir, "backing", "b"));
      assert.deepEqual(await copied(dir, ["secrets/b/token.json"]), ["plain.txt"]);
      assert.deepEqual(await copied(dir, ["secrets/a/token.json"]), ["plain.txt"]);
      assert.deepEqual(await copied(dir, ["secrets/c/token.json"]), [
        "plain.txt",
        "vault/token.json",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
test("a deny-all copies only the prompt file when it is inside the root", POSIX_ONLY, async () => {
  const dir = scratch("opencode-denyall");
  try {
    writeFileSync(join(dir, "prompt.md"), "task");
    writeFileSync(join(dir, "other.txt"), "x");
    assert.deepEqual(await copied(dir, ["*"], undefined, [join(realpathSync(dir), "prompt.md")]), [
      "prompt.md",
    ]);
    assert.deepEqual(await copied(dir, ["*"]), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test(
  "a prompt file that the rules deny, by name or as another name of a denied file, refuses the run",
  POSIX_ONLY,
  async () => {
    const dir = scratch("opencode-denied-prompt");
    try {
      const real = realpathSync(dir);
      writeFileSync(join(dir, ".env"), "SECRET");
      linkSync(join(dir, ".env"), join(dir, "prompt.md"));
      writeFileSync(join(dir, "plain.txt"), "x");
      await assert.rejects(
        copied(dir, [], undefined, [join(real, ".env")]),
        /cannot be the prompt/,
      );
      await assert.rejects(
        copied(dir, [], undefined, [join(real, "prompt.md")]),
        /cannot be the prompt/,
      );
      assert.deepEqual(await copied(dir, [], undefined, [join(real, "plain.txt")]), ["plain.txt"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
test(
  "the copy is refused when the root changes while it is copied, and leaves no folder behind",
  POSIX_ONLY,
  async () => {
    const outside = scratch("opencode-swap-outside");
    const parent = scratch("opencode-swap-parent");
    const attempt = async (/** @type {(dir: string) => void} */ change) => {
      const dir = scratch("opencode-swap");
      try {
        mkdirSync(join(dir, "sub"));
        writeFileSync(join(dir, "a.txt"), "aaaa");
        writeFileSync(join(dir, "sub", "b.txt"), "bbbb");
        writeFileSync(join(outside, "b.txt"), "OUTSIDE");
        return await copyReviewRoot(dir, parent, [], undefined, [], {
          onCreate: () => change(dir),
        });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    };
    try {
      await assert.rejects(
        attempt((dir) => {
          writeFileSync(join(dir, "a.new"), "aaaa");
          renameSync(join(dir, "a.new"), join(dir, "a.txt"));
        }),
        /a\.txt changed while/,
        "a file replaced after the scan",
      );
      await assert.rejects(
        attempt((dir) => writeFileSync(join(dir, "a.txt"), "aaaaaaaa")),
        /a\.txt changed while/,
        "a file resized after the scan",
      );
      await assert.rejects(
        attempt((dir) => {
          renameSync(join(dir, "sub"), join(dir, "sub-moved"));
          symlinkSync(outside, join(dir, "sub"));
        }),
        /sub\/b\.txt changed while/,
        "a folder swapped for a link to outside files",
      );
      assert.deepEqual(readdirSync(parent), [], "nothing is left behind");
    } finally {
      rmSync(outside, { recursive: true, force: true });
      rmSync(parent, { recursive: true, force: true });
    }
  },
);
test(
  "the copy folder is announced as soon as it exists, before any file is copied",
  POSIX_ONLY,
  async () => {
    const dir = scratch("opencode-oncreate");
    const parent = scratch("opencode-oncreate-parent");
    try {
      writeFileSync(join(dir, "a.txt"), "x");
      /** @type {string[]} */
      const seenAt = [];
      const { copy } = await copyReviewRoot(dir, parent, [], undefined, [], {
        onCreate: (made) => seenAt.push(...readdirSync(made), made),
      });
      assert.deepEqual(seenAt, [copy], "announced while empty");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(parent, { recursive: true, force: true });
    }
  },
);

test(
  "a denied file inside .git, or inside a folder .git links to, is left out under every name",
  POSIX_ONLY,
  async () => {
    const dir = scratch("opencode-gitdenied");
    try {
      mkdirSync(join(dir, ".git", "objects", "ab"), { recursive: true });
      writeFileSync(join(dir, ".git", ".env"), "SECRET");
      linkSync(join(dir, ".git", ".env"), join(dir, "notes.txt"));
      writeFileSync(join(dir, ".git", "objects", "ab", "cd"), "object");
      writeFileSync(join(dir, "plain.txt"), "x");
      assert.deepEqual(await copied(dir), ["plain.txt"]);
      const linked = scratch("opencode-gitlink");
      try {
        mkdirSync(join(linked, "metadata"));
        writeFileSync(join(linked, "metadata", "config"), "[remote] url=https://token@host");
        linkSync(join(linked, "metadata", "config"), join(linked, "alias.txt"));
        symlinkSync(join(linked, "metadata"), join(linked, ".git"));
        writeFileSync(join(linked, "plain.txt"), "x");
        assert.deepEqual(await copied(linked), ["plain.txt"]);
      } finally {
        rmSync(linked, { recursive: true, force: true });
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
test(
  "a link back to a folder above it is refused only when a denied pattern names a path",
  POSIX_ONLY,
  async () => {
    const dir = scratch("opencode-cycle");
    try {
      mkdirSync(join(dir, "backing"));
      writeFileSync(join(dir, "backing", "token.txt"), "SECRET");
      symlinkSync(join(dir, "backing"), join(dir, "backing", "again"));
      symlinkSync(join(dir, "backing"), join(dir, "secrets"));
      await assert.rejects(
        copied(dir, ["secrets/again/token.txt"]),
        /links back to a folder above it/,
      );
      assert.deepEqual(await copied(dir, ["*.pem"]), ["backing/token.txt"]);
      assert.deepEqual(await copied(dir), ["backing/token.txt"]);
      assert.deepEqual(await copied(dir, ["token.txt"]), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
test(
  "a file swapped for a named pipe after the scan fails the copy instead of hanging it",
  POSIX_ONLY,
  async () => {
    const dir = scratch("opencode-fifo");
    const parent = scratch("opencode-fifo-parent");
    try {
      writeFileSync(join(dir, "a.txt"), "aaaa");
      await assert.rejects(
        copyReviewRoot(dir, parent, [], undefined, [], {
          onCreate: () => {
            rmSync(join(dir, "a.txt"));
            spawnSync("mkfifo", [join(dir, "a.txt")]);
          },
        }),
        /a\.txt changed while/,
      );
      assert.deepEqual(readdirSync(parent), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(parent, { recursive: true, force: true });
    }
  },
);

test(
  "a regular .git file that a pattern denies leaves out its hard-link aliases",
  POSIX_ONLY,
  async () => {
    const dir = scratch("opencode-gitfile");
    try {
      writeFileSync(join(dir, ".git"), "gitdir: /private/place");
      linkSync(join(dir, ".git"), join(dir, "notes.txt"));
      writeFileSync(join(dir, "plain.txt"), "x");
      assert.deepEqual(await copied(dir, [".git"]), ["plain.txt"]);
      assert.deepEqual(await copied(dir), ["notes.txt", "plain.txt"], "no rule, no omission");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
test("a wildcard denial covers a file name that holds a newline", POSIX_ONLY, async () => {
  const dir = scratch("opencode-newline");
  try {
    mkdirSync(join(dir, "private"));
    writeFileSync(join(dir, "private", "token\n.txt"), "SECRET");
    linkSync(join(dir, "private", "token\n.txt"), join(dir, "notes.txt"));
    writeFileSync(join(dir, "plain.txt"), "x");
    assert.deepEqual(await copied(dir, ["private/*"]), ["plain.txt"]);
    assert.deepEqual(await copied(dir, ["private/token?.txt"]), ["plain.txt"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test(
  "a prompt inside the checkout is the copy's file, never mounted from the original",
  LINUX_ONLY,
  () => {
    withShims((dir, env) => {
      const r = spawnSync(
        process.execPath,
        [script, "opencode-go/m", "max", "prompt.md", "--bwrap", join(dir, "bwrap")],
        {
          cwd: dir,
          encoding: "utf8",
          env,
        },
      );
      assert.equal(r.status, 7, r.stderr);
      const prompt = join(realpathSync(dir), "prompt.md");
      const box = readFileSync(join(dir, "seen.bwrap"), "utf8").split("\n");
      assert.equal(
        box.some((a, i) => a === "--ro-bind" && box[i + 1] === prompt && box[i + 2] === prompt),
        false,
        "no bind of the original prompt over the copy's",
      );
      assert.ok(
        box.includes("--file") || readFileSync(join(dir, "seen.args"), "utf8").includes(prompt),
      );
    });
  },
);
test(
  "a prompt that the rules deny, by the name given or the file it resolves to, refuses the run",
  LINUX_ONLY,
  () => {
    withShims((dir, env, state) => {
      writeFileSync(join(state, "secret.env"), "PRIVATE");
      symlinkSync(join(state, "secret.env"), join(dir, "prompt-link.md"));
      const link = spawnSync(
        process.execPath,
        [script, "opencode-go/m", "max", "prompt-link.md", "--bwrap", join(dir, "bwrap")],
        {
          cwd: dir,
          encoding: "utf8",
          env,
        },
      );
      assert.equal(link.status, 2, link.stderr);
      assert.match(link.stderr, /prompt file .* is a file the read rules deny/);
      writeFileSync(join(dir, "task.env"), "task");
      const named = spawnSync(
        process.execPath,
        [script, "opencode-go/m", "max", "task.env", "--bwrap", join(dir, "bwrap")],
        {
          cwd: dir,
          encoding: "utf8",
          env,
        },
      );
      assert.equal(named.status, 2, named.stderr);
      assert.equal(existsSync(join(dir, "seen.bwrap")), false, "the sandbox never started");
    });
  },
);

test(
  "bubblewrap is found in system folders or at an absolute --bwrap, never on PATH or in the environment",
  POSIX_ONLY,
  () => {
    const dir = scratch("opencode-findbwrap");
    try {
      mkdirSync(join(dir, "trusted"));
      mkdirSync(join(dir, "repo-bin"));
      writeFileSync(join(dir, "repo-bin", "bwrap"), "#!/bin/sh\n", { mode: 0o755 });
      const trusted = [join(dir, "trusted")];
      assert.equal(findBwrap(undefined, trusted), undefined, "no PATH search");
      writeFileSync(join(dir, "trusted", "bwrap"), "#!/bin/sh\n", { mode: 0o755 });
      assert.equal(findBwrap(undefined, trusted), join(dir, "trusted", "bwrap"));
      const own = join(dir, "own-bwrap");
      writeFileSync(own, "#!/bin/sh\n", { mode: 0o755 });
      assert.equal(findBwrap(own, trusted), own);
      assert.equal(findBwrap("bwrap", trusted), undefined, "absolute only");
      assert.equal(findBwrap(join(dir, "missing"), trusted), undefined);
      mkdirSync(join(dir, "trusted2", "bwrap"), { recursive: true });
      assert.equal(
        findBwrap(undefined, [join(dir, "trusted2")]),
        undefined,
        "a folder is not bubblewrap",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
test(
  "a prompt that is a folder, or a link to one, refuses the run before any mount",
  LINUX_ONLY,
  () => {
    withShims((dir, env) => {
      writeFileSync(join(dir, ".env"), "PRIVATE");
      symlinkSync("..", join(dir, "task.md"));
      for (const prompt of ["task.md", ".."]) {
        const r = spawnSync(
          process.execPath,
          [script, "opencode-go/m", "max", prompt, "--bwrap", join(dir, "bwrap")],
          {
            cwd: dir,
            encoding: "utf8",
            env,
          },
        );
        assert.equal(r.status, 2, r.stderr);
        assert.match(r.stderr, /is not a regular file/);
      }
      assert.equal(existsSync(join(dir, "seen.bwrap")), false, "the sandbox never started");
    });
  },
);
test(
  "a prompt outside the checkout is copied into the seat's view, not mounted from where it is",
  LINUX_ONLY,
  () => {
    withShims((dir, env, state) => {
      // The stand-in opencode reads the attached file from its working directory (the copy; a real sandbox
      // shows the copy at the checkout's path), so the bytes the seat gets are checked.
      writeFileSync(
        join(dir, "opencode"),
        `#!/bin/sh\nprev=""\nfor a in "$@"; do [ "$prev" = "--file" ] && { cat "./$(basename "$a")" > "${join(dir, "seen.prompt")}"; printf '%s' "$a" > "${join(dir, "seen.promptpath")}"; }; prev="$a"; done\nexit 7\n`,
      );
      chmodSync(join(dir, "opencode"), 0o755);
      const outside = join(state, "task.md");
      writeFileSync(outside, "the task outside");
      const r = spawnSync(
        process.execPath,
        [script, "opencode-go/m", "max", outside, "--bwrap", join(dir, "bwrap")],
        {
          cwd: dir,
          encoding: "utf8",
          env,
        },
      );
      assert.equal(r.status, 7, r.stderr);
      const box = readFileSync(join(dir, "seen.bwrap"), "utf8").split("\n");
      assert.equal(box.includes(realpathSync(outside)), false, "the outside path is not bound");
      assert.equal(readFileSync(join(dir, "seen.prompt"), "utf8"), "the task outside");
      const file = readFileSync(join(dir, "seen.promptpath"), "utf8");
      assert.ok(file.startsWith(join(realpathSync(dir), ".panel-seat-prompt-")), file);
    });
  },
);

test(
  "an environment variable cannot choose the sandbox helper, as a checkout's .env could set it",
  LINUX_ONLY,
  () => {
    withShims((dir, env) => {
      writeFileSync(
        join(dir, "evilwrap"),
        `#!/bin/sh\ntouch "${join(dir, "evil-ran")}"\nexit 9\n`,
        {
          mode: 0o755,
        },
      );
      const r = spawnSync(process.execPath, [script, "opencode-go/m", "max", "prompt.md"], {
        cwd: dir,
        encoding: "utf8",
        env: { ...env, OPENCODE_SEAT_BWRAP: join(dir, "evilwrap") },
      });
      assert.equal(existsSync(join(dir, "evil-ran")), false, r.stderr);
    });
  },
);
test(
  "the prompt is read from one verified descriptor: a swapped link, a folder and a denied name fail",
  POSIX_ONLY,
  () => {
    const dir = scratch("opencode-readprompt");
    try {
      const real = realpathSync(dir);
      writeFileSync(join(real, "task.md"), "the task");
      writeFileSync(join(real, "secret.env"), "PRIVATE");
      const denies = (/** @type {string} */ p) => p.endsWith(".env");
      assert.equal(readPrompt(join(real, "task.md"), denies).toString(), "the task");
      assert.throws(() => readPrompt(join(real, "secret.env"), denies), /read rules deny/);
      rmSync(join(real, "task.md"));
      symlinkSync(join(real, "secret.env"), join(real, "task.md"));
      assert.throws(() => readPrompt(join(real, "task.md"), denies));
      mkdirSync(join(real, "folder"));
      assert.throws(() => readPrompt(join(real, "folder"), denies));
      writeFileSync(join(real, "big.md"), "x".repeat(20));
      assert.throws(() => readPrompt(join(real, "big.md"), () => false, 10), /over 10 bytes/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "--root names the checkout, so the script can be launched from a trusted folder",
  LINUX_ONLY,
  () => {
    withShims((dir, env, state) => {
      const r = spawnSync(
        process.execPath,
        [
          script,
          "opencode-go/m",
          "max",
          join(dir, "prompt.md"),
          "--root",
          dir,
          "--bwrap",
          join(dir, "bwrap"),
        ],
        { cwd: state, encoding: "utf8", env },
      );
      assert.equal(r.status, 7, r.stderr);
      assert.doesNotMatch(r.stderr, /warning: the launch folder is the checkout/);
      const box = readFileSync(join(dir, "seen.bwrap"), "utf8").split("\n");
      assert.equal(box[box.indexOf("--chdir") + 1], realpathSync(dir));
      // Without it the checkout is the launch folder, and the run says so.
      const plain = spawnSync(
        process.execPath,
        [script, "opencode-go/m", "max", "prompt.md", "--bwrap", join(dir, "bwrap")],
        {
          cwd: dir,
          encoding: "utf8",
          env,
        },
      );
      assert.equal(plain.status, 7, plain.stderr);
      assert.match(plain.stderr, /warning: the launch folder is the checkout/);
    });
  },
);
test(
  "the optional arguments are read after the three required ones, and a prompt may be named --bwrap",
  LINUX_ONLY,
  () => {
    withShims((dir, env) => {
      writeFileSync(join(dir, "--bwrap"), "task");
      const r = spawnSync(
        process.execPath,
        [script, "opencode-go/m", "max", "--bwrap", "a title", "--bwrap", join(dir, "bwrap")],
        { cwd: dir, encoding: "utf8", env },
      );
      assert.equal(r.status, 7, r.stderr);
      for (const extra of [["--bwrap"], ["--root", "/a", "--root", "/b"], ["t", "u"]]) {
        const bad = spawnSync(
          process.execPath,
          [script, "opencode-go/m", "max", "prompt.md", ...extra],
          {
            cwd: dir,
            encoding: "utf8",
            env,
          },
        );
        assert.equal(bad.status, 2, extra.join(" "));
        assert.match(bad.stderr, /^usage:/m);
      }
    });
  },
);
test(
  "a temporary folder inside the checkout is refused: the copy must be out of reach of its writers",
  LINUX_ONLY,
  () => {
    withShims((dir, env) => {
      mkdirSync(join(dir, "tmp-in-root"));
      const r = spawnSync(
        process.execPath,
        [script, "opencode-go/m", "max", "prompt.md", "--bwrap", join(dir, "bwrap")],
        { cwd: dir, encoding: "utf8", env: { ...env, TMPDIR: join(dir, "tmp-in-root") } },
      );
      assert.equal(r.status, 2, r.stderr);
      assert.match(r.stderr, /temporary folder .* is inside the review root/);
      assert.equal(existsSync(join(dir, "seen.bwrap")), false);
    });
  },
);

test(
  "a title that starts with -- is still a title, and --root . from the checkout still warns",
  LINUX_ONLY,
  () => {
    withShims((dir, env) => {
      const r = spawnSync(
        process.execPath,
        [
          script,
          "opencode-go/m",
          "max",
          "prompt.md",
          "--audit",
          "--root",
          ".",
          "--bwrap",
          join(dir, "bwrap"),
        ],
        { cwd: dir, encoding: "utf8", env },
      );
      assert.equal(r.status, 7, r.stderr);
      assert.match(r.stderr, /warning: the launch folder is the checkout/);
      const args = readFileSync(join(dir, "seen.args"), "utf8").split("\n");
      assert.equal(args[args.indexOf("--title") + 1], "--audit");
    });
  },
);
