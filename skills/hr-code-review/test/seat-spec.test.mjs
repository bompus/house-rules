import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import {
  PROFILES,
  SEAT_AGENTS,
  launchPreview,
  seatSpec,
  takeServerArgs,
} from "../scripts/seat-spec.mjs";
import { exeName } from "../scripts/seat-launch.mjs";

const POSIX = { skip: process.platform === "win32" ? "POSIX paths" : false };
const refuse = /** @type {(message: string) => never} */ (
  (message) => {
    throw new Error(message);
  }
);
/**
 * Runs `body` with these variables set in the client's own environment (undefined removes one).
 * @param {Record<string, string | undefined>} vars
 * @param {() => void} body
 */
function withEnv(vars, body) {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
  try {
    body();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  }
}
/**
 * A checkout (`repo`, with a hostile `bunfig.toml`, `.env` and `bin`), a trusted folder `bin` holding
 * stand-in programs, and `home` outside the checkout.
 * @param {(t: { dir: string, repo: string, bin: string, home: string }) => void} body
 */
function withTree(body) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "seat-spec-")));
  try {
    const repo = join(dir, "repo");
    const bin = join(dir, "bin");
    const home = join(dir, "home");
    mkdirSync(join(repo, ".git"), { recursive: true });
    mkdirSync(join(repo, "bin"));
    mkdirSync(bin);
    mkdirSync(home);
    for (const name of [
      "devin",
      "agy",
      "cursor-agent",
      "codex-acp",
      "runtime",
      "tool",
      "bunx",
      "npx",
    ]) {
      writeFileSync(join(bin, name), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    }
    writeFileSync(join(repo, "bin", "devin"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    body({ dir, repo, bin, home });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const HOSTILE = {
  GH_TOKEN: "t",
  OPENROUTER_API_KEY: "k",
  SSH_AUTH_SOCK: "/run/agent",
  BUN_OPTIONS: "--preload=./x.ts",
  NODE_OPTIONS: "--require ./x.js",
  LD_PRELOAD: "/x.so",
  BASH_ENV: "./x.sh",
  ANTHROPIC_API_KEY: "a",
  OPENAI_API_KEY: "o",
};
/**
 * @param {Parameters<typeof seatSpec>[0]} spec
 */
const build = (spec) => seatSpec(spec, refuse);
const base = (/** @type {{ repo: string, bin: string }} */ t) => ({
  root: t.repo,
  dirs: [t.bin],
  extraPrefixes: [],
  args: /** @type {string[]} */ ([]),
});

test("the agent names are the profile keys, and an unknown one is refused", POSIX, () => {
  assert.deepEqual(SEAT_AGENTS, ["codex", "claude", "devin", "agy", "cursor", "grok", "other"]);
  withTree((t) => {
    assert.throws(() => build({ ...base(t), agent: "bash" }), /not one of/);
    assert.throws(() => build({ ...base(t), agent: "" }), /not one of/);
  });
});

test(
  "codex, claude and other need an absolute --server-exe; devin, agy and cursor name their own program",
  POSIX,
  () => {
    withTree((t) => {
      for (const agent of ["codex", "claude", "other"]) {
        assert.throws(() => build({ ...base(t), agent }), /needs --server-exe/, agent);
      }
      assert.equal(build({ ...base(t), agent: "devin" }).cmd[0], join(t.bin, "devin"));
      assert.deepEqual(build({ ...base(t), agent: "devin" }).cmd.slice(1), ["acp"]);
      assert.deepEqual(build({ ...base(t), agent: "agy", args: ["--sandbox"] }).cmd.slice(1), [
        "acp",
        "--sandbox",
      ]);
      assert.equal(build({ ...base(t), agent: "cursor" }).cmd[0], join(t.bin, "cursor-agent"));
      assert.throws(
        () => build({ ...base(t), agent: "grok" }),
        /not in the trusted program folders/,
      );
    });
  },
);

test(
  "a program in the checkout never runs: the checkout's bin is not looked in, and a path or link into it is refused",
  POSIX,
  () => {
    withTree((t) => {
      // `devin` exists in the checkout's bin and in the trusted folder: the trusted one is used.
      assert.equal(build({ ...base(t), agent: "devin" }).cmd[0], join(t.bin, "devin"));
      assert.throws(
        () => build({ ...base(t), agent: "other", exe: join(t.repo, "bin", "devin") }),
        /inside the review checkout/,
      );
      symlinkSync(join(t.repo, "bin", "devin"), join(t.dir, "link"));
      assert.throws(
        () => build({ ...base(t), agent: "other", exe: join(t.dir, "link") }),
        /inside the review checkout/,
      );
      assert.throws(() => build({ ...base(t), agent: "other", exe: "bin/tool" }), /absolute path/);
      assert.throws(() => build({ ...base(t), agent: "other", exe: "./tool" }), /absolute path/);
      assert.throws(() => build({ ...base(t), agent: "other", exe: "tool" }), /absolute path/);
    });
  },
);

test("package runners are refused by name and by what a link resolves to", POSIX, () => {
  withTree((t) => {
    symlinkSync(join(t.bin, "npx"), join(t.bin, "innocent"));
    for (const exe of [join(t.bin, "bunx"), join(t.bin, "npx"), join(t.bin, "innocent")]) {
      assert.throws(() => build({ ...base(t), agent: "other", exe }), /package runner/, exe);
    }
  });
});

test(
  "`other` is not for an agent's own program, by name or by what a link resolves to",
  POSIX,
  () => {
    withTree((t) => {
      symlinkSync(join(t.bin, "devin"), join(t.bin, "renamed"));
      for (const name of ["devin", "agy", "codex-acp", "cursor-agent", "renamed"]) {
        assert.throws(
          () => build({ ...base(t), agent: "other", exe: join(t.bin, name) }),
          /agent's own program/,
          name,
        );
      }
      assert.doesNotThrow(() => build({ ...base(t), agent: "other", exe: join(t.bin, "tool") }));
      // Named for the agent it is, the same program is accepted under its own rules.
      assert.doesNotThrow(() =>
        build({ ...base(t), agent: "codex", exe: join(t.bin, "codex-acp") }),
      );
    });
  },
);

test(
  "a bun server runs as `bun SCRIPT`, its flags come from BUN_OPTIONS; other forms are refused",
  POSIX,
  () => {
    withTree((t) => {
      const bun = join(t.bin, "bun");
      writeFileSync(bun, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      const script = join(t.dir, "server.ts");
      writeFileSync(script, "export {};\n");
      const launch = build({ ...base(t), agent: "other", exe: bun, args: [script, "--flag"] });
      assert.deepEqual(launch.cmd, [bun, script, "--flag"], "argv is the caller's");
      assert.match(
        String(launch.env.BUN_OPTIONS),
        /^--no-env-file --no-install --config=.+empty-bunfig\.toml$/,
      );
      for (const args of [
        [],
        ["x", "pkg"],
        ["run", "s"],
        ["--config=./b.toml", "s.ts"],
        ["-c", "b", "s.ts"],
        ["test", script],
        ["server.ts"],
        [join(t.repo, "bin", "server.ts")],
      ]) {
        assert.throws(
          () => build({ ...base(t), agent: "other", exe: bun, args }),
          /bun SCRIPT/,
          args.join(" "),
        );
      }
      // A Bun reached through a link of another name is held to the same form.
      symlinkSync(bun, join(t.bin, "runtime-1.4"));
      assert.throws(
        () => build({ ...base(t), agent: "other", exe: join(t.bin, "runtime-1.4"), args: ["x"] }),
        /bun SCRIPT/,
      );
    });
  },
);

test(
  "the environment is the allowlist: PATH is the trusted folders, keys and injectors are absent",
  POSIX,
  () => {
    withTree((t) => {
      withEnv(
        { ...HOSTILE, PATH: `.${delimiter}${t.repo}/bin:/usr/bin`, HOME: t.home, LANG: "C" },
        () => {
          const env = build({ ...base(t), agent: "other", exe: join(t.bin, "tool") }).env;
          assert.equal(env.PATH, t.bin);
          assert.equal(env.HOME, t.home);
          assert.equal(env.LANG, "C");
          for (const name of Object.keys(HOSTILE)) {
            if (name !== "BUN_OPTIONS") {
              assert.equal(env[name], undefined, name);
            }
          }
          assert.match(
            String(env.BUN_OPTIONS),
            /^--no-env-file --no-install --config=.+empty-bunfig\.toml$/,
          );
          assert.doesNotMatch(String(env.BUN_OPTIONS), /preload/, "the caller's value is replaced");
          const own = build({ ...base(t), agent: "codex", exe: join(t.bin, "codex-acp") }).env;
          assert.equal(own.OPENAI_API_KEY, "o");
          assert.equal(own.ANTHROPIC_API_KEY, undefined);
          assert.match(String(own.BUN_OPTIONS), /^--no-env-file /);
        },
      );
    });
  },
);

test("a relative or checkout-inside value for a path variable stops the launch", POSIX, () => {
  withTree((t) => {
    for (const [name, value, re] of /** @type {[string, string, RegExp][]} */ ([
      ["TMPDIR", "tmp", /relative path/],
      ["XDG_CACHE_HOME", "./c", /relative path/],
      ["SSL_CERT_FILE", "ca.pem", /relative path/],
      ["HOME", join(t.repo, "home"), /inside the review checkout/],
      ["TMPDIR", join(t.repo, "tmp"), /inside the review checkout/],
    ])) {
      withEnv(
        {
          HOME: t.home,
          TMPDIR: undefined,
          XDG_CACHE_HOME: undefined,
          SSL_CERT_FILE: undefined,
          [name]: value,
        },
        () => {
          assert.throws(
            () => build({ ...base(t), agent: "other", exe: join(t.bin, "tool") }),
            re,
            `${name}=${value}`,
          );
        },
      );
    }
  });
});

test(
  "a private-start agent gets an empty private folder outside the checkout; only agy starts in the review root",
  POSIX,
  () => {
    withTree((t) => {
      withEnv({ HOME: t.home }, () => {
        for (const agent of ["devin", "other", "cursor"]) {
          const launch = build({
            ...base(t),
            agent,
            ...(agent === "other" ? { exe: join(t.bin, "tool") } : {}),
          });
          assert.equal(launch.start, "private", agent);
          assert.notEqual(launch.cwd, t.repo);
          assert.deepEqual(readdirSync(launch.cwd), [], "empty");
          assert.equal(statSync(launch.cwd).mode & 0o777, 0o700);
          assert.equal(launch.cwd.startsWith(t.repo), false);
        }
        assert.deepEqual(
          [build({ ...base(t), agent: "agy" }).start, build({ ...base(t), agent: "agy" }).cwd],
          ["root", t.repo],
        );
        assert.equal(PROFILES.grok?.start, "private");
        assert.equal(PROFILES.cursor?.start, "private");
      });
    });
  },
);

test(
  "the temporary folder inside the checkout stops the launch (checked in a fresh process)",
  POSIX,
  () => {
    withTree((t) => {
      const script = join(t.dir, "inside.mjs");
      writeFileSync(
        script,
        `import { seatSpec } from ${JSON.stringify(new URL("../scripts/seat-spec.mjs", import.meta.url).href)};
try {
  seatSpec({ agent: "devin", root: ${JSON.stringify(t.repo)}, dirs: [${JSON.stringify(t.bin)}], args: [], extraPrefixes: [] }, (m) => { throw new Error(m); });
  console.log("launched");
} catch (e) { console.log(String(e.message)); }
`,
      );
      mkdirSync(join(t.repo, "tmp"));
      const out = spawnSync(process.execPath, [script], {
        env: { PATH: process.env.PATH ?? "", HOME: t.home, TMPDIR: join(t.repo, "tmp") },
        encoding: "utf8",
      });
      assert.match(out.stdout, /inside the review checkout/, out.stdout + out.stderr);
    });
  },
);

test(
  "a seat started from the spec reads nothing from the checkout: no .env, no bunfig preload, empty or root folder alike",
  {
    skip:
      process.platform === "win32" || exeName(process.execPath) !== "bun"
        ? "needs Bun on POSIX"
        : false,
  },
  () => {
    withTree((t) => {
      const sentinel = join(t.dir, "preload-ran");
      writeFileSync(
        join(t.repo, "pre.ts"),
        `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(sentinel)}, "x");\n`,
      );
      writeFileSync(join(t.repo, "bunfig.toml"), `preload = ["./pre.ts"]\n`);
      writeFileSync(join(t.repo, ".env"), `FROM_DOTENV=1\nHOME=/stolen\n`);
      const server = join(t.dir, "server.mjs");
      writeFileSync(
        server,
        `console.log(JSON.stringify({ cwd: process.cwd(), env: process.env, argv: process.argv }));\n`,
      );
      withEnv(
        { HOME: t.home, BUN_OPTIONS: `--preload=${join(t.repo, "pre.ts")}`, GH_TOKEN: "t" },
        () => {
          for (const agent of ["other", "cursor"]) {
            const launch = build({
              ...base(t),
              agent,
              exe: process.execPath,
              args: [server],
            });
            const run = spawnSync(launch.cmd[0] ?? "", launch.cmd.slice(1), {
              cwd: launch.cwd,
              env: launch.env,
              encoding: "utf8",
            });
            assert.equal(run.status, 0, run.stderr);
            const seen = JSON.parse(run.stdout);
            assert.equal(
              existsSync(sentinel),
              false,
              `${agent}: the checkout's preload did not run`,
            );
            assert.equal(seen.env.FROM_DOTENV, undefined, agent);
            assert.equal(seen.env.HOME, t.home, `${agent}: HOME is the caller's, not the .env's`);
            assert.equal(seen.env.GH_TOKEN, undefined);
            assert.match(String(seen.env.BUN_OPTIONS), /^--no-env-file --no-install --config=/);
            assert.equal(seen.env.PATH, t.bin);
            assert.equal(realpathSync(seen.cwd), realpathSync(launch.cwd));
          }
        },
      );
    });
  },
);

test("launchPreview is the command as the caller wrote it, and takeServerArgs reads both forms in order", () => {
  assert.deepEqual(launchPreview("devin", "", ["--x"]), ["devin", "acp", "--x"]);
  assert.deepEqual(launchPreview("codex", "/a/codex-acp", []), ["/a/codex-acp"]);
  const argv = [
    "--server-arg",
    "one",
    "--server-arg=--two",
    "prompt",
    "--server-arg",
    "--no-web",
    "out",
  ];
  assert.deepEqual(takeServerArgs(argv), ["one", "--two"]);
  assert.deepEqual(
    argv,
    ["prompt", "--server-arg", "--no-web", "out"],
    "a flag-like value is left for the usage check",
  );
});

test(
  "a wrapper program is refused as a server, by its name and by what a link resolves to",
  POSIX,
  () => {
    withTree((t) => {
      for (const name of ["env", "sh", "bash", "xargs", "nohup", "timeout"]) {
        writeFileSync(join(t.bin, name), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      }
      symlinkSync(join(t.bin, "env"), join(t.bin, "plain-name"));
      for (const name of ["env", "sh", "bash", "xargs", "nohup", "timeout", "plain-name"]) {
        for (const agent of ["other", "codex", "devin"]) {
          assert.throws(
            () => build({ ...base(t), agent, exe: join(t.bin, name), args: ["-c", "agy acp"] }),
            /starts another program/,
            `${agent} ${name}`,
          );
        }
      }
    });
  },
);

test(
  "whatever prefixes are passed, no injector reaches the seat and BUN_OPTIONS is the client's",
  POSIX,
  () => {
    withTree((t) => {
      withEnv(
        {
          HOME: t.home,
          BUN_OPTIONS: "--preload=/outside/p.ts",
          NODE_OPTIONS: "--require /outside/r.js",
          NODE_PATH: "/outside",
          BASH_ENV: "/outside/b.sh",
          ENV: "/outside/e.sh",
          LD_PRELOAD: "/outside/x.so",
          LD_LIBRARY_PATH: "/outside",
          DYLD_INSERT_LIBRARIES: "/outside/x.dylib",
        },
        () => {
          const env = build({
            ...base(t),
            extraPrefixes: ["BUN_", "NODE_", "BASH_", "ENV", "LD_", "DYLD_"],
            agent: "other",
            exe: join(t.bin, "tool"),
          }).env;
          for (const name of [
            "NODE_OPTIONS",
            "NODE_PATH",
            "BASH_ENV",
            "ENV",
            "LD_PRELOAD",
            "LD_LIBRARY_PATH",
            "DYLD_INSERT_LIBRARIES",
          ]) {
            assert.equal(env[name], undefined, name);
          }
          assert.match(
            String(env.BUN_OPTIONS),
            /^--no-env-file --no-install --config=.+empty-bunfig\.toml$/,
          );
        },
      );
    });
  },
);

test(
  "a Bun reached through a #! line starts reading nothing from the review root, in a root-start seat too",
  {
    skip:
      process.platform === "win32" || exeName(process.execPath) !== "bun"
        ? "needs Bun on POSIX"
        : false,
  },
  () => {
    withTree((t) => {
      const sentinel = join(t.dir, "preload-ran");
      writeFileSync(join(t.repo, "pre.ts"), `await Bun.write(${JSON.stringify(sentinel)}, "x");\n`);
      writeFileSync(join(t.repo, "bunfig.toml"), `preload = ["./pre.ts"]\n`);
      writeFileSync(join(t.repo, ".env"), `FROM_DOTENV=1\n`);
      // A program of the trusted folder whose #! line names bun, started for an agent that starts in the root.
      writeFileSync(
        join(t.bin, "agy"),
        `#!/usr/bin/env bun\nconsole.log(JSON.stringify({ d: process.env.FROM_DOTENV ?? null }));\n`,
        { mode: 0o755 },
      );
      withEnv({ HOME: t.home }, () => {
        const launch = build({
          ...base(t),
          dirs: [t.bin, dirname(process.execPath)],
          agent: "agy",
        });
        assert.equal(launch.start, "root");
        const run = spawnSync(launch.cmd[0] ?? "", launch.cmd.slice(1), {
          cwd: launch.cwd,
          env: launch.env,
          encoding: "utf8",
        });
        assert.equal(run.status, 0, run.stderr);
        assert.deepEqual(JSON.parse(run.stdout), { d: null });
        assert.equal(existsSync(sentinel), false, "the checkout's preload did not run");
      });
    });
  },
);

test(
  "a wrapper behind a link whose target goes through `hop/..` is found where the system finds it",
  POSIX,
  () => {
    withTree((t) => {
      // /T/entry -> hop/../alias, /T/hop -> /T/real/sub, /T/real/alias -> env, /T/real/env -> a copy of env.
      // Read as text, `hop/../alias` is /T/alias, which does not exist; the system reads it as /T/real/alias.
      const root = join(t.dir, "T");
      mkdirSync(join(root, "real", "sub"), { recursive: true });
      writeFileSync(join(root, "native"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      symlinkSync(join(root, "native"), join(root, "real", "env"));
      symlinkSync("env", join(root, "real", "alias"));
      symlinkSync(join(root, "real", "sub"), join(root, "hop"));
      symlinkSync("hop/../alias", join(root, "entry"));
      for (const agent of ["other", "codex"]) {
        assert.throws(
          () => build({ ...base(t), agent, exe: join(root, "entry"), args: ["PATH=/x", "/y"] }),
          /starts another program/,
          agent,
        );
      }
    });
  },
);

test("a bun server's script is returned as the canonical file that was checked", POSIX, () => {
  withTree((t) => {
    const bun = join(t.bin, "bun");
    writeFileSync(bun, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const real = join(t.dir, "server.mjs");
    writeFileSync(real, "export {};\n");
    const alias = join(t.dir, "alias.mjs");
    symlinkSync(real, alias);
    const launch = build({ ...base(t), agent: "other", exe: bun, args: [alias, "--flag"] });
    assert.deepEqual(launch.cmd, [bun, real, "--flag"], "a link swapped later changes nothing");
  });
});

test("an interpreter's start-up variables are dropped whatever prefix names them", POSIX, () => {
  withTree((t) => {
    const names = [
      "PYTHONUSERBASE",
      "PYTHONPLATLIBDIR",
      "RUBYGEMS_GEMDEPS",
      "GEM_HOME",
      "GEM_PATH",
      "PERL5LIB",
    ];
    withEnv(Object.fromEntries(names.map((n) => [n, "/outside/x"])), () => {
      const env = build({
        ...base(t),
        extraPrefixes: ["PYTHON", "RUBY", "GEM_", "PERL"],
        agent: "other",
        exe: join(t.bin, "tool"),
      }).env;
      for (const name of names) {
        assert.equal(env[name], undefined, name);
      }
    });
  });
});

test(
  "an agent's or runner's name reached through the script a runtime starts is refused",
  POSIX,
  () => {
    withTree((t) => {
      const node = join(t.bin, "node");
      writeFileSync(node, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      const out = join(t.dir, "scripts");
      mkdirSync(out);
      writeFileSync(join(out, "codex-acp.mjs"), "export {};\n");
      writeFileSync(join(out, "npx-cli.js"), "export {};\n", { mode: 0o755 });
      symlinkSync(join(out, "codex-acp.mjs"), join(out, "client.mjs"));
      for (const [script, message] of /** @type {Array<[string, RegExp]>} */ ([
        ["client.mjs", /agent's own program/],
        ["npx-cli.js", /package runner/],
      ])) {
        assert.throws(
          () => build({ ...base(t), agent: "other", exe: node, args: [join(out, script)] }),
          message,
          script,
        );
      }
      // A program that is a link to the runner's script, under an unrelated name.
      symlinkSync(join(out, "npx-cli.js"), join(t.bin, "innocent"));
      assert.throws(
        () => build({ ...base(t), agent: "other", exe: join(t.bin, "innocent") }),
        /package runner/,
      );
    });
  },
);

test("Windows shells start another program, so they are wrappers", POSIX, () => {
  withTree((t) => {
    for (const name of ["cmd", "cmd.exe", "cmd.com", "powershell", "pwsh", "wsl"]) {
      writeFileSync(join(t.bin, name), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      assert.throws(
        () => build({ ...base(t), agent: "other", exe: join(t.bin, name), args: ["/c", "x"] }),
        /starts another program/,
        name,
      );
    }
  });
});

test("a private folder whose path BUN_OPTIONS or PATH cannot carry stops the client", POSIX, () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "seat-private-")));
  try {
    const probe = `import { privateDir } from ${JSON.stringify(new URL("../scripts/seat-launch.mjs", import.meta.url).href)};
try { console.log("ok " + privateDir()); } catch (e) { console.log("refused " + e.message); }`;
    for (const [name, ok] of [
      ["with space", false],
      ["with\ttab", false],
      ["with'quote", false],
      ['with"quote', false],
      ["with:colon", false],
      ["plain", true],
    ]) {
      mkdirSync(join(dir, String(name)));
      const r = spawnSync(process.execPath, ["-e", probe], {
        env: { ...process.env, TMPDIR: join(dir, String(name)) },
        encoding: "utf8",
      });
      assert.match(r.stdout, ok ? /^ok / : /^refused .*TMPDIR/, String(name));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test(
  "a node or deno server is held to the same form as bun: the script first, absolute, outside the checkout",
  POSIX,
  () => {
    withTree((t) => {
      const script = join(t.dir, "server.mjs");
      writeFileSync(script, "export {};\n");
      const alias = join(t.dir, "alias.mjs");
      symlinkSync(script, alias);
      const inRepo = join(t.repo, "server.mjs");
      writeFileSync(inRepo, "export {};\n");
      for (const name of ["node", "deno"]) {
        const exe = join(t.bin, name);
        writeFileSync(exe, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
        const lead = name === "deno" ? ["run", "--allow-read"] : [];
        const launch = build({ ...base(t), agent: "other", exe, args: [...lead, alias, "--flag"] });
        assert.deepEqual(
          launch.cmd,
          [exe, ...lead, script, "--flag"],
          `${name}: the canonical script`,
        );
        for (const args of [
          [],
          [inRepo],
          ["server.mjs"],
          ["--require", script, script],
          ...(name === "deno"
            ? [
                [script],
                ["x", script],
                ["run", inRepo],
                ["run", "--config", "./d.json", script],
                ["run", "--preload", script, inRepo],
                ["run", "--allow-env", "--config", script, inRepo],
                ["run", "--preload=/x/y.ts", script],
                ["run", "--import-map", "m.json", script],
                ["run", "--allow-scripts", script],
                ["run", "--allow-scripts=npm:x", script],
                ["run", "--import-map", script, script],
              ]
            : []),
        ]) {
          assert.throws(
            () => build({ ...base(t), agent: "other", exe, args }),
            new RegExp(`${name} server must be started as`),
            `${name} ${args.join(" ")}`,
          );
        }
      }
    });
  },
);

test("a deno server's script is held to the runner and agent-name guards too", POSIX, () => {
  withTree((t) => {
    const deno = join(t.bin, "deno");
    writeFileSync(deno, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const out = join(t.dir, "scripts");
    mkdirSync(out);
    writeFileSync(join(out, "npx-cli.js"), "export {};\n");
    writeFileSync(join(out, "codex-acp.mjs"), "export {};\n");
    assert.throws(
      () =>
        build({ ...base(t), agent: "other", exe: deno, args: ["run", join(out, "npx-cli.js")] }),
      /package runner/,
    );
    assert.throws(
      () =>
        build({
          ...base(t),
          agent: "other",
          exe: deno,
          args: ["run", "--allow-read", join(out, "codex-acp.mjs")],
        }),
      /agent's own program/,
    );
  });
});

test("exeName drops every Windows executable suffix a lookup tries", () => {
  for (const name of ["cmd.exe", "cmd.com", "CMD.COM", "x.bat", "x.cmd"]) {
    assert.equal(exeName(`C:\\tools\\${name}`), exeName(name));
  }
  assert.equal(exeName("C:\\tools\\node.com"), "node");
});

test("no argument may name a path in the checkout, for any program", POSIX, () => {
  withTree((t) => {
    for (const args of [
      [join(t.repo, "adapter.py")],
      ["--config=" + join(t.repo, "c.toml")],
      ["-x", join(t.repo, "bin", "evil")],
      [join(t.repo, "does", "not", "exist.rb")],
    ]) {
      assert.throws(
        () => build({ ...base(t), agent: "other", exe: join(t.bin, "tool"), args }),
        /server argument \d+ names a path inside the review checkout/,
        args.join(" "),
      );
    }
    // An outside path, a relative one (read from the private folder) and a bare word are fine.
    build({
      ...base(t),
      agent: "other",
      exe: join(t.bin, "tool"),
      args: [join(t.dir, "x"), "rel/x", "word"],
    });
  });
});

test(
  "a server script outside the checkout whose #! line names a program inside it is refused",
  POSIX,
  () => {
    withTree((t) => {
      const hostile = join(t.bin, "server-a");
      writeFileSync(hostile, `#!${join(t.repo, "bin", "python")}\nprint(1)\n`, { mode: 0o755 });
      assert.throws(
        () => build({ ...base(t), agent: "other", exe: hostile }),
        /#!.*which is inside the review checkout/,
      );
      for (const [name, line] of /** @type {Array<[string, string]>} */ ([
        ["server-b", "#!/bin/sh"],
        ["server-c", "#!/usr/bin/env sh"],
        ["server-d", "no shebang"],
      ])) {
        const ok = join(t.bin, name);
        writeFileSync(ok, `${line}\nexit 0\n`, { mode: 0o755 });
        build({ ...base(t), agent: "other", exe: ok });
      }
    });
  },
);

test("npm and the other package managers are refused as a server, by name or script", POSIX, () => {
  withTree((t) => {
    for (const name of ["npm", "pnpm", "yarn", "corepack", "npm-cli.js"]) {
      writeFileSync(join(t.bin, name), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      assert.throws(
        () =>
          build({
            ...base(t),
            agent: "other",
            exe: join(t.bin, name),
            args: ["exec", "--yes", "--", "pkg"],
          }),
        /package runner/,
        name,
      );
    }
  });
});

test("the profile's arguments follow an interpreter's script", POSIX, () => {
  withTree((t) => {
    const node = join(t.bin, "node");
    writeFileSync(node, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const script = join(t.dir, "devin.js");
    writeFileSync(script, "export {};\n");
    const launch = build({ ...base(t), agent: "devin", exe: node, args: [script, "--flag"] });
    assert.deepEqual(launch.cmd, [node, script, "acp", "--flag"]);
    const deno = join(t.bin, "deno");
    writeFileSync(deno, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const run = build({
      ...base(t),
      agent: "devin",
      exe: deno,
      args: ["run", "--allow-read", script],
    });
    assert.deepEqual(run.cmd, [deno, "run", "--allow-read", script, "acp"]);
  });
});
