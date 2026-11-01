import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { scratch } from "./fixture.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const posix = { skip: process.platform === "win32" };

// The finish-signal command the agent-work reference gives, run against a fake T3 data directory: the
// reference text is the only copy, so the test takes the command from it.
const reference = readFileSync(join(root, "rules/references/multi-agent.md"), "utf8");
const command = /`(cd "[^`]+)`/.exec(reference)?.[1] ?? "";
const EVENT =
  'x delegate-task%253At1:y "update":{"type":"turn-ended"}\nx delegate-task%253At2:y "update":{"type":"turn-ended"}\n';

/**
 * Runs the command with the child's mcp id and task id filled in, for two seconds.
 * @param {string} logs directory that holds the provider logs
 * @param {Record<string, string>} env
 */
function signal(logs, env) {
  mkdirSync(logs, { recursive: true });
  writeFileSync(join(logs, "events.thread-delegated-task-command-3amcp-3aabc123-run.log"), EVENT);
  const filled = command.replaceAll("<mcp-id>", "abc123").replaceAll("<task>", "t1");
  return spawnSync("timeout", ["2", "bash", "-c", filled], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", ...env },
  }).stdout;
}

test("the finish-signal command is in the reference", posix, () => {
  assert.match(command, /tail -n \+1 -F \$G \| grep --line-buffered/);
});

test("it reads the default data directory under HOME/.t3/userdata", posix, (t) => {
  const home = scratch(t, "finish-signal-home-");
  const out = signal(join(home, ".t3", "userdata", "logs", "provider"), { HOME: home });
  assert.match(out, /delegate-task%253At1:/);
  assert.doesNotMatch(out, /delegate-task%253At2:/);
});

test("T3CODE_HOME moves the data directory, and userdata stays beneath it", posix, (t) => {
  const home = scratch(t, "finish-signal-home-");
  const custom = join(scratch(t, "finish-signal-custom-"), "a dir with spaces");
  const out = signal(join(custom, "userdata", "logs", "provider"), {
    HOME: home,
    T3CODE_HOME: custom,
  });
  assert.match(out, /delegate-task%253At1:/);
  assert.doesNotMatch(out, /delegate-task%253At2:/);
});

test("logs outside userdata under T3CODE_HOME are not where T3 writes them", posix, (t) => {
  const home = scratch(t, "finish-signal-home-");
  const custom = scratch(t, "finish-signal-custom-");
  const out = signal(join(custom, "logs", "provider"), { HOME: home, T3CODE_HOME: custom });
  assert.equal(out, "");
});
