import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const observer = fileURLToPath(new URL("../scripts/unit-observer.py", import.meta.url));
const skip = process.platform !== "linux" || !existsSync("/proc/pressure/memory");
/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** @typedef {{ dir: string, files: Record<string, string> }} Cgroup */
/** @typedef {{ clean: boolean, scope: string, samples: number, pid: number, start_ticks: string, reasons: string[] }} Summary */
/** @typedef {{ code: number | null, summary: Summary }} Result */

const QUIET =
  "some avg10=0.00 avg60=0.00 avg300=0.00 total=0\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=0\n";
const BUSY =
  "some avg10=0.00 avg60=0.00 avg300=0.00 total=0\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=900000\n";

/**
 * A directory with the files of a quiet cgroup; the observer's `change` edits them while it runs.
 * @param {string} root
 * @returns {Cgroup}
 */
function fakeCgroup(root) {
  const dir = join(root, "workload.scope");
  mkdirSync(dir);
  const files = {
    "cpu.stat": "usage_usec 1000\nuser_usec 900\nsystem_usec 100\n",
    "memory.events": "low 0\nhigh 0\nmax 0\noom 0\noom_kill 0\n",
    "memory.stat": "anon 1\nzswpin 0\nzswpout 0\nzswpwb 0\n",
    "memory.swap.current": "0\n",
    "memory.zswap.current": "0\n",
    "memory.pressure": QUIET,
    "io.pressure": QUIET,
  };
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(dir, name), text);
  }
  return { dir, files };
}

/**
 * Runs the observer for about three samples, calls `change` after the first, and returns its exit code and summary.
 * @param {(dir: string) => string[]} extraArgs
 * @param {(cg: Cgroup) => void} [change]
 * @returns {Promise<Result>}
 */
async function observe(extraArgs, change = () => {}) {
  const root = mkdtempSync(join(tmpdir(), "unit-observer-"));
  try {
    const cg = fakeCgroup(root);
    const output = join(root, "out.json");
    const child = spawn("python3", [observer, "--output", output, ...extraArgs(cg.dir)], {
      stdio: "ignore",
    });
    /** @type {Promise<number | null>} */
    const done = new Promise((resolve) => child.on("exit", resolve));
    for (let i = 0; i < 100 && !existsSync(`${output}.ready`); i++) {
      await sleep(50);
    }
    assert.ok(
      existsSync(`${output}.ready`),
      "the observer writes a ready marker after its first sample",
    );
    await sleep(1200);
    change(cg);
    await sleep(1500);
    child.kill("SIGTERM");
    const code = await done;
    return { code, summary: JSON.parse(readFileSync(output, "utf8")) };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
/** @param {string} dir */
const withWorkload = (dir) => ["--workload-cgroup", dir];
/** @param {Cgroup} cg @param {string} name @param {string} text */
const edit = (cg, name, text) => writeFileSync(join(cg.dir, name), text);
/** @param {Result} result @param {RegExp} pattern */
const hasReason = (result, pattern) => result.summary.reasons.some((r) => pattern.test(r));

test(
  "a quiet workload cgroup is clean, and the summary names the scope and the observer's identity",
  { skip, timeout: 60000 },
  async () => {
    const result = await observe(withWorkload);
    assert.equal(result.code, 0, String(result.summary.reasons));
    assert.equal(result.summary.clean, true);
    assert.equal(result.summary.scope, "workload-cgroup");
    assert.ok(result.summary.samples >= 3 && result.summary.pid > 0 && result.summary.start_ticks);
  },
);

test(
  "an OOM kill, a swap-out, zswap growth or a memory.stat swap counter change makes the unit unclean",
  { skip, timeout: 60000 },
  async () => {
    /** @type {[string, string, RegExp][]} */
    const cases = [
      ["memory.events", "low 0\nhigh 0\nmax 0\noom 1\noom_kill 1\n", /memory\.events/],
      ["memory.swap.current", "4096\n", /memory\.swap\.current grew/],
      ["memory.zswap.current", "4096\n", /memory\.zswap\.current grew/],
      ["memory.stat", "anon 1\nzswpin 0\nzswpout 3\nzswpwb 0\n", /zswpin, zswpout or zswpwb/],
    ];
    for (const [name, text, reason] of cases) {
      const result = await observe(withWorkload, (cg) => edit(cg, name, text));
      assert.equal(result.code, 1, name);
      assert.ok(hasReason(result, reason), `${name}: ${result.summary.reasons}`);
    }
  },
);

test(
  "workload pressure above the limit, a replaced directory and a missing counter are unclean",
  { skip, timeout: 60000 },
  async () => {
    let result = await observe(withWorkload, (cg) => edit(cg, "memory.pressure", BUSY));
    assert.ok(hasReason(result, /workload pressure/), String(result.summary.reasons));
    result = await observe(withWorkload, (cg) => {
      rmSync(cg.dir, { recursive: true });
      mkdirSync(cg.dir);
      for (const [name, text] of Object.entries(cg.files)) {
        writeFileSync(join(cg.dir, name), text);
      }
    });
    assert.equal(result.code, 1);
    assert.ok(hasReason(result, /replaced/), String(result.summary.reasons));
    result = await observe(withWorkload, (cg) => rmSync(join(cg.dir, "memory.events")));
    assert.equal(result.code, 1);
    assert.ok(hasReason(result, /unreadable/), String(result.summary.reasons));
  },
);

test(
  "no workload cgroup is unclean unless --host-only is given",
  { skip, timeout: 60000 },
  async () => {
    let result = await observe(() => []);
    assert.equal(result.code, 1);
    assert.ok(hasReason(result, /no workload cgroup given/));
    result = await observe(() => ["--host-only"]);
    assert.equal(result.summary.scope, "host-only");
    assert.ok(!hasReason(result, /no workload cgroup given/));
  },
);
