import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { scratch } from "./fixture.mjs";

const wrapper = join(import.meta.dirname, "../evals/end-of-reply/models/claude.sh");

// Runs claude.sh with a stub `claude` that prints the CLAUDE*/ANTHROPIC* names it can see.
/**
 * @param {import("node:test").TestContext} t
 * @param {Record<string, string>} env
 */
const visibleVariables = (t, env) => {
  const dir = scratch(t, "house-rules-eval-");
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(
    join(bin, "claude"),
    "#!/bin/sh\nenv | grep -oE '^(CLAUDE|ANTHROPIC)[A-Z0-9_]*' | sort\n",
  );
  chmodSync(join(bin, "claude"), 0o755);
  const r = spawnSync("bash", [wrapper], {
    input: "prompt",
    encoding: "utf8",
    env: {
      PATH: `${bin}:/usr/local/bin:/usr/bin:/bin`,
      HOME: dir,
      EOR_TMPDIR: dir,
      CLAUDE_CONFIG_DIR: "/hub",
      ANTHROPIC_AUTH_TOKEN: "x",
      ANTHROPIC_BASE_URL: "http://gateway.invalid",
      ...env,
    },
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.split("\n").filter(Boolean);
};

test(
  "claude.sh unsets Claude Code's own variables by default",
  { skip: process.platform === "win32" },
  (t) => {
    assert.deepEqual(visibleVariables(t, {}), ["CLAUDE_CODE_DISABLE_AUTO_MEMORY"]);
  },
);

test(
  "claude.sh keeps only the variables EOR_KEEP_ENV names",
  { skip: process.platform === "win32" },
  (t) => {
    assert.deepEqual(
      visibleVariables(t, { EOR_KEEP_ENV: "CLAUDE_CONFIG_DIR ANTHROPIC_AUTH_TOKEN" }),
      ["ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_DISABLE_AUTO_MEMORY", "CLAUDE_CONFIG_DIR"],
    );
  },
);

test(
  "claude.sh matches EOR_KEEP_ENV names whole, not as prefixes",
  { skip: process.platform === "win32" },
  (t) => {
    assert.deepEqual(visibleVariables(t, { EOR_KEEP_ENV: "ANTHROPIC" }), [
      "CLAUDE_CODE_DISABLE_AUTO_MEMORY",
    ]);
  },
);
