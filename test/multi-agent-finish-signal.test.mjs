import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { scratch } from "./fixture.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
// The command needs a grep with --line-buffered, and the test needs a timeout that stops the whole
// pipeline (GNU or uutils coreutils); BusyBox versions would fail or hang the test, so it runs only where
// both are present.
// Probes run with stdin closed and their own timeout, so a sandbox that cannot shut a pipe down cannot
// hang the test file before any test is registered.
/** @type {import("node:child_process").SpawnSyncOptionsWithStringEncoding} */
const probe = { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 5000 };
const grepBuffers = spawnSync("grep", ["--line-buffered", "x", "/dev/null"], probe).status === 1;
const timeoutStops = /GNU|uutils/.test(spawnSync("timeout", ["--version"], probe).stdout);
const posix = {
  skip:
    process.platform !== "linux"
      ? "needs Linux"
      : !grepBuffers || !timeoutStops
        ? "needs grep --line-buffered and a GNU or uutils timeout"
        : false,
  timeout: 20000,
};

// The finish-signal command the agent-work reference gives, run against a fake T3 data directory: the
// reference text is the only copy, so the test takes the command from it.
const reference = readFileSync(join(root, "rules/references/multi-agent.md"), "utf8");
const command = /`(cd "[^`]+)`/.exec(reference)?.[1] ?? "";
const EVENT =
  'x delegate-task%253At1:y "update":{"type":"turn-ended"}\n' +
  'x delegate-task%253At1x:y "update":{"type":"turn-ended"}\n' +
  'x delegate-task%253At2:y "update":{"type":"turn-ended"}\n';
/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs the command with the child's mcp id and task id filled in. The log file does not exist when the
 * command starts, as in real use: it is written a moment later, and the command must wait for it.
 * @param {string} logs directory that holds the provider logs
 * @param {Record<string, string>} env
 * @returns {Promise<string>} what the command printed in four seconds
 */
async function signal(logs, env) {
  mkdirSync(logs, { recursive: true });
  const filled = command.replaceAll("<mcp-id>", "abc123").replaceAll("<task>", "t1");
  const child = spawn("timeout", ["4", "bash", "-c", filled], {
    env: { PATH: process.env.PATH ?? "", ...env },
  });
  let out = "";
  child.stdout.on("data", (chunk) => (out += chunk));
  // Listen from the start: a command that fails at once has closed before the file is written.
  const closed = new Promise((resolve) => child.on("close", resolve));
  await sleep(600);
  writeFileSync(join(logs, "events.thread-delegated-task-command-3amcp-3aabc123-run.log"), EVENT);
  await closed;
  return out;
}

test("the finish-signal command is in the reference", posix, () => {
  assert.match(command, /tail -n \+1 -F \$G \| grep --line-buffered/);
});

test("it reads the default data directory under HOME/.t3/userdata", posix, async (t) => {
  const home = scratch(t, "finish-signal-home-");
  const out = await signal(join(home, ".t3", "userdata", "logs", "provider"), { HOME: home });
  assert.match(out, /delegate-task%253At1:/);
  // The colon after the task id is the boundary: t1x and t2 are other tasks.
  assert.doesNotMatch(out, /delegate-task%253At1x:/);
  assert.doesNotMatch(out, /delegate-task%253At2:/);
});

test("T3CODE_HOME moves the data directory, and userdata stays beneath it", posix, async (t) => {
  const home = scratch(t, "finish-signal-home-");
  const custom = join(scratch(t, "finish-signal-custom-"), "a dir with spaces");
  const out = await signal(join(custom, "userdata", "logs", "provider"), {
    HOME: home,
    T3CODE_HOME: custom,
  });
  assert.match(out, /delegate-task%253At1:/);
  assert.doesNotMatch(out, /delegate-task%253At2:/);
});

test("logs outside userdata under T3CODE_HOME are not where T3 writes them", posix, async (t) => {
  const home = scratch(t, "finish-signal-home-");
  const custom = scratch(t, "finish-signal-custom-");
  const out = await signal(join(custom, "logs", "provider"), { HOME: home, T3CODE_HOME: custom });
  assert.equal(out, "");
});
