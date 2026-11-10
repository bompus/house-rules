import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  statSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import {
  checkEnvPaths,
  inside,
  programFolder,
  resolveProgram,
  reviewBase,
  trustedDirs,
} from "../scripts/seat-paths.mjs";

const POSIX = { skip: process.platform === "win32" ? "POSIX paths" : false };
const refuse = /** @type {(message: string) => never} */ (
  (message) => {
    throw new Error(message);
  }
);
/**
 * A scratch tree: `repo` (the checkout, with a .git folder), `bin` (a trusted folder) and `outside`.
 * @param {(t: { dir: string, repo: string, bin: string, outside: string }) => void} body
 */
function withTree(body) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "seat-paths-")));
  try {
    const repo = join(dir, "repo");
    const bin = join(dir, "bin");
    const outside = join(dir, "outside");
    mkdirSync(join(repo, ".git"), { recursive: true });
    mkdirSync(join(repo, "bin"));
    mkdirSync(bin);
    mkdirSync(outside);
    body({ dir, repo, bin, outside });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
/** @param {string} path */
const program = (path) => writeFileSync(path, "#!/bin/sh\nexit 0\n", { mode: 0o755 });

test(
  "reviewBase is the enclosing checkout, the review root itself when there is none or it is the home folder",
  { skip: process.platform === "win32" },
  () => {
    const dir = mkdtempSync(join(tmpdir(), "review-base-"));
    const savedHome = process.env.HOME;
    try {
      const repo = realpathSync(dir);
      mkdirSync(join(repo, "r", ".git"), { recursive: true });
      mkdirSync(join(repo, "r", "packages", "app"), { recursive: true });
      mkdirSync(join(repo, "plain", "sub"), { recursive: true });
      process.env.HOME = "/nonexistent-home";
      assert.equal(reviewBase(join(repo, "r", "packages", "app")), join(repo, "r"));
      assert.equal(reviewBase(join(repo, "r")), join(repo, "r"));
      assert.equal(reviewBase(join(repo, "plain", "sub")), join(repo, "plain", "sub"));
      // A dotfiles-style repository at (or above) the home folder is not the checkout.
      mkdirSync(join(repo, "plain", ".git"));
      process.env.HOME = join(repo, "plain");
      assert.equal(reviewBase(join(repo, "plain", "sub")), join(repo, "plain", "sub"));
    } finally {
      process.env.HOME = savedHome;
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "reviewBase takes the outermost marker, so a nested .jj cannot hide the checkout around it",
  { skip: process.platform === "win32" },
  () => {
    const dir = mkdtempSync(join(tmpdir(), "review-base-nested-"));
    const savedHome = process.env.HOME;
    try {
      const repo = realpathSync(dir);
      mkdirSync(join(repo, "r", ".git"), { recursive: true });
      mkdirSync(join(repo, "r", "packages", "app"), { recursive: true });
      writeFileSync(join(repo, "r", "packages", "app", ".jj"), "tracked file");
      process.env.HOME = "/nonexistent-home";
      assert.equal(reviewBase(join(repo, "r", "packages", "app")), join(repo, "r"));
    } finally {
      process.env.HOME = savedHome;
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "inside follows links the way the system does, also below a link and through `..`",
  POSIX,
  () => {
    withTree(({ repo, outside, dir }) => {
      symlinkSync(repo, join(outside, "into"));
      assert.equal(inside(repo, join(repo, "x")), true);
      assert.equal(inside(repo, repo), true);
      assert.equal(inside(repo, outside), false);
      assert.equal(inside(repo, join(outside, "into")), true, "a link into the checkout");
      assert.equal(
        inside(repo, join(outside, "into", "not-yet", "made")),
        true,
        "below a link, not there yet",
      );
      // `into/..` is the folder above the checkout (physical), not `outside` (lexical).
      assert.equal(inside(repo, join(outside, "into", "..")), false);
      assert.equal(inside(dir, join(outside, "into", "..")), true);
    });
  },
);

test(
  "trustedDirs holds canonical folders: named ones first, system ones that exist, none in the checkout",
  POSIX,
  () => {
    withTree(({ repo, bin, outside }) => {
      symlinkSync(bin, join(outside, "alias"));
      const dirs = trustedDirs([join(outside, "alias")], repo, refuse);
      assert.equal(dirs[0], bin, "the canonical folder, not the alias");
      assert.ok(dirs.every((d) => d === realpathSync(d)));
      assert.equal(new Set(dirs).size, dirs.length);
      assert.ok(dirs.includes(realpathSync("/usr/bin")) || dirs.includes(realpathSync("/bin")));
      assert.equal(
        trustedDirs([], repo, refuse).some((d) => d === repo || d.startsWith(`${repo}/`)),
        false,
      );
    });
  },
);

test(
  "trustedDirs refuses a folder that is relative, missing, or inside the checkout (also through a link)",
  POSIX,
  () => {
    withTree(({ repo, outside }) => {
      symlinkSync(join(repo, "bin"), join(outside, "link-into-repo"));
      assert.throws(() => trustedDirs(["bin"], repo, refuse), /not an absolute path/);
      assert.throws(() => trustedDirs([""], repo, refuse), /not an absolute path/);
      assert.throws(() => trustedDirs([join(outside, "missing")], repo, refuse), /does not exist/);
      assert.throws(
        () => trustedDirs([join(repo, "bin")], repo, refuse),
        /inside the review checkout/,
      );
      assert.throws(
        () => trustedDirs([join(outside, "link-into-repo")], repo, refuse),
        /inside the review checkout/,
      );
    });
  },
);

test("a folder above the checkout is fine: only what is inside the checkout is not", POSIX, () => {
  withTree(({ dir, repo }) => {
    assert.ok(trustedDirs([dir], repo, refuse).includes(dir));
  });
});

test("resolveProgram finds a bare name only in the given folders, first match first", POSIX, () => {
  withTree(({ repo, bin, outside }) => {
    program(join(bin, "tool"));
    program(join(outside, "tool"));
    program(join(repo, "bin", "tool"));
    assert.equal(resolveProgram("tool", [bin, outside], repo, refuse), join(bin, "tool"));
    assert.equal(resolveProgram("tool", [outside, bin], repo, refuse), join(outside, "tool"));
    assert.equal(resolveProgram("missing", [bin], repo, refuse), undefined);
    // The checkout's own bin folder is not in the list, so its tool is never a candidate.
    assert.equal(resolveProgram("tool", [], repo, refuse), undefined);
  });
});

test(
  "resolveProgram returns the canonical file it checked and skips folders and files that do not run",
  POSIX,
  () => {
    withTree(({ repo, bin, outside }) => {
      program(join(outside, "real-tool"));
      symlinkSync(join(outside, "real-tool"), join(bin, "tool"));
      assert.equal(
        resolveProgram("tool", [bin], repo, refuse),
        join(outside, "real-tool"),
        "the canonical file that was checked, not the alias",
      );
      mkdirSync(join(bin, "dir-tool"));
      writeFileSync(join(bin, "plain-tool"), "x", { mode: 0o644 });
      assert.equal(resolveProgram("dir-tool", [bin], repo, refuse), undefined);
      assert.equal(resolveProgram("plain-tool", [bin], repo, refuse), undefined);
      chmodSync(join(bin, "plain-tool"), 0o644);
    });
  },
);

test(
  "resolveProgram refuses a program inside the checkout, by path or through a link, and a relative path",
  POSIX,
  () => {
    withTree(({ repo, bin, outside }) => {
      program(join(repo, "bin", "tool"));
      symlinkSync(join(repo, "bin", "tool"), join(bin, "linked"));
      assert.throws(
        () => resolveProgram(join(repo, "bin", "tool"), [], repo, refuse),
        /inside the review checkout/,
      );
      assert.throws(
        () => resolveProgram("linked", [bin], repo, refuse),
        /inside the review checkout/,
      );
      assert.throws(() => resolveProgram("./bin/tool", [bin], repo, refuse), /relative path/);
      assert.throws(() => resolveProgram("bin/tool", [bin], repo, refuse), /relative path/);
      assert.equal(
        resolveProgram("..", [bin], repo, refuse),
        undefined,
        "a folder is not a program",
      );
      // An absolute path outside the checkout is the caller's choice and runs.
      program(join(outside, "ok"));
      assert.equal(resolveProgram(join(outside, "ok"), [], repo, refuse), join(outside, "ok"));
    });
  },
);

test("checkEnvPaths refuses a relative or checkout-inside value for a path variable", POSIX, () => {
  withTree(({ repo, outside }) => {
    symlinkSync(repo, join(outside, "into"));
    const bad = (/** @type {Record<string, string>} */ env, /** @type {RegExp} */ re) =>
      assert.throws(() => checkEnvPaths(env, repo, refuse), re, JSON.stringify(env));
    bad({ HOME: "home" }, /relative path/);
    bad({ TMPDIR: "./tmp" }, /relative path/);
    bad({ XDG_CACHE_HOME: "../c" }, /relative path/);
    bad({ SSL_CERT_FILE: "ca.pem" }, /relative path/);
    bad({ HOME: join(repo, "home") }, /inside the review checkout/);
    bad({ TMPDIR: join(outside, "into") }, /inside the review checkout/);
    bad({ SSL_CERT_DIR: `${outside}${delimiter}certs` }, /relative path/);
    bad({ SSL_CERT_DIR: `${outside}${delimiter}${repo}` }, /inside the review checkout/);
    bad({ SOME_OTHER: `./x` }, /relative path/);
    bad({ SOME_OTHER: `/ok${delimiter}../x` }, /relative path/);
  });
});

test(
  "checkEnvPaths passes absolute outside paths, a colon in a single path, empty values and plain text",
  POSIX,
  () => {
    withTree(({ repo, outside }) => {
      checkEnvPaths(
        {
          HOME: outside,
          TMPDIR: join(outside, "a:b"),
          SSL_CERT_DIR: `${outside}${delimiter}${join(outside, "x")}`,
          XDG_CACHE_HOME: "",
          LANG: "C",
          HTTPS_PROXY: "http://proxy.example:8080",
          OPENAI_BASE_URL: "http://hub",
        },
        repo,
        refuse,
      );
    });
  },
);

test(
  "a program reached through `link/..` is the one the system runs, not the one beside the link's name",
  POSIX,
  () => {
    withTree(({ repo, outside }) => {
      mkdirSync(join(repo, "sub"));
      program(join(repo, "tool"));
      program(join(outside, "tool"));
      symlinkSync(join(repo, "sub"), join(outside, "link"));
      // The system reads `link/..` as the checkout; the runtime's own realpath reads it as `outside`.
      assert.throws(
        () => resolveProgram(`${outside}/link/../tool`, [], repo, refuse),
        /inside the review checkout/,
      );
    });
  },
);

test("a --bin-dir whose name holds the PATH separator is refused", POSIX, () => {
  withTree(({ repo, outside }) => {
    const odd = join(outside, `prefix${delimiter}${join(repo, "bin")}`);
    mkdirSync(odd, { recursive: true });
    assert.throws(() => trustedDirs([odd], repo, refuse), /would split a PATH entry/);
  });
});

test("inside holds when the checkout is the file system root", POSIX, () => {
  assert.equal(inside("/", "/usr/bin"), true);
  assert.equal(inside("/", "/"), true);
});

test(
  "programFolder links each program by the name its folder gives it, canonical, first folder first, checkout entries left out",
  POSIX,
  () => {
    withTree(({ dir, repo, bin, outside }) => {
      program(join(bin, "one"));
      program(join(outside, "one"));
      program(join(outside, "two"));
      program(join(repo, "bin", "hostile"));
      symlinkSync(join(repo, "bin", "hostile"), join(bin, "hostile"));
      symlinkSync(join(outside, "two"), join(bin, "alias-two"));
      mkdirSync(join(bin, "a-folder"));
      writeFileSync(join(bin, "not-runnable"), "x", { mode: 0o644 });
      // A name whose first match is inside the checkout is taken from the next folder, never from the checkout.
      program(join(outside, "hostile"));
      const folder = programFolder([bin, outside], repo, join(dir, "links"), refuse);
      assert.equal(folder, join(dir, "links"));
      assert.equal(statSync(folder).mode & 0o777, 0o700);
      const names = readdirSync(folder).sort();
      assert.deepEqual(names, ["alias-two", "hostile", "one", "two"]);
      assert.equal(readlinkSync(join(folder, "one")), join(bin, "one"), "the first folder wins");
      assert.equal(
        readlinkSync(join(folder, "alias-two")),
        join(outside, "two"),
        "canonical target",
      );
      assert.equal(readlinkSync(join(folder, "hostile")), join(outside, "hostile"));
      assert.equal(lstatSync(join(folder, "two")).isSymbolicLink(), true);
    });
  },
);

test(
  "a bind mount of the checkout under another name is still the checkout",
  {
    skip:
      process.platform !== "linux" || spawnSync("unshare", ["-Urm", "true"]).status !== 0
        ? "needs user namespaces"
        : false,
  },
  () => {
    withTree(({ dir, repo, outside }) => {
      mkdirSync(join(outside, "alias"));
      program(join(repo, "bin", "evil"));
      const probe = join(dir, "probe.mjs");
      const module = new URL("../scripts/seat-paths.mjs", import.meta.url).href;
      writeFileSync(
        probe,
        `import { inside, resolveProgram, trustedDirs } from ${JSON.stringify(module)};
const refuse = (m) => { throw new Error(m); };
const out = { inside: inside(${JSON.stringify(repo)}, ${JSON.stringify(join(outside, "alias", "bin"))}) };
for (const [k, f] of Object.entries({
  dirs: () => trustedDirs([${JSON.stringify(join(outside, "alias", "bin"))}], ${JSON.stringify(repo)}, refuse),
  exe: () => resolveProgram(${JSON.stringify(join(outside, "alias", "bin", "evil"))}, [], ${JSON.stringify(repo)}, refuse),
})) { try { f(); out[k] = "accepted"; } catch (e) { out[k] = String(e.message); } }
console.log(JSON.stringify(out));
`,
      );
      const r = spawnSync(
        "unshare",
        [
          "-Urm",
          "sh",
          "-c",
          `mount --bind ${repo} ${join(outside, "alias")} && ${process.execPath} ${probe}`,
        ],
        { encoding: "utf8" },
      );
      assert.equal(r.status, 0, r.stderr);
      const out = JSON.parse(r.stdout);
      assert.equal(out.inside, true);
      assert.match(out.dirs, /inside the review checkout|--bin-dir/);
      assert.match(out.exe, /inside the review checkout|resolves inside/);
    });
  },
);

test("checkEnvPaths holds the agents' own configuration paths to the same rule", POSIX, () => {
  withTree(({ repo, outside }) => {
    for (const [name, value, re] of /** @type {[string, string, RegExp][]} */ ([
      ["CODEX_HOME", join(repo, "config"), /inside the review checkout/],
      ["CODEX_HOME", "relative-config", /relative path/],
      ["CLAUDE_CONFIG_DIR", join(repo, "c"), /inside the review checkout/],
      ["GOOGLE_APPLICATION_CREDENTIALS", join(repo, "login.json"), /inside the review checkout/],
      ["AWS_SHARED_CREDENTIALS_FILE", join(repo, "credentials"), /inside the review checkout/],
      ["XDG_DATA_DIRS", `${outside}${delimiter}${join(repo, "d")}`, /inside the review checkout/],
      ["SOME_URL", `file://${join(repo, "x")}`, /inside the review checkout/],
    ])) {
      assert.throws(() => checkEnvPaths({ [name]: value }, repo, refuse), re, `${name}=${value}`);
    }
    checkEnvPaths(
      { CODEX_HOME: join(outside, "codex"), SOME_URL: `file://${outside}/x` },
      repo,
      refuse,
    );
  });
});

test(
  "checkEnvPaths refuses an absolute path inside the checkout whatever the variable is called",
  POSIX,
  () => {
    withTree(({ repo, outside }) => {
      symlinkSync(join(repo, "bin"), join(outside, "into"));
      for (const [name, value] of /** @type {[string, string][]} */ ([
        ["CLAUDE_CODE_EXECUTABLE", join(repo, "bin", "claude")],
        ["CODEX_HELPER", join(repo, "helper")],
        ["CLAUDE_CODE_TOOLS", `${outside}${delimiter}${join(repo, "bin")}`],
        ["CURSOR_BINARY", join(outside, "into", "agent")],
        ["CLAUDE_TOOLS_PATH", `${outside}${delimiter}${join(repo, "bin")}`],
        ["GIO_EXTRA_MODULES", `file:${outside}${delimiter}${join(repo, "plugins")}`],
        ["GIO_EXTRA_MODULES", `http://ignored:${join(repo, "plugins")}`],
        // `C://` is a Windows drive path, not a URL scheme.
        ["SOME_URL", `C:/${join(repo, "bin")}`],
      ])) {
        assert.throws(
          () => checkEnvPaths({ [name]: value }, repo, refuse),
          /inside the review checkout/,
          `${name}=${value}`,
        );
      }
      checkEnvPaths(
        {
          CLAUDE_CODE_EXECUTABLE: join(outside, "claude"),
          CODEX_HELPER: "claude",
          CLAUDE_CODE_TOOLS: `${outside}${delimiter}${join(outside, "x")}`,
          OPENAI_BASE_URL: "http://hub:8080/v1",
        },
        repo,
        refuse,
      );
    });
  },
);

test(
  "checkEnvPaths does not read a network URL's host as a path: http://usr:8080 is not /usr",
  POSIX,
  () => {
    // The review root is /usr, so `//usr` (what splitting `http://usr:8080` on `:` leaves) is the checkout.
    checkEnvPaths(
      { HTTP_PROXY: "http://usr:8080", OPENAI_BASE_URL: "https://usr/v1" },
      "/usr",
      refuse,
    );
    assert.throws(
      () => checkEnvPaths({ SOME_LIST: "/usr" }, "/usr", refuse),
      /inside the review checkout/,
    );
  },
);

test("checkEnvPaths does not split a variable known to hold one path", POSIX, () => {
  withTree(({ repo, outside }) => {
    // A home folder named `repo:home` is not the checkout `repo`.
    mkdirSync(`${repo}:home`);
    checkEnvPaths({ HOME: `${repo}:home`, CODEX_HOME: `${repo}:home` }, repo, refuse);
    // A `*_PATH` name may be a list, so its elements are read.
    assert.throws(
      () => checkEnvPaths({ CLAUDE_TOOLS_PATH: `${outside}${delimiter}${repo}` }, repo, refuse),
      /inside the review checkout/,
    );
  });
});

test(
  "checkEnvPaths reads a file: URL the way a program does, and refuses one it cannot read",
  POSIX,
  () => {
    withTree(({ repo, outside }) => {
      for (const value of [
        `file://localhost${join(repo, "login.json")}`,
        `FILE://LOCALHOST${join(repo, "login.json")}`,
        `file:${join(repo, "login.json")}`,
        `file://${join(repo, "login.json")}`,
      ]) {
        assert.throws(
          () => checkEnvPaths({ CUSTOM_CONFIG_URL: value }, repo, refuse),
          /inside the review checkout/,
          value,
        );
      }
      for (const value of ["file://remote.example/x"]) {
        assert.throws(
          () => checkEnvPaths({ CUSTOM_CONFIG_URL: value }, repo, refuse),
          (/** @type {Error} */ e) =>
            !(e instanceof URIError) && e.message.includes("not a file URL it can read"),
          value,
        );
      }
      checkEnvPaths({ CUSTOM_CONFIG_URL: `file://localhost${outside}/x` }, repo, refuse);
      try {
        checkEnvPaths({ CUSTOM_CONFIG_URL: "file:///%ZZ" }, repo, refuse);
      } catch (e) {
        // Node refuses the escape, Bun reads it literally: either way a refusal, never an exception of its own.
        assert.ok(
          e instanceof Error &&
            !(e instanceof URIError) &&
            e.message.includes("not a file URL it can read"),
        );
      }
    });
  },
);

test("the Windows variables that hold a path are held to the same rule", POSIX, () => {
  withTree(({ repo, outside }) => {
    for (const name of [
      "APPDATA",
      "LOCALAPPDATA",
      "USERPROFILE",
      "COMSPEC",
      "PROGRAMDATA",
      "SYSTEMROOT",
      "WINDIR",
      "PROGRAMFILES",
      "PROGRAMFILES(X86)",
      "PROGRAMW6432",
    ]) {
      assert.throws(
        () => checkEnvPaths({ [name]: join(repo, "x") }, repo, refuse),
        /inside the review checkout/,
        name,
      );
      checkEnvPaths({ [name]: join(outside, "x") }, repo, refuse);
    }
  });
});

test("a --bin-dir that is a file is refused, not left for a later throw", POSIX, () => {
  withTree(({ repo, outside }) => {
    const file = join(outside, "a-file");
    writeFileSync(file, "x");
    assert.throws(() => trustedDirs([file], repo, refuse), /is not a folder/);
  });
});

test("programFolder refuses a folder whose path would split or quote the PATH", POSIX, () => {
  withTree(({ dir, repo, bin }) => {
    mkdirSync(join(dir, "a:b"));
    assert.throws(() => programFolder([bin], repo, join(dir, "a:b", "links"), refuse), /has a ":"/);
    assert.equal(programFolder([bin], repo, join(dir, "links"), refuse), join(dir, "links"));
  });
});

test("a refusal names the variable, never its value (it can be a credential)", POSIX, () => {
  withTree(({ repo }) => {
    for (const [name, value] of /** @type {Array<[string, string]>} */ ([
      ["CUSTOM_TOKEN", "../secret-value"],
      ["CODEX_HOME", "relative-secret-value"],
      ["CODEX_HOME", join(repo, "secret-value")],
      ["LOGIN_URL", "file://user:secret-value@localhost/x"],
    ])) {
      assert.throws(
        () => checkEnvPaths({ [name]: value }, repo, refuse),
        (/** @type {Error} */ e) => e.message.includes(name) && !e.message.includes("secret-value"),
        name,
      );
    }
  });
});
