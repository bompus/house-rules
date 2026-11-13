import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  codexWrapper,
  devinConfig,
  gitEnvironment,
  gitProgram,
  seatEnv,
} from "../scripts/seat-launch.mjs";

const ENV = {
  PATH: "/bin",
  HOME: "/home/u",
  LC_ALL: "C",
  XDG_CACHE_HOME: "/c",
  SSH_AUTH_SOCK: "/run/agent",
  GH_TOKEN: "t",
  OPENROUTER_API_KEY: "k",
  ANTHROPIC_AUTH_TOKEN: "a",
  CLAUDE_CONFIG_DIR: "/home/u/.claude_hub",
  CODEX_HOME: "/home/u/.codex_hub",
  OPENAI_BASE_URL: "http://hub",
  DEVIN_MODEL: "swe-2-max",
};

// On Windows, names are matched without regard to case and a base list is added; these tests
// describe the POSIX shape, which is also what the client's other tests run on Linux and macOS.
const POSIX = { skip: process.platform === "win32" ? "POSIX environment names" : false };
test("a seat keeps paths and locale and drops keys, tokens and the SSH agent", POSIX, () => {
  const env = seatEnv(ENV, "", []);
  assert.deepEqual(Object.keys(env).sort(), ["HOME", "LC_ALL", "PATH", "XDG_CACHE_HOME"]);
});
test(
  "a Claude seat keeps the names its adapter and SDK read to log in, and no other CLAUDE_ name",
  POSIX,
  () => {
    const env = seatEnv(
      {
        ANTHROPIC_API_KEY: "k",
        CLAUDE_CONFIG_DIR: "/c",
        CLAUDE_CODE_OAUTH_TOKEN: "t",
        CLAUDE_CODE_USE_BEDROCK: "1",
        CLAUDE_CODE_USE_VERTEX: "1",
        CLAUDE_CODE_EXECUTABLE: "/x/claude",
        CLAUDE_CODE_SHELL: "/x/bash",
        CLAUDE_CODE_SHELL_PREFIX: "wrap",
        CLAUDE_CODE_SHELL_LAUNCHER_SCRIPT: "/r/s.sh",
        CLAUDE_CODE_TEAMMATE_COMMAND: "x",
        CLAUDE_RUNNER_CLAUDE_BIN: "/r/claude",
        CLAUDE_SSH_LOCAL_BINARY: "/r/ssh",
        CLAUDE_CODE_EFFORT_LEVEL: "max",
        CLAUDE_SECURESTORAGE_CONFIG_DIR: "/s",
        CLAUDE_CODE_CLIENT_CERT: "/c.pem",
        CLAUDE_CODE_CLIENT_KEY: "/k.pem",
        CLAUDE_CODE_CLIENT_KEY_PASSPHRASE: "p",
        CLAUDE_CODE_SKIP_BEDROCK_AUTH: "1",
        CLAUDE_CODE_SKIP_VERTEX_AUTH: "1",
      },
      "claude",
      [],
    );
    assert.deepEqual(Object.keys(env).sort(), [
      "ANTHROPIC_API_KEY",
      "CLAUDE_CODE_CLIENT_CERT",
      "CLAUDE_CODE_CLIENT_KEY",
      "CLAUDE_CODE_CLIENT_KEY_PASSPHRASE",
      "CLAUDE_CODE_EXECUTABLE",
      "CLAUDE_CODE_OAUTH_TOKEN",
      "CLAUDE_CODE_SHELL",
      "CLAUDE_CODE_SKIP_BEDROCK_AUTH",
      "CLAUDE_CODE_SKIP_VERTEX_AUTH",
      "CLAUDE_CODE_USE_BEDROCK",
      "CLAUDE_CODE_USE_VERTEX",
      "CLAUDE_CONFIG_DIR",
      "CLAUDE_SECURESTORAGE_CONFIG_DIR",
    ]);
  },
);
test(
  "a name that holds a command line is never passed, whatever prefix lets it through",
  POSIX,
  () => {
    const env = seatEnv(
      {
        FAKE_COMMAND: "x y",
        FAKE_SHELL_PREFIX: "wrap",
        FAKE_KEEP: "1",
        FAKE_HELPER: "h",
        FAKE_AUTH_REFRESH: "r",
        GROK_AUTH_PROVIDER_COMMAND: "c",
        GROK_HOME: "/g",
      },
      "grok",
      ["FAKE_"],
    );
    assert.deepEqual(Object.keys(env).sort(), ["FAKE_KEEP", "GROK_HOME"]);
  },
);
test(
  "a Codex seat keeps MODEL_PROVIDER, which codex-acp passes to Codex, and no other seat does",
  POSIX,
  () => {
    const env = {
      ...ENV,
      MODEL_PROVIDER: "gateway",
      DEFAULT_AUTH_REQUEST: "{}",
      INITIAL_AGENT_MODE: "agent",
    };
    assert.equal(seatEnv(env, "codex", []).MODEL_PROVIDER, "gateway");
    assert.equal(seatEnv(env, "claude", []).MODEL_PROVIDER, undefined);
    assert.equal(seatEnv(env, "", []).MODEL_PROVIDER, undefined);
    // The client sets the Codex seat's mode itself, and the auth request is not part of this change.
    assert.equal(seatEnv(env, "codex", []).INITIAL_AGENT_MODE, undefined);
    assert.equal(seatEnv(env, "codex", []).DEFAULT_AUTH_REQUEST, undefined);
  },
);
test("each agent keeps only its own login variables", POSIX, () => {
  const claude = seatEnv(ENV, "claude", []);
  assert.equal(claude.ANTHROPIC_AUTH_TOKEN, "a");
  assert.equal(claude.CLAUDE_CONFIG_DIR, "/home/u/.claude_hub");
  assert.equal(claude.CODEX_HOME, undefined);
  const codex = seatEnv(ENV, "codex", []);
  assert.equal(codex.CODEX_HOME, "/home/u/.codex_hub");
  assert.equal(codex.OPENAI_BASE_URL, "http://hub");
  assert.equal(codex.ANTHROPIC_AUTH_TOKEN, undefined);
  const devin = seatEnv(ENV, "devin", []);
  assert.equal(devin.DEVIN_MODEL, "swe-2-max");
  assert.equal(devin.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.equal(devin.OPENROUTER_API_KEY, undefined);
});
test("the caller's pass-through prefixes are added and empty entries ignored", POSIX, () => {
  const env = seatEnv({ ...ENV, FAKE_MODE: "x" }, "", ["FAKE_", ""]);
  assert.equal(env.FAKE_MODE, "x");
  assert.equal(env.GH_TOKEN, undefined);
});
test("the agent is the one named, never taken from a path or other text", POSIX, () => {
  const env = seatEnv(ENV, "devin", []);
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.equal(env.CODEX_HOME, undefined);
  assert.equal(env.DEVIN_MODEL, "swe-2-max");
});
test("infrastructure variables are named, not matched by prefix", POSIX, () => {
  const env = seatEnv(
    { ...ENV, BUN_AUTH_TOKEN: "s", BUN_CONFIG_TOKEN: "s", XDG_SECRET: "s", BUN_INSTALL: "/b" },
    "",
    [],
  );
  assert.equal(env.BUN_AUTH_TOKEN, undefined);
  assert.equal(env.BUN_CONFIG_TOKEN, undefined);
  assert.equal(env.XDG_SECRET, undefined);
  assert.equal(env.BUN_INSTALL, undefined, "no package runner runs at review time");
});
test(
  "a Bedrock Claude seat keeps its AWS variables, and no other seat or switch does",
  POSIX,
  () => {
    const aws = {
      ...ENV,
      CLAUDE_CODE_USE_BEDROCK: "1",
      AWS_REGION: "us-east-1",
      AWS_ACCESS_KEY_ID: "k",
    };
    assert.equal(seatEnv(aws, "claude", []).AWS_REGION, "us-east-1");
    assert.equal(seatEnv(aws, "devin", []).AWS_ACCESS_KEY_ID, undefined);
    assert.equal(seatEnv(ENV, "claude", []).AWS_REGION, undefined);
    for (const value of ["0", "false", ""]) {
      assert.equal(
        seatEnv({ ...aws, CLAUDE_CODE_USE_BEDROCK: value }, "claude", []).AWS_ACCESS_KEY_ID,
        undefined,
      );
    }
  },
);
test("a Vertex Claude seat keeps its Google credential path and region", POSIX, () => {
  const gcp = {
    ...ENV,
    CLAUDE_CODE_USE_VERTEX: "1",
    GOOGLE_APPLICATION_CREDENTIALS: "/k.json",
    CLOUD_ML_REGION: "us-east5",
    GOOGLE_OTHER: "x",
  };
  const env = seatEnv(gcp, "claude", []);
  assert.equal(env.GOOGLE_APPLICATION_CREDENTIALS, "/k.json");
  assert.equal(env.CLOUD_ML_REGION, "us-east5");
  assert.equal(env.GOOGLE_OTHER, undefined);
});
function withDevinDirs(/** @type {(dir: string) => void} */ body) {
  const dir = mkdtempSync(join(tmpdir(), "seat-launch-devin-"));
  const before = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = join(dir, "xdg-empty");
  try {
    body(dir);
  } finally {
    if (before === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = before;
    }
    rmSync(dir, { recursive: true, force: true });
  }
}
const refuseWith = (/** @type {string} */ message) => {
  throw new Error(message);
};

test("--config goes right after Devin's executable", POSIX, () => {
  withDevinDirs((dir) => {
    const out = devinConfig(["/usr/bin/devin", "acp", "--model", "m"], false, dir, refuseWith);
    assert.equal(out[0], "/usr/bin/devin");
    assert.equal(out[1], "--config");
    assert.deepEqual(out.slice(3), ["acp", "--model", "m"]);
  });
});
test("Devin's cloud mode, which runs the session remotely, is refused", POSIX, () => {
  withDevinDirs((dir) => {
    for (const cmd of [
      ["devin", "acp", "--cloud"],
      ["devin", "acp", "--cloud=true"],
      ["devin", "cloud"],
    ]) {
      assert.throws(() => devinConfig(cmd, false, dir, refuseWith), /cloud mode/, cmd.join(" "));
    }
    assert.doesNotThrow(() => devinConfig(["devin", "acp"], false, dir, refuseWith));
  });
});
test(
  "the Codex program is held to the same rule: CODEX_PATH inside the checkout or relative is refused, a bare name skips the checkout's bin, the canonical outside path runs",
  { skip: process.platform === "win32" },
  () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-lookup-"));
    try {
      const root = join(dir, "root");
      const trusted = join(dir, "trusted");
      mkdirSync(join(root, "bin"), { recursive: true });
      mkdirSync(trusted);
      const mark = join(dir, "checkout-codex-ran");
      writeFileSync(join(root, "bin", "codex"), `#!/bin/sh\n: > "${mark}"\necho '[]'\n`, {
        mode: 0o755,
      });
      writeFileSync(join(trusted, "codex-real"), "#!/bin/sh\necho '[]'\n", { mode: 0o755 });
      symlinkSync(join(trusted, "codex-real"), join(trusted, "codex"));
      const refuse = /** @type {(m: string) => never} */ (
        (m) => {
          throw new Error(m);
        }
      );
      const path = trusted;
      const wrap = (/** @type {string | undefined} */ given) =>
        codexWrapper(
          { PATH: path, ...(given === undefined ? {} : { CODEX_PATH: given }) },
          false,
          root,
          [trusted],
          refuse,
        );
      for (const given of ["./bin/codex", join(root, "bin", "codex")]) {
        assert.throws(() => wrap(given), /inside the review checkout|relative path/, given);
      }
      for (const given of [undefined, "codex", join(trusted, "codex")]) {
        const out = wrap(given);
        assert.equal(
          realpathSync(String(out.CODEX_NO_WEB_REAL)),
          realpathSync(join(trusted, "codex-real")),
          String(given),
        );
        assert.match(readFileSync(String(out.CODEX_PATH), "utf8"), /^#!\/bin\/sh\n/);
      }
      assert.equal(existsSync(mark), false, "the checkout's codex never ran");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
/**
 * Runs a script that makes the private folder, puts a file in it, and then keeps its event loop busy
 * (a long copy) until this test has sent `signal`, after the folder exists, and released it.
 * @param {"plain" | "own" | "throw"} mode
 * @param {NodeJS.Signals | undefined} signal
 */
async function privateFolderRun(mode, signal) {
  const dir = mkdtempSync(join(process.env.HOUSE_RULES_TEST_TMP || tmpdir(), "private-run-"));
  try {
    const module = fileURLToPath(new URL("../scripts/seat-launch.mjs", import.meta.url));
    const script = join(dir, "run.mjs");
    writeFileSync(
      script,
      `import { privateDir } from ${JSON.stringify(module)};
import { existsSync, writeFileSync } from "node:fs";
const folder = privateDir();
writeFileSync(folder + "/login-copy", "secret");
console.log(folder);
if (${JSON.stringify(mode)} === "own") process.on("SIGTERM", () => process.exit(7));
if (${JSON.stringify(mode)} === "throw") throw new Error("boom");
const go = ${JSON.stringify(join(dir, "go"))};
const deadline = Date.now() + 20000;
while (!existsSync(go) && Date.now() < deadline) {}
`,
    );
    const child = spawn(process.execPath, [script], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let released = false;
    child.stdout.on("data", (/** @type {Buffer} */ d) => {
      out += d;
      if (out.includes("\n") && !released) {
        released = true;
        // The signal is sent while the child spins; the file that ends the spin follows it, so the
        // child meets the signal at its next turn of the event loop however long the parent took.
        if (signal) {
          child.kill(signal);
        }
        writeFileSync(join(dir, "go"), "");
      }
    });
    const code = await new Promise((resolve) => child.on("close", (c, sig) => resolve(c ?? sig)));
    const folder = out.trim().split("\n")[0] ?? "";
    return { code, folder, left: folder !== "" && existsSync(folder) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
test(
  "a stop that arrives while the private folder is being filled still removes it",
  { skip: process.platform === "win32", timeout: 30000 },
  async () => {
    for (const [signal, code] of /** @type {const} */ ([
      ["SIGTERM", 143],
      ["SIGINT", 130],
      ["SIGHUP", 129],
    ])) {
      const r = await privateFolderRun("plain", signal);
      assert.equal(r.code, code, signal);
      assert.notEqual(r.folder, "");
      assert.equal(r.left, false, `${signal}: the folder is gone`);
    }
    const finished = await privateFolderRun("plain", undefined);
    assert.equal(finished.code, 0);
    assert.equal(finished.left, false, "normal exit");
    const thrown = await privateFolderRun("throw", undefined);
    assert.notEqual(thrown.code, 0);
    assert.equal(thrown.left, false, "uncaught exception");
  },
);
test(
  "the startup stop handler stands aside once the client installs its own",
  { skip: process.platform === "win32", timeout: 30000 },
  async () => {
    const r = await privateFolderRun("own", "SIGTERM");
    assert.equal(r.code, 7, "the later handler decided the exit");
    assert.equal(r.left, false);
  },
);

test(
  "git comes from the trusted program folders only, and none there is a missing program",
  POSIX,
  () => {
    const dir = mkdtempSync(join(tmpdir(), "seat-launch-git-"));
    try {
      const root = join(dir, "root");
      const trusted = join(dir, "trusted");
      mkdirSync(root);
      mkdirSync(trusted);
      assert.throws(
        () => gitProgram([trusted], root),
        (e) => /** @type {NodeJS.ErrnoException} */ (e).code === "ENOENT",
      );
      writeFileSync(join(trusted, "git"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      assert.equal(gitProgram([trusted], root), join(trusted, "git"));
      const env = gitEnvironment(trusted);
      assert.equal(env.PATH, trusted);
      assert.equal(env.LC_ALL, "C");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
