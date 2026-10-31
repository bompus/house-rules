import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const observer = fileURLToPath(new URL("../scripts/unit-observer.py", import.meta.url));
const skip = process.platform !== "linux";
const hz = Number(spawnSync("getconf", ["CLK_TCK"], { encoding: "utf8" }).stdout) || 100;
/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** @typedef {{ dir: string, files: Record<string, string>, proc: string }} Fake */
/** @typedef {{ clean: boolean, scope: string, samples: number, pid: number, start_ticks: string, reasons: string[], window_s: number, workload_memory_current_peak_bytes: number, workload_io_bytes_delta: object, last_sample: number, host_busy_cores_mean: number }} Summary */
/** @typedef {{ code: number | null, summary: Summary, killedAt: number }} Result */
/** @typedef {[number, (f: Fake) => void]} Step */

const PSI = (/** @type {number} */ full) =>
  `some avg10=0.00 avg60=0.00 avg300=0.00 total=0\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=${full}\n`;
const QUIET = PSI(0);
const BUSY = PSI(900000);

/**
 * A fake /proc and a fake quiet cgroup. The observer reads host figures from `proc` (--proc-root), so
 * the tests do not depend on what the machine is doing.
 * @param {string} root
 * @returns {Fake}
 */
function fakeWorld(root) {
  const dir = join(root, "workload.scope");
  const proc = join(root, "proc");
  mkdirSync(dir);
  mkdirSync(join(proc, "pressure"), { recursive: true });
  const files = {
    "cpu.stat": "usage_usec 1000\nuser_usec 900\nsystem_usec 100\n",
    "memory.events": "low 0\nhigh 0\nmax 0\noom 0\noom_kill 0\n",
    "memory.stat": "anon 1\nzswpin 0\nzswpout 0\nzswpwb 0\n",
    "memory.current": "123456\n",
    "io.stat": "8:0 rbytes=100 wbytes=200\n",
    "memory.swap.current": "0\n",
    "memory.zswap.current": "0\n",
    "memory.pressure": QUIET,
    "io.pressure": QUIET,
  };
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(dir, name), text);
  }
  writeFileSync(join(proc, "stat"), "cpu  0 0 0 1000 0 0 0 0 0 0\n");
  writeFileSync(join(proc, "meminfo"), "MemAvailable:   100000000 kB\n");
  writeFileSync(join(proc, "vmstat"), "pswpout 0\nzswpout 0\nzswpwb 0\npgscan_direct 0\n");
  writeFileSync(join(proc, "pressure/memory"), QUIET);
  writeFileSync(join(proc, "pressure/io"), QUIET);
  return { dir, files, proc };
}

/**
 * Runs the observer on the fake world, applies the timed `steps` (ms after the ready marker), then sends
 * SIGTERM `stopAfter` ms after the ready marker, and returns its exit code, summary and kill time.
 * @param {string[]} args extra observer arguments, `{cg}` standing for the fake cgroup directory
 * @param {{ steps?: Step[], stopAfter?: number, hostCores?: number }} [options]
 * @returns {Promise<Result>}
 */
async function observe(args, { steps = [], stopAfter = 2800, hostCores = 0 } = {}) {
  const root = mkdtempSync(join(tmpdir(), "unit-observer-"));
  try {
    const world = fakeWorld(root);
    const output = join(root, "out.json");
    const argv = args.map((a) => a.replace("{cg}", world.dir));
    const child = spawn(
      "python3",
      [observer, "--output", output, "--proc-root", world.proc, ...argv],
      { stdio: "ignore" },
    );
    /** @type {Promise<number | null>} */
    const done = new Promise((resolve) => child.on("exit", resolve));
    for (let i = 0; i < 100 && !existsSync(`${output}.ready`); i++) {
      await sleep(50);
    }
    assert.ok(existsSync(`${output}.ready`), "a ready marker follows the first sample");
    const t0 = Date.now();
    const burner = setInterval(() => {
      const ticks = Math.floor(((Date.now() - t0) / 1000) * hostCores * hz);
      writeFileSync(join(world.proc, "stat"), `cpu  ${ticks} 0 0 1000 0 0 0 0 0 0\n`);
    }, 100);
    const timers = steps.map(([at, fn]) => setTimeout(() => fn(world), at));
    await sleep(stopAfter);
    clearInterval(burner);
    timers.forEach(clearTimeout);
    const killedAt = Date.now();
    child.kill("SIGTERM");
    const code = await done;
    return { code, summary: JSON.parse(readFileSync(output, "utf8")), killedAt };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
/** @param {Fake} f @param {string} name @param {string} text */
const edit = (f, name, text) => writeFileSync(join(f.dir, name), text);
/** @param {Result} r @param {RegExp} pattern */
const reason = (r, pattern) => r.summary.reasons.some((x) => pattern.test(x));
const opts = { skip, timeout: 120000 };

test(
  "a quiet workload cgroup is clean, with the observer's identity and samples",
  opts,
  async () => {
    const r = await observe(["--workload-cgroup", "{cg}"]);
    assert.equal(r.code, 0, String(r.summary.reasons));
    assert.equal(r.summary.scope, "workload-cgroup");
    assert.ok(r.summary.samples >= 3 && r.summary.pid > 0 && r.summary.start_ticks);
    assert.equal(r.summary.workload_memory_current_peak_bytes, 123456);
    assert.deepEqual(r.summary.workload_io_bytes_delta, { rbytes: 0, wbytes: 0 });
  },
);

test("SIGTERM takes a last sample at once, so the unit's tail is covered", opts, async () => {
  const r = await observe(["--workload-cgroup", "{cg}"], { stopAfter: 1500 });
  assert.ok(Math.abs(r.summary.last_sample * 1000 - r.killedAt) < 700);
});

test(
  "an OOM kill, swap growth, zswap growth or a zswap counter change is unclean",
  opts,
  async () => {
    /** @type {[string, string, RegExp][]} */
    const cases = [
      ["memory.events", "low 0\nhigh 0\nmax 0\noom 1\noom_kill 1\n", /memory\.events/],
      ["memory.swap.current", "4096\n", /memory\.swap\.current grew/],
      ["memory.zswap.current", "4096\n", /memory\.zswap\.current grew/],
      ["memory.stat", "anon 1\nzswpin 0\nzswpout 3\nzswpwb 0\n", /zswpin, zswpout or zswpwb/],
    ];
    for (const [name, text, why] of cases) {
      const r = await observe(["--workload-cgroup", "{cg}"], {
        steps: [[1200, (f) => edit(f, name, text)]],
      });
      assert.equal(r.code, 1, name);
      assert.ok(reason(r, why), `${name}: ${r.summary.reasons}`);
    }
  },
);

test(
  "a counter that rises and returns to its first value mid-run is still unclean",
  opts,
  async () => {
    const bump = "low 0\nhigh 0\nmax 0\noom 1\noom_kill 1\n";
    const calm = "low 0\nhigh 0\nmax 0\noom 0\noom_kill 0\n";
    const r = await observe(["--workload-cgroup", "{cg}"], {
      steps: [
        [800, (f) => edit(f, "memory.events", bump)],
        [2200, (f) => edit(f, "memory.events", calm)],
      ],
      stopAfter: 3600,
    });
    assert.ok(reason(r, /memory\.events/), String(r.summary.reasons));
  },
);

test("a missing or vanishing counter is unclean, not skipped", opts, async () => {
  let r = await observe(["--workload-cgroup", "{cg}"], {
    steps: [[800, (f) => rmSync(join(f.dir, "memory.swap.current"))]],
  });
  assert.ok(reason(r, /unreadable/), String(r.summary.reasons));
  r = await observe(["--workload-cgroup", "{cg}"], {
    steps: [[800, (f) => rmSync(join(f.dir, "memory.events"))]],
  });
  assert.ok(reason(r, /unreadable/), String(r.summary.reasons));
  r = await observe(["--workload-cgroup", "{cg}"], {
    steps: [[800, (f) => rmSync(join(f.dir, "memory.zswap.current"))]],
  });
  assert.ok(reason(r, /availability changed/), String(r.summary.reasons));
});

test(
  "pressure over the limit, a replaced directory and a backward counter are unclean",
  opts,
  async () => {
    let r = await observe(["--workload-cgroup", "{cg}"], {
      steps: [[800, (f) => edit(f, "memory.pressure", BUSY)]],
    });
    assert.ok(reason(r, /workload pressure above/), String(r.summary.reasons));
    r = await observe(["--workload-cgroup", "{cg}"], {
      steps: [
        [
          800,
          (f) => {
            // a new directory is made while the old one still exists, so its inode differs
            const replacement = `${f.dir}.new`;
            mkdirSync(replacement);
            for (const [name, text] of Object.entries(f.files)) {
              writeFileSync(join(replacement, name), text);
            }
            renameSync(f.dir, `${f.dir}.old`);
            renameSync(replacement, f.dir);
          },
        ],
      ],
    });
    assert.ok(reason(r, /replaced/), String(r.summary.reasons));
    r = await observe(["--workload-cgroup", "{cg}"], {
      steps: [
        [800, (f) => edit(f, "cpu.stat", "usage_usec 5000\n")],
        [1900, (f) => edit(f, "cpu.stat", "usage_usec 100\n")],
      ],
      stopAfter: 3200,
    });
    assert.ok(reason(r, /went backward/), String(r.summary.reasons));
  },
);

test(
  "host pressure over the limit and unreadable host I/O pressure are unclean, with a summary",
  opts,
  async () => {
    let r = await observe(["--workload-cgroup", "{cg}"], {
      steps: [[800, (f) => writeFileSync(join(f.proc, "pressure/memory"), BUSY)]],
    });
    assert.ok(reason(r, /host pressure above/), String(r.summary.reasons));
    r = await observe(["--workload-cgroup", "{cg}"], {
      steps: [[800, (f) => rmSync(join(f.proc, "pressure/io"))]],
    });
    assert.equal(r.code, 1);
    assert.ok(reason(r, /host pressure unreadable/), String(r.summary.reasons));
  },
);

test(
  "competing CPU: the workload's own is subtracted, a host-only run counts all of it",
  opts,
  async () => {
    // 8 busy host cores and a workload that accounts for 7 of them: 1 competing core, clean
    let r = await observe(["--workload-cgroup", "{cg}"], {
      hostCores: 8,
      steps: [
        [100, (f) => edit(f, "cpu.stat", "usage_usec 7000000\n")],
        [2700, (f) => edit(f, "cpu.stat", "usage_usec 20000000\n")],
      ],
    });
    assert.equal(r.code, 0, `${r.summary.reasons} ${r.summary.host_busy_cores_mean}`);
    // the same 8 cores with an idle workload: 8 competing cores
    r = await observe(["--workload-cgroup", "{cg}"], { hostCores: 8 });
    assert.ok(reason(r, /competing CPU above 4/), String(r.summary.reasons));
    r = await observe(["--host-only"], { hostCores: 8 });
    assert.ok(reason(r, /competing CPU above 4/), String(r.summary.reasons));
  },
);

test(
  "no workload cgroup is unclean unless --host-only is given; host swap rejects only a storage phase",
  opts,
  async () => {
    let r = await observe([]);
    assert.ok(reason(r, /no workload cgroup given/));
    r = await observe(["--host-only"]);
    assert.equal(r.summary.scope, "host-only");
    assert.equal(r.code, 0, String(r.summary.reasons));
    /** @type {Step} */
    const swap = [
      1200,
      (/** @type {Fake} */ f) =>
        writeFileSync(join(f.proc, "vmstat"), "pswpout 9\nzswpout 0\nzswpwb 0\n"),
    ];
    r = await observe(["--host-only"], { steps: [swap] });
    assert.equal(r.code, 0, "recorded, not rejected");
    r = await observe(["--host-only", "--storage-phase"], { steps: [swap] });
    assert.ok(reason(r, /storage phase/), String(r.summary.reasons));
  },
);

test(
  "a workload cgroup that is empty, slash-only or not a directory fails at once, with a summary and no ready marker",
  opts,
  () => {
    const root = mkdtempSync(join(tmpdir(), "unit-observer-"));
    try {
      for (const bad of ["/", "//", join(root, "missing")]) {
        const output = join(root, "bad.json");
        const result = spawnSync(
          "python3",
          [observer, "--output", output, "--workload-cgroup", bad],
          {
            timeout: 20000,
          },
        );
        assert.equal(result.status, 1, bad);
        /** @type {Summary} */
        const summary = JSON.parse(readFileSync(output, "utf8"));
        assert.equal(summary.clean, false);
        assert.ok(
          summary.reasons.some((x) => /not a directory/.test(x)),
          String(summary.reasons),
        );
        assert.ok(!existsSync(`${output}.ready`), "no ready marker when the setup failed");
        rmSync(output);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
