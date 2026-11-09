import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bunHardened,
  cleanPath,
  codexWrapper,
  devinConfig,
  envPath,
  exeName,
  mayStart,
  mayStartAgy,
  pathExecutable,
  reviewBase,
  seatAgent,
  seatEnv,
} from "../scripts/seat-launch.mjs";
import { absoluteFirst } from "../scripts/seat-hooks.mjs";

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
const CODEX = ["bunx", "--package=@agentclientprotocol/codex-acp@2.5.0", "codex-acp"];
const CLAUDE = [
  "bunx",
  "--package=@agentclientprotocol/claude-agent-acp@0.101.0",
  "claude-agent-acp",
];
// On Windows, names are matched without regard to case and a base list is added; these tests
// describe the POSIX shape, which is also what the client's other tests run on Linux and macOS.
const POSIX = { skip: process.platform === "win32" ? "POSIX environment names" : false };

test("a seat keeps paths and locale and drops keys, tokens and the SSH agent", POSIX, () => {
  const env = seatEnv(ENV, ["some-agent", "acp"], []);
  assert.deepEqual(Object.keys(env).sort(), ["HOME", "LC_ALL", "PATH", "XDG_CACHE_HOME"]);
});
test("each agent keeps only its own login variables", POSIX, () => {
  const claude = seatEnv(ENV, CLAUDE, []);
  assert.equal(claude.ANTHROPIC_AUTH_TOKEN, "a");
  assert.equal(claude.CLAUDE_CONFIG_DIR, "/home/u/.claude_hub");
  assert.equal(claude.CODEX_HOME, undefined);
  const codex = seatEnv(ENV, CODEX, []);
  assert.equal(codex.CODEX_HOME, "/home/u/.codex_hub");
  assert.equal(codex.OPENAI_BASE_URL, "http://hub");
  assert.equal(codex.ANTHROPIC_AUTH_TOKEN, undefined);
  const devin = seatEnv(ENV, ["devin", "acp", "--model", "swe-2-max"], []);
  assert.equal(devin.DEVIN_MODEL, "swe-2-max");
  assert.equal(devin.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.equal(devin.OPENROUTER_API_KEY, undefined);
});
test("the caller's pass-through prefixes are added and empty entries ignored", POSIX, () => {
  const env = seatEnv({ ...ENV, FAKE_MODE: "x" }, ["agent"], ["FAKE_", ""]);
  assert.equal(env.FAKE_MODE, "x");
  assert.equal(env.GH_TOKEN, undefined);
});
test("ordinary arguments never select an agent's credentials", POSIX, () => {
  const env = seatEnv(ENV, ["devin", "acp", "--cwd", "/repo/codex-claude-migration"], []);
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.equal(env.CODEX_HOME, undefined);
  assert.equal(env.DEVIN_MODEL, "swe-2-max");
});
test("infrastructure variables are named, not matched by prefix", POSIX, () => {
  const env = seatEnv(
    { ...ENV, BUN_AUTH_TOKEN: "s", BUN_CONFIG_TOKEN: "s", XDG_SECRET: "s", BUN_INSTALL: "/b" },
    ["agent"],
    [],
  );
  assert.equal(env.BUN_AUTH_TOKEN, undefined);
  assert.equal(env.BUN_CONFIG_TOKEN, undefined);
  assert.equal(env.XDG_SECRET, undefined);
  assert.equal(env.BUN_INSTALL, "/b");
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
    assert.equal(seatEnv(aws, ["claude"], []).AWS_REGION, "us-east-1");
    assert.equal(seatEnv(aws, ["devin", "acp"], []).AWS_ACCESS_KEY_ID, undefined);
    assert.equal(seatEnv(ENV, ["claude"], []).AWS_REGION, undefined);
    for (const value of ["0", "false", ""]) {
      assert.equal(
        seatEnv({ ...aws, CLAUDE_CODE_USE_BEDROCK: value }, ["claude"], []).AWS_ACCESS_KEY_ID,
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
  const env = seatEnv(gcp, ["claude"], []);
  assert.equal(env.GOOGLE_APPLICATION_CREDENTIALS, "/k.json");
  assert.equal(env.CLOUD_ML_REGION, "us-east5");
  assert.equal(env.GOOGLE_OTHER, undefined);
});
test("package runners, interpreters and Windows names identify the agent", () => {
  assert.equal(seatAgent(["npx", "-y", "@agentclientprotocol/codex-acp@2.5.0"]), "codex");
  assert.equal(seatAgent(CLAUDE), "claude");
  assert.equal(
    seatAgent([
      "node",
      "--use-system-ca",
      "/home/u/.local/share/cursor-agent/versions/1.2/index.js",
      "acp",
    ]),
    "cursor",
  );
  assert.equal(seatAgent(["C:\\tools\\devin.exe", "acp"]), "devin");
  assert.equal(exeName("C:\\tools\\devin.exe"), "devin");
  assert.equal(seatAgent(["/opt/agy-acp/current/agy_acp_server.par", "--uid="]), "agy");
});
test("a flag's value, a stray --package=, a plain script and an ancestor directory select nothing", () => {
  for (const cmd of [
    ["bun", "--package=@agentclientprotocol/claude-agent-acp@0.101.0", "/tmp/server.mjs"],
    ["node", "/tmp/claude-fake.mjs"],
    ["node", "/home/claude/work/server.mjs"],
    ["node", "/a/b/c/claude/d/e/f/server.mjs"],
    ["python3", "/opt/claude/server.py"],
    [
      "npx",
      "--package=@agentclientprotocol/claude-agent-acp",
      "--package=@agentclientprotocol/codex-acp",
      "claude-agent-acp",
    ],
    ["npx", "--package", "@agentclientprotocol/codex-acp", "claude-agent-acp"],
    ["npx", "--cache", "claude", "@agentclientprotocol/codex-acp@2.5.0"],
    ["bunx", "--cache-dir", "/x/claude", "@agentclientprotocol/codex-acp@2.5.0"],
    ["npx", "--registry", "https://r.example", "@agentclientprotocol/codex-acp@2.5.0"],
    ["node", "--import", "/opt/claude/preload.mjs", "/opt/grok/server.mjs"],
    ["node", "--import=/opt/claude/preload.mjs", "/opt/grok/server.mjs"],
    ["node", "/opt/grok/server.mjs", "--require=/opt/claude/x.cjs"],
    ["node", "--import", "/opt/grok/preload.mjs", "/opt/claude/server.mjs"],
  ]) {
    assert.equal(seatAgent(cmd), undefined, cmd.join(" "));
  }
});
test("a runner's options without a separate value leave the package in place", () => {
  assert.equal(
    seatAgent(["npx", "-y", "--silent", "@agentclientprotocol/codex-acp@2.5.0"]),
    "codex",
  );
  assert.equal(
    seatAgent([
      "bunx",
      "--cache-dir=/x/claude",
      "--package=@agentclientprotocol/claude-agent-acp@1",
      "claude-agent-acp",
    ]),
    "claude",
  );
  assert.equal(
    seatAgent(["bunx", "--bun", "--package=@agentclientprotocol/codex-acp@2.5.0", "codex-acp"]),
    "codex",
  );
});
test("a flag's directory value does not outweigh the script that follows it", () => {
  assert.equal(seatAgent(["bun", "--cwd", "/tools/claude", "/tools/grok/server.mjs"]), "grok");
  assert.equal(seatAgent(["bun", "--cwd=/tools/claude", "/tools/grok/server.mjs"]), "grok");
  // A directory named like an adapter after a flag, as the extensionless-script rule reads it, is ambiguous.
  assert.equal(seatAgent(["bun", "--cwd", "/tools/devin", "/tools/grok/server.mjs"]), undefined);
  assert.equal(seatAgent(["bun", "--cwd", "/tools/claude", "/tools/other/server.mjs"]), undefined);
});
test("script files that all point to one agent select it, attached flag values included", () => {
  assert.equal(
    seatAgent(["node", "--require=/opt/claude/x.cjs", "/opt/claude/server.mjs"]),
    "claude",
  );
  assert.equal(
    seatAgent(["node", "--require", "/opt/claude/x.cjs", "/opt/claude/server.mjs"]),
    "claude",
  );
});
test("only the script's own nearby package directory selects an agent", () => {
  assert.equal(seatAgent(["node", "/opt/tools/claude/server.mjs"]), "claude");
  assert.equal(seatAgent(["bun", "/opt/codex/lib/bin/server.js"]), "codex");
  assert.equal(seatAgent(["bun", "run", "/tmp/codex/server.ts"]), "codex");
});

/** Runs `body` with a seat directory and a Devin user config folder that are empty. */
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
test(
  "a launch that may start Devin but cannot be read is refused, not started without the deny config",
  POSIX,
  () => {
    withDevinDirs((dir) => {
      for (const cmd of [
        ["npx", "--cache", "/x", "devin", "acp"],
        ["bunx", "--registry", "https://r.example", "devin"],
      ]) {
        assert.throws(() => devinConfig(cmd, false, dir, refuseWith), /may start Devin/);
      }
      assert.deepEqual(devinConfig(["node", "/opt/tool/server.mjs"], false, dir, refuseWith), [
        "node",
        "/opt/tool/server.mjs",
      ]);
    });
  },
);
test(
  "--config goes after Devin itself: its executable, a runner's name or an interpreter's script",
  POSIX,
  () => {
    withDevinDirs((dir) => {
      const at = (/** @type {string[]} */ cmd) => {
        const out = devinConfig(cmd, false, dir, refuseWith);
        return out.indexOf("--config") - 1;
      };
      assert.equal(at(["devin", "acp"]), 0);
      assert.equal(at(["bunx", "devin", "acp"]), 1);
      assert.equal(at(["node", "--use-system-ca", "/opt/devin/bin/index.js", "acp"]), 2);
      const out = devinConfig(["node", "/opt/devin/bin/index.js", "acp"], false, dir, refuseWith);
      assert.equal(out[0], "node");
      assert.equal(out[1], "/opt/devin/bin/index.js");
      assert.equal(out[2], "--config");
      assert.equal(out[4], "acp");
    });
  },
);

test(
  "an interpreter launch that mixes a preload with a Devin script may start Devin, and is refused",
  POSIX,
  () => {
    withDevinDirs((dir) => {
      for (const cmd of [
        ["node", "--import", "shared/preload.mjs", "devin/index.js", "acp"],
        ["node", "--import=shared/preload.mjs", "devin/index.js", "acp"],
      ]) {
        assert.equal(seatAgent(cmd), undefined);
        assert.equal(mayStart(cmd, "devin"), true);
        assert.throws(() => devinConfig(cmd, false, dir, refuseWith), /may start Devin/);
      }
    });
  },
);
test("mayStart looks at the executable, a runner's packages and an interpreter's scripts, not other arguments", () => {
  assert.equal(mayStart(["node", "--title", "devin", "grok/server.mjs"], "devin"), false);
  assert.equal(mayStart(["node", "--title", "codex-acp", "grok/server.mjs"], "codex"), false);
  assert.equal(
    mayStart(["node", "--import", "shared/preload.mjs", "codex-acp/index.js"], "codex"),
    true,
  );
  assert.equal(
    mayStart(["npx", "--cache", "/x", "@agentclientprotocol/codex-acp@2.5.0"], "codex"),
    true,
  );
  assert.equal(mayStart(["npx", "--package=@agentclientprotocol/codex-acp", "x"], "codex"), true);
  assert.equal(mayStart(["/opt/bin/devin", "acp"], "devin"), true);
  assert.equal(mayStart(["grok", "agent", "--note", "devin"], "devin"), false);
});
test("--config goes after the entry script, not a Devin preload", POSIX, () => {
  withDevinDirs((dir) => {
    const out = devinConfig(
      ["node", "--import", "devin/preload.mjs", "devin/index.js", "acp"],
      false,
      dir,
      refuseWith,
    );
    assert.deepEqual(out.slice(0, 4), ["node", "--import", "devin/preload.mjs", "devin/index.js"]);
    assert.equal(out[4], "--config");
    assert.equal(out[6], "acp");
  });
});

test("a runner's package must name the same agent as the command it runs", () => {
  const claude = "--package=@agentclientprotocol/claude-agent-acp";
  assert.equal(seatAgent(["npx", claude, "claude-agent-acp"]), "claude");
  assert.equal(seatAgent(["npx", claude, "codex-acp"]), undefined);
  assert.equal(seatAgent(["npx", claude, "bin"]), undefined);
  assert.equal(
    seatAgent(["npx", "--package=@agentclientprotocol/codex-acp", "codex-acp"]),
    "codex",
  );
  assert.equal(mayStart(["npx", claude, "codex-acp"], "codex"), true);
});
test("an entry script is recognized by its own file name without the extension", () => {
  assert.equal(seatAgent(["node", "devin.mjs", "acp"]), "devin");
  assert.equal(seatAgent(["bun", "/opt/tools/codex-acp.js"]), "codex");
  assert.equal(seatAgent(["node", "/home/claude/x.mjs"]), undefined);
  assert.equal(seatAgent(["node", "claude-fake.mjs"]), undefined);
  assert.equal(mayStart(["node", "--import", "p.mjs", "devin.mjs"], "devin"), true);
});
test("a Devin entry script named by its file gets the deny config after it", POSIX, () => {
  withDevinDirs((dir) => {
    const out = devinConfig(["node", "devin.mjs", "acp"], false, dir, refuseWith);
    assert.deepEqual(out.slice(0, 3), ["node", "devin.mjs", "--config"]);
    assert.equal(out[4], "acp");
  });
});

test("Devin's cloud mode, which runs the session remotely, is refused", POSIX, () => {
  withDevinDirs((dir) => {
    for (const cmd of [
      ["devin", "acp", "--cloud"],
      ["devin", "acp", "--cloud=true"],
      ["devin", "cloud"],
      ["bunx", "devin", "cloud", "start"],
    ]) {
      assert.throws(() => devinConfig(cmd, false, dir, refuseWith), /cloud mode/, cmd.join(" "));
    }
    assert.doesNotThrow(() => devinConfig(["devin", "acp"], false, dir, refuseWith));
  });
});

test("an extensionless entry script named like an agent counts, and so does a script run directly", () => {
  assert.equal(seatAgent(["node", "tools/bin/codex-acp"]), "codex");
  assert.equal(
    seatAgent(["node", "--import", "tools/claude/preload.mjs", "tools/bin/codex-acp"]),
    undefined,
  );
  assert.equal(
    mayStart(["node", "--import", "tools/claude/preload.mjs", "tools/bin/codex-acp"], "codex"),
    true,
  );
  assert.equal(seatAgent(["/opt/bin/codex-acp.js", "--flag"]), "codex");
  assert.equal(seatAgent(["./devin.mjs"]), "devin");
  assert.equal(mayStart(["/opt/bin/codex-acp.js"], "codex"), true);
  assert.equal(mayStart(["/opt/bin/other.js"], "codex"), false);
});

test("a launch that may start agy is recognized in every form a caller writes it", () => {
  for (const cmd of [
    ["agy", "acp"],
    ["/home/u/.local/bin/agy", "acp"],
    ["agy-acp"],
    ["/opt/agy-acp/current/agy_acp_server.par", "--uid="],
    ["C:\\tools\\agy.exe", "acp"],
    ["AGY", "acp"],
    ["env", "GEMINI_API_KEY=x", "agy", "acp"],
    ["env", "-i", "/usr/local/bin/agy", "acp"],
    ["sh", "-c", "agy acp"],
    ["bash", "-lc", "cd /work && exec agy acp"],
    ["sh", "-c", 'FOO=1 "/opt/tools/agy" acp'],
    ["sh", "-c", "(agy acp)"],
    ["sh", "-c", "true;agy acp"],
    ["bunx", "agy-acp"],
    ["npx", "--yes", "@google/agy@1.5.3", "acp"],
    ["node", "/opt/agy-acp/index.js"],
    ["timeout", "600", "nice", "agy", "acp"],
    ["python3", "agy_acp_server.par"],
    ["env", "--split-string=agy acp"],
    ["env", "-Sagy acp"],
    ["env", "-S", "agy acp"],
  ]) {
    assert.equal(mayStartAgy(cmd, "/nowhere"), true, cmd.join(" "));
  }
});
test("other launches are not taken for agy", () => {
  for (const cmd of [
    ["codex-acp"],
    ["claude-agent-acp"],
    ["devin", "acp"],
    ["node", "/work/magyar/server.mjs"],
    ["bunx", "@agentclientprotocol/claude-agent-acp", "--cwd=/work/agyx"],
    ["cursor-agent", "acp", "--title", "legacy review"],
    ["sh", "-c", "echo agyx"],
  ]) {
    assert.equal(mayStartAgy(cmd, "/nowhere"), false, cmd.join(" "));
  }
});
test("an executable that is a link to agy, on PATH or by path, is agy", () => {
  const dir = mkdtempSync(join(tmpdir(), "agy-link-"));
  try {
    mkdirSync(join(dir, "bin"));
    writeFileSync(join(dir, "bin", "agy"), "#!/bin/sh\n", { mode: 0o755 });
    writeFileSync(join(dir, "bin", "other"), "#!/bin/sh\n", { mode: 0o755 });
    symlinkSync(join(dir, "bin", "agy"), join(dir, "bin", "antigravity"));
    assert.equal(mayStartAgy(["antigravity", "acp"], join(dir, "bin")), true);
    assert.equal(mayStartAgy([join(dir, "bin", "antigravity"), "acp"], "/nowhere"), true);
    assert.equal(mayStartAgy(["other", "acp"], join(dir, "bin")), false);
    // Behind a wrapper, and relative to the directory the launch runs in.
    const bin = join(dir, "bin");
    assert.equal(mayStartAgy(["env", "X=1", join(bin, "antigravity"), "acp"], "/nowhere"), true);
    assert.equal(mayStartAgy(["sh", "-c", `${join(bin, "antigravity")} acp`], "/nowhere"), true);
    assert.equal(mayStartAgy(["env", "X=1", "antigravity", "acp"], bin), true);
    assert.equal(mayStartAgy(["./antigravity", "acp"], "/nowhere", bin), true);
    assert.equal(mayStartAgy(["antigravity", "acp"], "bin", dir), true, "a relative PATH entry");
    assert.equal(mayStartAgy(["./other", "acp"], "/nowhere", bin), false);
    // A path with spaces, an empty PATH entry, a PATH set by `env`, and a shadowed name.
    mkdirSync(join(dir, "IDE Tools"));
    symlinkSync(join(bin, "agy"), join(dir, "IDE Tools", "antigravity"));
    assert.equal(mayStartAgy(["./IDE Tools/antigravity", "acp"], "/nowhere", dir), true);
    symlinkSync(join(bin, "agy"), join(dir, "antigravity"));
    assert.equal(mayStartAgy(["antigravity", "acp"], `/usr/bin${delimiter}`, dir), true);
    assert.equal(mayStartAgy(["antigravity", "acp"], `${delimiter}/usr/bin`, dir), true);
    assert.equal(mayStartAgy(["env", `PATH=${bin}`, "antigravity", "acp"], "/usr/bin", dir), true);
    mkdirSync(join(dir, "first"));
    mkdirSync(join(dir, "second"));
    writeFileSync(join(dir, "first", "claude-agent-acp"), "#!/bin/sh\n", { mode: 0o755 });
    symlinkSync(join(bin, "agy"), join(dir, "second", "claude-agent-acp"));
    assert.equal(
      mayStartAgy(
        ["claude-agent-acp"],
        `${join(dir, "first")}${delimiter}${join(dir, "second")}`,
        dir,
      ),
      false,
      "the first executable on PATH is the one that runs",
    );
    assert.equal(
      mayStartAgy(
        ["claude-agent-acp"],
        `${join(dir, "second")}${delimiter}${join(dir, "first")}`,
        dir,
      ),
      true,
    );
    // A PATH with spaces, quoted paths, layered env wrappers and a directory in the way.
    const spaced = join(dir, "IDE Tools", "bin");
    mkdirSync(spaced, { recursive: true });
    symlinkSync(join(bin, "agy"), join(spaced, "antigravity"));
    assert.equal(
      mayStartAgy(["env", `PATH=${spaced}`, "antigravity", "acp"], "/usr/bin", dir),
      true,
    );
    assert.equal(
      mayStartAgy(["sh", "-c", `"${join(spaced, "antigravity")}" acp`], "/nowhere", dir),
      true,
    );
    assert.equal(
      mayStartAgy(["sh", "-c", `PATH="${spaced}" antigravity acp`], "/usr/bin", dir),
      true,
    );
    // An interpreter's bare file operand, and relative links behind a wrapper that changes directory.
    writeFileSync(join(dir, "agy_acp_server.par"), "archive", { mode: 0o644 });
    symlinkSync(join(dir, "agy_acp_server.par"), join(dir, "antigravity.par"));
    assert.equal(mayStartAgy(["python3", "antigravity.par"], "/nowhere", dir), true);
    assert.equal(mayStartAgy(["python3", "plain.par"], "/nowhere", dir), false);
    assert.equal(
      mayStartAgy(["env", `--chdir=${bin}`, "./antigravity", "acp"], "/nowhere", "/"),
      true,
    );
    assert.equal(
      mayStartAgy(["env", "--chdir", bin, "./antigravity", "acp"], "/nowhere", "/"),
      true,
    );
    assert.equal(
      mayStartAgy(["sh", "-c", `cd ${bin} && exec ./antigravity acp`], "/nowhere", "/"),
      true,
    );
    assert.equal(
      mayStartAgy(["sh", "-c", `cd "${bin}"; ./antigravity acp`], "/nowhere", "/"),
      true,
    );
    assert.equal(
      mayStartAgy(["sh", "-c", `cd ${join(dir, "first")} && ./antigravity acp`], "/nowhere", "/"),
      false,
    );
    mkdirSync(join(dir, "third"));
    writeFileSync(join(dir, "third", "antigravity"), "#!/bin/sh\n", { mode: 0o755 });
    mkdirSync(join(dir, "fourth", "antigravity"), { recursive: true });
    assert.equal(
      mayStartAgy(
        ["env", `PATH=${join(dir, "third")}`, "/usr/bin/env", `PATH=${spaced}`, "antigravity"],
        "/usr/bin",
        dir,
      ),
      true,
      "a later env PATH replaces an earlier one",
    );
    assert.equal(
      mayStartAgy(
        ["env", `PATH=${join(dir, "fourth")}${delimiter}${spaced}`, "antigravity", "acp"],
        "/usr/bin",
        dir,
      ),
      true,
      "a directory of that name is not the executable",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test(
  "pathExecutable skips relative entries, entries and links inside the root, and folders",
  { skip: process.platform === "win32" },
  () => {
    const dir = mkdtempSync(join(tmpdir(), "path-exec-"));
    try {
      const root = join(dir, "root");
      const trusted = join(dir, "trusted");
      const other = join(dir, "other");
      for (const d of [
        join(root, "node_modules", ".bin"),
        trusted,
        other,
        join(other, "tool-dir"),
      ]) {
        mkdirSync(d, { recursive: true });
      }
      writeFileSync(join(root, "node_modules", ".bin", "tool"), "#!/bin/sh\n", { mode: 0o755 });
      writeFileSync(join(trusted, "tool"), "#!/bin/sh\n", { mode: 0o755 });
      writeFileSync(join(root, "inside-tool"), "#!/bin/sh\n", { mode: 0o755 });
      symlinkSync(join(root, "inside-tool"), join(other, "linked-tool"));
      mkdirSync(join(other, "folder-tool"));
      const path = (/** @type {string[]} */ ...dirs) => dirs.join(delimiter);
      assert.equal(
        pathExecutable("tool", path(join(root, "node_modules", ".bin"), trusted), root),
        realpathSync(join(trusted, "tool")),
      );
      assert.equal(
        pathExecutable("tool", path("node_modules/.bin", ".", "", trusted), root),
        realpathSync(join(trusted, "tool")),
      );
      assert.equal(
        pathExecutable("tool", path(join(root, "node_modules", ".bin")), root),
        undefined,
      );
      assert.equal(
        pathExecutable("linked-tool", path(other), root),
        undefined,
        "a link into the root",
      );
      assert.equal(
        pathExecutable("folder-tool", path(other), root),
        undefined,
        "a folder is not a program",
      );
      assert.equal(pathExecutable("tool-dir", path(other), root), undefined);
      assert.equal(pathExecutable("missing", path(other, trusted), root), undefined);
      // The review root named like the tool, with its parent on PATH.
      mkdirSync(join(dir, "named", "tool"), { recursive: true });
      assert.equal(
        pathExecutable("tool", path(join(dir, "named")), join(dir, "named", "tool")),
        undefined,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test("envPath reads PATH whatever the case on Windows and exactly PATH elsewhere", () => {
  assert.equal(envPath({ PATH: "/a" }), "/a");
  assert.equal(envPath({ HOME: "/h" }), undefined);
  if (process.platform === "win32") {
    assert.equal(envPath({ Path: "C:\\a" }), "C:\\a");
  } else {
    assert.equal(envPath({ Path: "/lower" }), undefined);
  }
});

const UNDER_BUN = exeName(process.execPath) === "bun";
const refuseTest = (/** @type {string} */ message) => {
  throw new Error(message);
};
test(
  "a bun server is started without the checkout's .env and bunfig.toml; bunx --bun is refused",
  { skip: !UNDER_BUN || process.platform === "win32" },
  () => {
    const dir = mkdtempSync(join(tmpdir(), "bun-hardened-"));
    try {
      const root = join(dir, "checkout");
      mkdirSync(root);
      writeFileSync(join(root, "bunfig.toml"), 'preload = ["./pre.mjs"]\n');
      writeFileSync(
        join(root, "pre.mjs"),
        `await Bun.write(${JSON.stringify(join(dir, "preload-ran"))}, "1");\n`,
      );
      writeFileSync(join(root, ".env"), "PROBE_FROM_ENV=1\n");
      writeFileSync(
        join(dir, "server.mjs"),
        `console.log(JSON.stringify({ env: process.env.PROBE_FROM_ENV ?? null }));\n`,
      );
      const run = (/** @type {string[]} */ cmd) =>
        spawnSync(cmd[0] ?? "", cmd.slice(1), {
          cwd: root,
          encoding: "utf8",
          env: { PATH: process.env.PATH },
        });
      // Control: a plain bun launch in the checkout reads both files.
      const plain = run([process.execPath, join(dir, "server.mjs")]);
      assert.match(plain.stdout, /"env":"1"/, plain.stderr);
      assert.equal(existsSync(join(dir, "preload-ran")), true, "the control preload ran");
      rmSync(join(dir, "preload-ran"));
      const hardened = bunHardened([process.execPath, join(dir, "server.mjs")], root, refuseTest);
      assert.equal(hardened[1], "--no-env-file");
      assert.match(hardened[2] ?? "", /^--config=.*empty-bunfig\.toml$/);
      const safe = run(hardened);
      assert.match(safe.stdout, /"env":null/, safe.stderr);
      assert.equal(existsSync(join(dir, "preload-ran")), false, "the preload did not run");
      // A script whose #! line names bun runs through bun with the flags.
      writeFileSync(join(dir, "adapter"), "#!/usr/bin/env bun\nconsole.log('adapter');\n", {
        mode: 0o755,
      });
      assert.throws(
        () => bunHardened([join(dir, "adapter"), "acp"], root, refuseTest),
        /names bun, which would read the checkout/,
      );
      // A Node script and a plain executable are left alone; flags already given are not doubled.
      writeFileSync(join(dir, "node-adapter"), "#!/usr/bin/env node\n", { mode: 0o755 });
      assert.deepEqual(bunHardened([join(dir, "node-adapter"), "acp"], root, refuseTest), [
        join(dir, "node-adapter"),
        "acp",
      ]);
      const one = bunHardened(["bun", "--no-env-file", "x.js"], root, refuseTest);
      assert.ok(
        one.some((a) => /^--config=.*empty-bunfig\.toml$/.test(a)),
        "the missing flag is added",
      );
      assert.equal(one.filter((a) => a === "--no-env-file").length, 1);
      const cfg = bunHardened(["bun", "--config=/own.toml", "x.js"], root, refuseTest);
      assert.deepEqual(cfg.slice(1), ["--no-env-file", "--config=/own.toml", "x.js"]);
      assert.equal(exeName(cfg[0] ?? ""), "bun");
      const argOnly = bunHardened(
        ["bun", "/opt/server.mjs", "--config=/etc/app.json"],
        root,
        refuseTest,
      );
      assert.equal(argOnly[1], "--no-env-file", "a server's own --config is not Bun's");
      assert.match(argOnly[2] ?? "", /^--config=.*empty-bunfig\.toml$/);
      assert.deepEqual(bunHardened(["bunx", "codex-acp"], root, refuseTest).slice(1), [
        "codex-acp",
      ]);
      for (const cmd of [
        ["bunx", "--bun", "pkg"],
        ["bun", "x", "--bun", "pkg"],
      ]) {
        assert.throws(() => bunHardened(cmd, root, refuseTest), /bunx --bun/);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

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
      const path = `${join(root, "bin")}${delimiter}${trusted}`;
      const wrap = (/** @type {string | undefined} */ given) =>
        codexWrapper(
          { PATH: path, ...(given === undefined ? {} : { CODEX_PATH: given }) },
          false,
          root,
          refuse,
        );
      for (const given of ["./bin/codex", join(root, "bin", "codex")]) {
        assert.throws(() => wrap(given), /regular executable outside the review root/, given);
      }
      for (const given of [undefined, "codex", join(trusted, "codex")]) {
        const out = wrap(given);
        assert.equal(
          out.CODEX_NO_WEB_REAL,
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
test(
  "pathExecutable returns the canonical path, not the entry's alias",
  { skip: process.platform === "win32" },
  () => {
    const dir = mkdtempSync(join(tmpdir(), "path-canon-"));
    try {
      mkdirSync(join(dir, "real"));
      writeFileSync(join(dir, "real", "tool-real"), "#!/bin/sh\n", { mode: 0o755 });
      symlinkSync(join(dir, "real", "tool-real"), join(dir, "real", "tool"));
      symlinkSync(join(dir, "real"), join(dir, "alias"));
      const root = join(dir, "root");
      mkdirSync(root);
      assert.equal(
        pathExecutable("tool", join(dir, "alias"), root),
        realpathSync(join(dir, "real", "tool-real")),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

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
  "cleanPath keeps absolute entries outside the checkout; a codex helper runs with that PATH",
  { skip: process.platform === "win32" },
  () => {
    const dir = mkdtempSync(join(tmpdir(), "clean-path-"));
    try {
      const root = join(dir, "root");
      const trusted = join(dir, "trusted");
      mkdirSync(join(root, "bin"), { recursive: true });
      mkdirSync(trusted);
      symlinkSync(join(root, "bin"), join(dir, "alias-into-root"));
      const path = [
        join(root, "bin"),
        "node_modules/.bin",
        ".",
        "",
        join(dir, "alias-into-root"),
        trusted,
      ].join(delimiter);
      assert.equal(cleanPath(path, root), realpathSync(trusted));
      const none = cleanPath(undefined, root);
      assert.ok(
        none.startsWith("/") && !none.includes(delimiter),
        "an empty folder, never an empty PATH",
      );
      assert.deepEqual(readdirSync(none), []);
      // The codex helper itself sees only that PATH.
      const seen = join(dir, "seen-path");
      writeFileSync(
        join(trusted, "codex"),
        `#!/bin/sh\nprintf '%s' "$PATH" > "${seen}"\necho '[]'\n`,
        { mode: 0o755 },
      );
      const refuse = /** @type {(m: string) => never} */ (
        (m) => {
          throw new Error(m);
        }
      );
      codexWrapper({ PATH: path }, false, root, refuse);
      assert.equal(readFileSync(seen, "utf8"), realpathSync(trusted));
    } finally {
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
  "cleanPath keeps the canonical folder, not the alias that was checked",
  { skip: process.platform === "win32" },
  () => {
    const dir = mkdtempSync(join(tmpdir(), "clean-canon-"));
    try {
      const root = join(dir, "root");
      mkdirSync(root);
      mkdirSync(join(dir, "real"));
      symlinkSync(join(dir, "real"), join(dir, "alias"));
      assert.equal(cleanPath(join(dir, "alias"), root), realpathSync(join(dir, "real")));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
test(
  "a bare server command is judged by the file the launch will run: the first on PATH, relative entries included",
  { skip: !UNDER_BUN || process.platform === "win32" },
  () => {
    const dir = mkdtempSync(join(tmpdir(), "first-on-path-"));
    const saved = process.env.PATH;
    try {
      const root = join(dir, "root");
      const outside = join(dir, "outside");
      mkdirSync(join(root, "bin"), { recursive: true });
      mkdirSync(outside);
      writeFileSync(join(root, "bin", "adapter"), "#!/usr/bin/env node\n", { mode: 0o755 });
      writeFileSync(join(outside, "adapter"), "#!/usr/bin/env bun\n", { mode: 0o755 });
      // The first match is inside the checkout: refused, not the later outside bun adapter rewritten.
      process.env.PATH = `bin${delimiter}${outside}`;
      assert.throws(
        () => bunHardened(["adapter", "acp"], root, refuseTest),
        /inside the review checkout/,
      );
      // Only the outside one on PATH: it is the file that runs, and its bun shebang is refused.
      process.env.PATH = outside;
      assert.throws(() => bunHardened(["adapter", "acp"], root, refuseTest), /names bun/);
    } finally {
      process.env.PATH = saved;
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "a bare bun or bunx is the one outside the checkout; an explicit checkout path is the caller's choice",
  { skip: !UNDER_BUN || process.platform === "win32" },
  () => {
    const dir = mkdtempSync(join(tmpdir(), "bare-bun-"));
    const saved = process.env.PATH;
    try {
      const root = join(dir, "root");
      mkdirSync(join(root, "bin"), { recursive: true });
      writeFileSync(join(root, "bin", "bun"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      const realBunDir = join(process.execPath, "..");
      process.env.PATH = `${join(root, "bin")}${delimiter}${realBunDir}`;
      const out = bunHardened(["bun", "/trusted/server.mjs"], root, refuseTest);
      assert.equal(out[0], realpathSync(process.execPath), "the checkout's bun is skipped");
      assert.equal(out[1], "--no-env-file");
      process.env.PATH = join(root, "bin");
      assert.throws(
        () => bunHardened(["bun", "/trusted/server.mjs"], root, refuseTest),
        /not on PATH outside/,
      );
      assert.throws(() => bunHardened(["bunx", "pkg"], root, refuseTest), /not on PATH outside/);
      // An explicit path into the checkout is the caller's choice: not refused for its location, but a
      // bun shebang is refused wherever it is.
      process.env.PATH = realBunDir;
      writeFileSync(join(root, "node-adapter"), "#!/usr/bin/env node\n", { mode: 0o755 });
      assert.deepEqual(bunHardened([join(root, "node-adapter"), "acp"], root, refuseTest), [
        join(root, "node-adapter"),
        "acp",
      ]);
      writeFileSync(join(root, "adapter"), "#!/usr/bin/env bun\n", { mode: 0o755 });
      assert.throws(
        () => bunHardened([join(root, "adapter"), "acp"], root, refuseTest),
        /names bun/,
      );
    } finally {
      process.env.PATH = saved;
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "no #! line is rewritten: any line naming bun is refused, whatever its syntax; others pass through",
  { skip: process.platform === "win32" },
  () => {
    const dir = mkdtempSync(join(tmpdir(), "shebang-refuse-"));
    try {
      const root = join(dir, "root");
      mkdirSync(root);
      const script = (/** @type {string} */ line, /** @type {string} */ name) => {
        const path = join(dir, name);
        writeFileSync(path, `${line}\nconsole.log(1);\n`, { mode: 0o755 });
        return path;
      };
      let n = 0;
      for (const line of [
        "#!/usr/bin/env -S 'bun --smol'",
        "#!/usr/bin/env bun",
        '#!/usr/bin/env -S bun --conditions="review main.mjs"',
        '#!/usr/bin/env -S --chdir="/trusted dir" bun chosen.mjs',
        "#!/trusted/bun --conditions=review chosen.mjs",
        "#!/usr/bin/env -i /trusted/bun",
        "#!/usr/bin/env -u NAME bun",
        `#!/usr/bin/env -S bun --conditions=${"a".repeat(230)} z extra`,
      ]) {
        const path = script(line, `adapter-${n++}`);
        assert.throws(() => bunHardened([path, "acp"], root, refuseTest), /names bun/, line);
      }
      for (const line of [
        "#!/usr/bin/env node",
        "#!/bin/sh",
        "#!/usr/bin/env -S node --x='a b'",
        "#!/usr/bin/env -S python3 -W ignore:bun",
        "#!/tools/bun/sh",
        "no shebang",
      ]) {
        const path = script(line, `plain-${n++}`);
        assert.deepEqual(bunHardened([path, "acp"], root, refuseTest), [path, "acp"], line);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
test(
  "the entry that a bare bunx is found by keeps its name under the canonical folder",
  { skip: !UNDER_BUN || process.platform === "win32" },
  () => {
    const dir = mkdtempSync(join(tmpdir(), "bunx-alias-"));
    const saved = process.env.PATH;
    try {
      const root = join(dir, "root");
      const trusted = join(dir, "trusted");
      mkdirSync(root);
      mkdirSync(trusted);
      symlinkSync(process.execPath, join(trusted, "bunx"));
      symlinkSync(trusted, join(dir, "tools-alias"));
      process.env.PATH = join(dir, "tools-alias");
      const out = bunHardened(["bunx", "pkg"], root, refuseTest);
      assert.equal(
        out[0],
        join(realpathSync(trusted), "bunx"),
        "canonical folder, the entry's own name",
      );
      assert.equal(out[1], "pkg");
    } finally {
      process.env.PATH = saved;
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "a bun.exe on a POSIX PATH is looked up by that name",
  { skip: !UNDER_BUN || process.platform === "win32" },
  () => {
    const dir = mkdtempSync(join(tmpdir(), "bun-exe-"));
    const saved = process.env.PATH;
    try {
      const root = join(dir, "root");
      const trusted = join(dir, "trusted");
      mkdirSync(root);
      mkdirSync(trusted);
      symlinkSync(process.execPath, join(trusted, "bun.exe"));
      process.env.PATH = trusted;
      const out = bunHardened(["bun.exe", "/trusted/server.mjs"], root, refuseTest);
      assert.equal(exeName(out[0] ?? ""), "bun");
      assert.equal(out[1], "--no-env-file");
    } finally {
      process.env.PATH = saved;
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

test("absoluteFirst makes only a relative path absolute, keeps a trailing slash, and leaves bare names", () => {
  const refuse = /** @type {(m: string) => never} */ (
    (m) => {
      throw new Error(m);
    }
  );
  const root = mkdtempSync(join(process.env.HOUSE_RULES_TEST_TMP || tmpdir(), "abs-first-"));
  try {
    assert.deepEqual(absoluteFirst(["claude-agent-acp", "x"], root, refuse), [
      "claude-agent-acp",
      "x",
    ]);
    assert.deepEqual(absoluteFirst(["/usr/bin/env", "x"], root, refuse), ["/usr/bin/env", "x"]);
    assert.deepEqual(absoluteFirst([], root, refuse), []);
    const abs = absoluteFirst(["../tool", "a"], root, refuse);
    assert.ok(abs[0]?.startsWith("/") && abs[0].endsWith("/tool") && abs[1] === "a");
    const dir = absoluteFirst(["./tools/"], root, refuse);
    assert.ok(dir[0]?.endsWith("/tools/"), "the trailing slash stays");
    if (process.platform !== "win32") {
      assert.deepEqual(absoluteFirst(["claude\\adapter"], root, refuse), ["claude\\adapter"]);
      // A trailing backslash is part of the name on POSIX, not a separator.
      assert.ok(!absoluteFirst(["./adapter\\"], root, refuse)[0]?.endsWith("/"));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test(
  "absoluteFirst follows a link before a `..` the way the system does",
  { skip: process.platform === "win32" },
  () => {
    const refuse = /** @type {(m: string) => never} */ (
      (m) => {
        throw new Error(m);
      }
    );
    const dir = mkdtempSync(join(process.env.HOUSE_RULES_TEST_TMP || tmpdir(), "abs-link-"));
    const before = process.cwd();
    try {
      const root = join(dir, "review");
      mkdirSync(root);
      mkdirSync(join(dir, "tools", "actual", "inner"), { recursive: true });
      symlinkSync(join(dir, "tools", "actual", "inner"), join(dir, "tools", "link"));
      mkdirSync(join(dir, "client"));
      process.chdir(join(dir, "client"));
      // `link/..` is `tools/actual` (the link's parent), not `tools`.
      const out = absoluteFirst(["../tools/link/../claude-agent-acp"], root, refuse);
      assert.equal(out[0], join(realpathSync(dir), "tools", "actual", "claude-agent-acp"));
    } finally {
      process.chdir(before);
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  "cleanPath drops a folder whose canonical path holds the PATH delimiter",
  { skip: process.platform === "win32" },
  () => {
    const dir = mkdtempSync(join(process.env.HOUSE_RULES_TEST_TMP || tmpdir(), "clean-delim-"));
    try {
      const root = join(dir, "review");
      mkdirSync(root);
      mkdirSync(join(dir, "a:b"));
      mkdirSync(join(dir, "plain"));
      symlinkSync(join(dir, "a:b"), join(dir, "alias"));
      const kept = cleanPath(`${join(dir, "alias")}:${join(dir, "plain")}`, root);
      assert.equal(kept, realpathSync(join(dir, "plain")));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
