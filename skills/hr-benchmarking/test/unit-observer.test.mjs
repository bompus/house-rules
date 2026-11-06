import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
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
 * @param {{ steps?: Step[], stopAfter?: number, hostCores?: number, setup?: (f: Fake) => void }} [options]
 * @returns {Promise<Result>}
 */
async function observe(
  args,
  { steps = [], stopAfter = 2800, hostCores = 0, setup = () => {} } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "unit-observer-"));
  try {
    const world = fakeWorld(root);
    setup(world);
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
  // The periodic samples are a second apart and the kill comes half-way between two, so only a sample
  // taken at the stop itself can be this close to it.
  assert.ok(Math.abs(r.summary.last_sample * 1000 - r.killedAt) < 250);
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
          summary.reasons.some((x) => x.includes("not a directory")),
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

test(
  "observer CPU is budgeted over the collection interval, not the process lifetime",
  opts,
  async () => {
    // Interpreter start-up and setup CPU come before the first sample; a short unit must not be
    // rejected for it. The lifetime figure is still reported beside the budgeted one.
    const r = await observe(["--workload-cgroup", "{cg}", "--max-observer-cores", "0.2"], {
      stopAfter: 100,
    });
    assert.ok(!reason(r, /observer CPU over budget/), String(r.summary.reasons));
    const summary = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (r.summary));
    const lifetime = Number(summary.observer_cpu_s);
    const interval = Number(summary.observer_cpu_interval_s);
    assert.ok(interval >= 0 && lifetime >= interval, `${lifetime} ${interval}`);
  },
);

/**
 * @param {string[]} reasons
 * @param {string} prefix
 */
const hasReason = (reasons, prefix) => reasons.some((r) => r.startsWith(prefix));

// The budget arithmetic with controlled counters: no sleeping, no process timing.
/**
 * @param {number} lifetime process CPU in seconds, from os.times()
 * @param {number} first observer CPU at the first sample
 * @param {number} last observer CPU at the last sample
 * @param {number} span seconds between the samples
 * @param {{ rssMib?: number, maxRssMib?: number }} [options] the resident peak the observer reports and its budget
 */
function budgetReasons(lifetime, first, last, span, { rssMib = 1, maxRssMib = 1e9 } = {}) {
  const root = mkdtempSync(join(tmpdir(), "unit-observer-budget-"));
  try {
    const script = `
import importlib.util, json, os, sys
spec = importlib.util.spec_from_file_location("observer", ${JSON.stringify(observer)})
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
os.times = lambda: (${lifetime}, 0.0, 0.0, 0.0, 0.0)
m.self_status = lambda field: ${rssMib} * 1024
class A:
    output = ${JSON.stringify(join(root, "out.json"))}
    max_observer_cores = 0.2
    max_observer_rss_mib = ${maxRssMib}
samples = [{"t": 0.0, "wall": 1.0, "cpu": ${first}}, {"t": ${span}, "wall": 2.0, "cpu": ${last}}]
m.write_summary(A, samples, [], {"scope": "host-only", "workload_cgroup": None}, "ok")
print(json.dumps(json.load(open(A.output))))
`;
    const run = spawnSync("python3", ["-c", script], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    return JSON.parse(run.stdout);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("observer CPU budget uses the CPU between the first and last sample", { skip }, () => {
  // 0.5 s of start-up CPU before the first sample, 0.15 s between samples with 0.01 s spent.
  const quiet = budgetReasons(0.5, 0.4, 0.41, 0.15);
  assert.ok(!hasReason(quiet.reasons, "observer CPU over budget"), String(quiet.reasons));
  assert.equal(quiet.observer_cpu_s, 0.5);
  assert.equal(quiet.observer_cpu_interval_s, 0.01);
  // The same lifetime CPU but 0.1 s spent inside the interval is 0.67 cores: over the 0.2 budget.
  const busy = budgetReasons(0.5, 0.4, 0.5, 0.15);
  assert.ok(hasReason(busy.reasons, "observer CPU over budget"));
});

test("the observer budgets compare the figures before they are rounded", { skip }, () => {
  // 0.03006 s of CPU in 0.15 s is 0.2004 cores, which the summary rounds to 0.2: still over a 0.2 budget.
  const cpu = budgetReasons(0.5, 0.4, 0.43006, 0.15);
  assert.equal(cpu.observer_cpu_cores_mean, 0.2);
  assert.ok(hasReason(cpu.reasons, "observer CPU over budget: 0.2004 > 0.2"), String(cpu.reasons));
  // 128.04 MiB resident is reported as 128 and is over a 128 MiB budget.
  const rss = budgetReasons(0.5, 0.4, 0.41, 0.15, { rssMib: 128.04, maxRssMib: 128 });
  assert.equal(rss.observer_rss_peak_mib, 128);
  assert.ok(
    hasReason(rss.reasons, "observer resident memory over budget: 128.04 > 128"),
    String(rss.reasons),
  );
  // Exactly on the budget is within it.
  const within = budgetReasons(0.5, 0.4, 0.41, 0.15, { rssMib: 128, maxRssMib: 128 });
  assert.ok(!hasReason(within.reasons, "observer resident memory over budget"));
});

test(
  "the admission limits are flags, and the defaults are unchanged without them",
  opts,
  async () => {
    // 8 busy cores with an idle workload fail the default competing-CPU limit of 4 ...
    let r = await observe(["--workload-cgroup", "{cg}"], { hostCores: 8 });
    assert.ok(reason(r, /competing CPU above 4/), String(r.summary.reasons));
    // ... and pass a protocol's own larger limit.
    r = await observe(["--workload-cgroup", "{cg}", "--max-competing-cores", "9"], {
      hostCores: 8,
    });
    assert.ok(!reason(r, /competing CPU/), String(r.summary.reasons));
    // The fake host has 100000000 kB (about 95 GiB) available: a higher floor rejects the first sample.
    const low = await observeToExit(
      ["--workload-cgroup", "{cg}", "--min-avail-gib", "200"],
      () => {},
    );
    assert.ok(
      low.summary?.reasons.some((/** @type {string} */ x) =>
        x.includes("available memory below 200"),
      ),
      String(low.summary?.reasons),
    );
    // Busy pressure fails the default 10 ms limit and passes a looser one.
    r = await observe(["--workload-cgroup", "{cg}", "--mem-psi-ms", "100000"], {
      steps: [[300, (f) => edit(f, "memory.pressure", BUSY)]],
    });
    assert.ok(!reason(r, /workload pressure above/), String(r.summary.reasons));
  },
);

/**
 * Runs the observer's `judge` on synthetic host samples, as [monotonic seconds, memory PSI µs, I/O PSI µs],
 * with optional fourth and fifth elements: the times the memory and I/O PSI totals were read, when they
 * differ from the sample start, and a sixth: the time the sample's reads ended, when it differs from the
 * sample start.
 * @param {number[][]} rows
 * @param {{ storagePhase?: boolean, vms?: Record<string, number>[] }} [options] the storage-phase flag,
 * and each sample's host swap counters
 * @returns {{ reasons: string[], out: Record<string, number> }}
 */
function judgeRows(rows, { storagePhase = false, vms = [] } = {}) {
  const script = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("observer", ${JSON.stringify(observer)})
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
class Args:
    storage_phase = ${storagePhase ? "True" : "False"}
rows = json.loads(sys.stdin.read())
vms = json.loads(${JSON.stringify(JSON.stringify(vms))})
samples = [{"t": r[0], "wall": r[0], "cpu": 0.0, "busy_ticks": 0, "mem_psi": r[1], "io_psi": r[2],
            "mem_psi_t": r[3] if len(r) > 3 else r[0],
            "io_psi_t": r[4] if len(r) > 4 else (r[3] if len(r) > 3 else r[0]),
            "psi_t": max(r[3:5]) if len(r) > 3 else r[0],
            "t_end": r[5] if len(r) > 5 else r[0],
            "avail_gib": 64.0, "vm": vms[i] if i < len(vms) else {}, "workload": None}
           for i, r in enumerate(rows)]
reasons, out = m.judge(samples, None, 100.0, Args)
print(json.dumps({"reasons": reasons, "out": out}))
`;
  const run = spawnSync("python3", ["-c", script], {
    input: JSON.stringify(rows),
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}
const stalled = (/** @type {string[]} */ reasons) =>
  reasons.some((x) => x.includes("pressure above"));

test(
  "PSI is judged per nominal one-second interval: a short final interval is scaled up, a long gap down",
  { skip },
  () => {
    // 92 ms of I/O stall in a 0.43 s final interval counts as 184 ms (the interval is floored at half a
    // second): over the 100 ms limit.
    assert.ok(
      stalled(
        judgeRows([
          [0, 0, 0],
          [1, 0, 0],
          [1.43, 0, 92000],
        ]).reasons,
      ),
    );
    // 150 ms spread over a 2.4 s gap is 62 ms per second: within it.
    assert.ok(
      !stalled(
        judgeRows([
          [0, 0, 0],
          [1, 0, 0],
          [3.4, 0, 150000],
        ]).reasons,
      ),
    );
    // The same 150 ms in a normal one-second interval is over it, as before.
    assert.ok(
      stalled(
        judgeRows([
          [0, 0, 0],
          [1, 0, 0],
          [2, 0, 150000],
        ]).reasons,
      ),
    );
    // An interval is never counted as shorter than half a second, so a stop right after a sample
    // cannot turn a millisecond of stall into a rejection.
    assert.ok(
      !stalled(
        judgeRows([
          [0, 0, 0],
          [1, 0, 0],
          [1.001, 0, 1000],
        ]).reasons,
      ),
    );
    // The figure recorded is the same per-second rate.
    assert.equal(
      judgeRows([
        [0, 0, 0],
        [1, 0, 0],
        [1.5, 0, 40000],
      ]).out.host_io_full_psi_ms_max,
      80,
    );
  },
);

test("a gap over the sampling limit rejects the unit", { skip }, () => {
  const { reasons } = judgeRows([
    [0, 0, 0],
    [1, 0, 0],
    [3.6, 0, 0],
  ]);
  assert.ok(
    reasons.some((x) => /gap above 2.5 s/.test(x)),
    String(reasons),
  );
});

test("a final sample whose reads block past the sampling limit rejects the unit", { skip }, () => {
  // The sample starts 1 s after the previous one but its reads end 2.71 s later: a gap measured only
  // between sample starts would call this clean.
  const stall = judgeRows([
    [0, 0, 0],
    [1, 0, 0],
    [2, 0, 0, 2, 2, 4.71],
  ]);
  assert.ok(
    stall.reasons.some((x) => /reads took longer than 2.5 s/.test(x)),
    String(stall.reasons),
  );
  // Reads that end within the limit are clean.
  const quick = judgeRows([
    [0, 0, 0],
    [1, 0, 0],
    [2, 0, 0, 2, 2, 2.4],
  ]);
  assert.deepEqual(quick.reasons, []);
});

test("a storage phase needs the host pswpout counter in every sample", { skip }, () => {
  const rows = [
    [0, 0, 0],
    [1, 0, 0],
    [2, 0, 0],
  ];
  const have = { pswpout: 0, zswpout: 0, zswpwb: 0 };
  const unreadable = (/** @type {string[]} */ reasons) =>
    reasons.some((x) => x.includes("swap counter unreadable"));
  assert.deepEqual(judgeRows(rows, { storagePhase: true, vms: [have, have, have] }).reasons, []);
  // Missing from every sample, and vanishing after the first.
  assert.ok(unreadable(judgeRows(rows, { storagePhase: true, vms: [{}, {}, {}] }).reasons));
  assert.ok(unreadable(judgeRows(rows, { storagePhase: true, vms: [have, have, {}] }).reasons));
  // A zswap counter the first sample had must stay readable; a host without zswap is not rejected for it.
  const pswpoutOnly = { pswpout: 0 };
  assert.ok(
    unreadable(judgeRows(rows, { storagePhase: true, vms: [have, have, pswpoutOnly] }).reasons),
  );
  assert.ok(
    !unreadable(
      judgeRows(rows, { storagePhase: true, vms: [pswpoutOnly, pswpoutOnly, pswpoutOnly] }).reasons,
    ),
  );
  // Outside a storage phase the counter is only recorded.
  assert.ok(!unreadable(judgeRows(rows, { vms: [{}, {}, {}] }).reasons));
});

/**
 * Runs the observer until it exits by itself, on a fake world changed first by `mutate`.
 * @param {string[]} args
 * @param {(f: Fake) => void} mutate
 */
async function observeToExit(args, mutate) {
  const root = mkdtempSync(join(tmpdir(), "unit-observer-"));
  try {
    const world = fakeWorld(root);
    mutate(world);
    const output = join(root, "out.json");
    const argv = args.map((a) => a.replace("{cg}", world.dir));
    const child = spawn(
      "python3",
      [observer, "--output", output, "--proc-root", world.proc, ...argv],
      { stdio: "ignore" },
    );
    /** @type {Promise<number | string | null>} */
    const done = new Promise((resolve) => child.on("exit", resolve));
    const timer = setTimeout(() => child.kill("SIGKILL"), 4000);
    const code = await done;
    clearTimeout(timer);
    return {
      code,
      ready: existsSync(`${output}.ready`),
      summary: existsSync(output) ? JSON.parse(readFileSync(output, "utf8")) : null,
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test(
  "a first sample that already fails writes no .ready marker and ends the run",
  opts,
  async () => {
    /** @type {[string, (f: Fake) => void, RegExp][]} */
    const cases = [
      [
        "unreadable host PSI",
        (f) => rmSync(join(f.proc, "pressure", "memory")),
        /pressure unreadable/,
      ],
      [
        "available memory under the floor",
        (f) => writeFileSync(join(f.proc, "meminfo"), "MemAvailable:   1000 kB\n"),
        /available memory below/,
      ],
      [
        "a missing workload swap counter",
        (f) => rmSync(join(f.dir, "memory.swap.current")),
        /workload cgroup counters unreadable/,
      ],
    ];
    for (const [name, mutate, expected] of cases) {
      const r = await observeToExit(["--workload-cgroup", "{cg}"], mutate);
      assert.equal(r.code, 1, name);
      assert.equal(r.ready, false, `${name}: .ready was written`);
      assert.ok(
        r.summary?.reasons.some((/** @type {string} */ x) => expected.test(x)),
        `${name}: ${r.summary?.reasons}`,
      );
    }
  },
);

test(
  "a counter that disappears mid-run rejects the unit, and one never provided stays unknown",
  opts,
  async () => {
    let r = await observe(["--workload-cgroup", "{cg}"], {
      steps: [[300, (f) => rmSync(join(f.dir, "memory.current"))]],
    });
    assert.ok(reason(r, /memory\.current became unreadable/), String(r.summary.reasons));
    r = await observe(["--workload-cgroup", "{cg}"], {
      steps: [[300, (f) => rmSync(join(f.dir, "io.stat"))]],
    });
    assert.ok(reason(r, /io\.stat became unreadable/), String(r.summary.reasons));
    r = await observe(["--workload-cgroup", "{cg}"], {
      setup: (f) => {
        rmSync(join(f.dir, "memory.current"));
        rmSync(join(f.dir, "io.stat"));
      },
    });
    assert.equal(r.code, 0, String(r.summary.reasons));
    assert.equal(r.summary.workload_memory_current_peak_bytes, "unknown");
    assert.equal(r.summary.workload_io_bytes_delta, "unknown");
  },
);

/**
 * Runs the observer's main() with `--workload-cgroup auto` after `patch` (Python run in the module's
 * namespace as `m`), and returns its summary.
 * @param {string} patch
 */
function runAuto(patch) {
  const root = mkdtempSync(join(tmpdir(), "unit-observer-"));
  try {
    const world = fakeWorld(root);
    const output = join(root, "out.json");
    const script = `
import importlib.util, os, sys
spec = importlib.util.spec_from_file_location("observer", ${JSON.stringify(observer)})
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
${patch}
sys.argv = ["unit-observer.py", "--workload-cgroup", "auto", "--output", ${JSON.stringify(output)},
            "--proc-root", ${JSON.stringify(world.proc)}]
try:
    m.main()
except SystemExit:
    pass
`;
    const run = spawnSync("python3", ["-c", script], { encoding: "utf8", timeout: 4000 });
    assert.equal(run.status, 0, run.stderr);
    return {
      ready: existsSync(`${output}.ready`),
      summary: JSON.parse(readFileSync(output, "utf8")),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test(
  "--workload-cgroup auto fails closed when the parent is outside any workload cgroup",
  { skip },
  () => {
    // A parent that is pid 1 (a double fork, a service started without --scope) is not the unit's shell.
    let r = runAuto("os.getppid = lambda: 1");
    assert.equal(r.ready, false);
    assert.equal(r.summary.observer, "failed");
    assert.equal(r.summary.clean, false);
    assert.ok(
      r.summary.reasons.some((/** @type {string} */ x) => x.includes("parent is pid 1")),
      String(r.summary.reasons),
    );
    // A parent in the root cgroup would make the whole host the workload.
    r = runAuto('orig = m.read\nm.read = lambda p: ["0::/"] if p.endswith("/cgroup") else orig(p)');
    assert.equal(r.ready, false);
    assert.equal(r.summary.observer, "failed");
    assert.ok(
      r.summary.reasons.some((/** @type {string} */ x) => x.includes("root cgroup")),
      String(r.summary.reasons),
    );
  },
);

test(
  "--workload-cgroup auto still resolves the cgroup of a parent inside one",
  { skip },
  async () => {
    const own = readFileSync("/proc/self/cgroup", "utf8")
      .split("\n")
      .find((line) => line.startsWith("0::"));
    // A container without its own cgroup namespace view reports "/" and cannot show the documented case.
    if (
      own === undefined ||
      own === "0::/" ||
      !existsSync("/sys/fs/cgroup/cgroup.controllers") ||
      !existsSync(`/sys/fs/cgroup${own.slice(3)}`)
    ) {
      return;
    }
    const root = mkdtempSync(join(tmpdir(), "unit-observer-"));
    try {
      const world = fakeWorld(root);
      const output = join(root, "out.json");
      // The observer is a background child of a shell, as the reference documents.
      const shell = spawn(
        "bash",
        [
          "-c",
          `python3 ${observer} --workload-cgroup auto --output ${output} --proc-root ${world.proc} & pid=$!; sleep 1.5; kill -TERM $pid; wait $pid`,
        ],
        { stdio: "ignore" },
      );
      await new Promise((resolve) => shell.on("exit", resolve));
      const summary = JSON.parse(readFileSync(output, "utf8"));
      assert.equal(summary.workload_cgroup, `/sys/fs/cgroup${own.slice(3)}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test("the admission limit flags must be positive numbers", { skip }, () => {
  for (const flag of [
    "--max-gap-s",
    "--min-avail-gib",
    "--mem-psi-ms",
    "--io-psi-ms",
    "--max-competing-cores",
  ]) {
    for (const value of ["0", "-1", "nan"]) {
      const run = spawnSync("python3", [observer, "--output", "/dev/null", flag, value], {
        encoding: "utf8",
      });
      assert.equal(run.status, 2, `${flag} ${value}`);
      assert.ok(run.stderr.includes("positive number"), `${flag} ${value}: ${run.stderr}`);
    }
  }
});

test(
  "PSI is scaled by the time between the counter reads, not between the sample starts",
  { skip },
  () => {
    // The first sample began at 0 but read its PSI counters at 0.1: the first interval's reads are 0.9 s
    // apart, so 95 ms of stall in it is 105 ms per second, over the limit (by the starts it is 95).
    assert.ok(
      stalled(
        judgeRows([
          [0, 0, 0, 0.1],
          [1, 0, 95000],
          [2, 0, 95000],
        ]).reasons,
      ),
    );
    assert.ok(
      !stalled(
        judgeRows([
          [0, 0, 0],
          [1, 0, 95000],
          [2, 0, 95000],
        ]).reasons,
      ),
    );
  },
);

test(
  "a counter that is absent at first and appears later stays unknown, not rejected",
  opts,
  async () => {
    const r = await observe(["--workload-cgroup", "{cg}"], {
      setup: (f) => {
        rmSync(join(f.dir, "memory.current"));
        rmSync(join(f.dir, "io.stat"));
      },
      steps: [
        [300, (f) => writeFileSync(join(f.dir, "memory.current"), "123456\n")],
        [300, (f) => writeFileSync(join(f.dir, "io.stat"), "8:0 rbytes=100 wbytes=200\n")],
      ],
    });
    assert.equal(r.code, 0, String(r.summary.reasons));
    assert.equal(r.summary.workload_memory_current_peak_bytes, "unknown");
    assert.equal(r.summary.workload_io_bytes_delta, "unknown");
  },
);

test("memory and I/O PSI are each scaled by the time between their own reads", { skip }, () => {
  // Memory PSI is read at 0 and 1 s and rises 12 ms, but the second I/O read comes 0.5 s late: a stamp
  // shared by both reads would make the interval 1.5 s and the rate 8 ms, under the 10 ms limit.
  assert.ok(
    stalled(
      judgeRows([
        [0, 0, 0, 0, 0],
        [1, 12000, 0, 1, 1.5],
        [2, 12000, 0, 2, 2],
      ]).reasons,
    ),
  );
});

test("pressure reads further apart than the sampling limit reject the unit", { skip }, () => {
  // Sample starts are 2.4 s and 2.2 s apart, but the second PSI read came 3.6 s after the first, so
  // pressure went unobserved for longer than the limit; 300 ms over it would scale to 83 ms.
  const { reasons } = judgeRows([
    [0, 0, 0, 0],
    [2.4, 0, 300000, 3.6],
    [4.6, 0, 300000, 4.6],
  ]);
  assert.ok(
    reasons.some((x) => x.includes("pressure reads more than 2.5 s apart")),
    String(reasons),
  );
});

test(
  "an optional counter that cannot be read from the start is unknown, not a failed first sample",
  opts,
  async () => {
    if (process.getuid?.() === 0) {
      return; // root reads a mode-000 file
    }
    const r = await observe(["--workload-cgroup", "{cg}"], {
      setup: (f) => {
        chmodSync(join(f.dir, "memory.current"), 0);
        chmodSync(join(f.dir, "io.stat"), 0);
      },
    });
    assert.equal(r.code, 0, String(r.summary.reasons));
    assert.equal(r.summary.workload_memory_current_peak_bytes, "unknown");
    assert.equal(r.summary.workload_io_bytes_delta, "unknown");
  },
);
