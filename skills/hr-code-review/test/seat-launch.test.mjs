import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import {
  devinConfig,
  exeName,
  mayStart,
  mayStartAgy,
  seatAgent,
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
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
