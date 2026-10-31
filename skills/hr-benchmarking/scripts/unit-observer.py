#!/usr/bin/env python3
"""Continuous observer for one measured unit on a native Linux host.

Run it beside a unit (a timed run, a phase) that executes inside one cgroup. It samples once a
second until SIGTERM or SIGINT, takes one last sample at that moment, then writes one JSON summary
to --output (and every sample to `<output>.samples.jsonl`) and exits 0 when the unit may count, 1
when it may not. It writes `<output>.ready` after its first sample; start the unit after that.

Limits are the host benchmarking rules'. Host scope: available memory at least 8 GiB in every
sample (unrounded); memory full PSI at most 10 ms and I/O full PSI at most 100 ms in any observation
interval; coverage with no gap over 2.5 s (monotonic clock) and at least two samples; PSI must be
readable. Competing CPU: the mean over the whole run of host busy cores minus the workload
cgroup's own CPU (usage_usec, descendants included) is at most 4; with --host-only there is no
workload to subtract, so the unit's own CPU counts. Workload scope (the cgroup given with
--workload-cgroup, or `auto` for the observer's parent's cgroup): the same pressure limits on its
own pressure files; in every sample no growth of memory.swap.current or memory.zswap.current over
the first sample, no change of zswpin, zswpout or zswpwb and no change of memory.events high, max,
oom or oom_kill from the first sample, the same directory (device and inode), readable required
counters, and the same set of optional counters (zswap) as in the first sample. A counter that goes
backward is a failure.

Host-wide swap-out and zswap activity (pswpout, zswpout, zswpwb) is recorded for every interval
and rejects the unit only with --storage-phase, the phases the rules name.

Observer cost is recorded (CPU, resident peak, output bytes) and checked against budgets
(--max-observer-cores, default 0.05; --max-observer-rss-mib, default 128); a protocol declares its
own. A clean summary does not by itself qualify a run: the protocol still has to declare the
observers, budgets, stop rules and retries, and keep the receipts. A zswap counter the kernel does
not provide is recorded as absent.
"""

import argparse
import json
import os
import signal
import sys
import threading
import time

SWAPS = ("pswpout", "zswpout", "zswpwb")
WORKLOAD_STAT = ("zswpin", "zswpout", "zswpwb")
EVENTS = ("high", "max", "oom", "oom_kill")
MAX_GAP_S = 2.5
MAX_COMPETING_CORES = 4
MIN_AVAIL_GIB = 8
MEM_PSI_MS = 10
IO_PSI_MS = 100
PROC = "/proc"
stop = threading.Event()


def on_signal(_signum, _frame):
    stop.set()


def read(path):
    with open(path) as f:
        return f.read().splitlines()


def keyed(path):
    out = {}
    for line in read(path):
        parts = line.split()
        if len(parts) == 2:
            out[parts[0]] = int(parts[1])
    return out


def psi_full(path):
    """The `full` total in microseconds, or None when the file is absent or has no `full` line."""
    try:
        for line in read(path):
            if line.startswith("full"):
                return int(line.split("total=")[1])
    except (FileNotFoundError, ValueError, IndexError):
        pass
    return None


def avail_gib():
    for line in read(f"{PROC}/meminfo"):
        if line.startswith("MemAvailable"):
            return int(line.split()[1]) / 1048576
    raise OSError("MemAvailable missing")


def host_busy_ticks():
    v = [int(x) for x in read(f"{PROC}/stat")[0].split()[1:9]]
    return sum(v) - v[3] - v[4]


def vmstat():
    all_counters = keyed(f"{PROC}/vmstat")
    return {k: all_counters[k] for k in SWAPS if k in all_counters}


def self_status(field):
    for line in read("/proc/self/status"):
        if line.startswith(field):
            return int(line.split()[1])
    return 0


def start_ticks():
    return read("/proc/self/stat")[0].rsplit(")", 1)[1].split()[19]


def own_cgroup(pid):
    path = None
    for line in read(f"/proc/{pid}/cgroup"):
        if line.startswith("0::"):
            path = line[3:]
    if path is None:
        raise OSError("no cgroup v2 path for the observer's parent")
    for root in ("/sys/fs/cgroup", "/sys/fs/cgroup/unified"):
        if os.path.exists(f"{root}/cgroup.controllers"):
            return root + path
    raise OSError("no unified cgroup v2 mount found")


def workload_sample(path):
    """The workload cgroup's counters, or None when a required one is unreadable."""
    try:
        st = os.stat(path)
        events = {k: v for k, v in keyed(f"{path}/memory.events").items() if k in EVENTS}
        if set(events) != set(EVENTS):
            return None
        stat = keyed(f"{path}/memory.stat")
        zswap = None
        if os.path.exists(f"{path}/memory.zswap.current"):
            zswap = int(read(f"{path}/memory.zswap.current")[0])
        return {
            "id": [st.st_dev, st.st_ino],
            "cpu_usec": keyed(f"{path}/cpu.stat")["usage_usec"],
            "events": events,
            "stat": {k: stat[k] for k in WORKLOAD_STAT if k in stat},
            "swap": int(read(f"{path}/memory.swap.current")[0]),
            "zswap": zswap,
            "mem_psi": psi_full(f"{path}/memory.pressure"),
            "io_psi": psi_full(f"{path}/io.pressure"),
        }
    except (OSError, KeyError, ValueError, IndexError):
        return None


def take(cg):
    return {
        "t": time.monotonic(),
        "wall": time.time(),
        "busy_ticks": host_busy_ticks(),
        "mem_psi": psi_full(f"{PROC}/pressure/memory"),
        "io_psi": psi_full(f"{PROC}/pressure/io"),
        "avail_gib": avail_gib(),
        "vm": vmstat(),
        "workload": workload_sample(cg) if cg else None,
    }


def judge(samples, cg, hz, args):
    """The reasons the unit may not count, and the figures behind them."""
    reasons = []
    out = {}
    if len(samples) < 2:
        return ["fewer than two samples"], out
    steps = list(zip(samples, samples[1:], strict=False))
    gaps = [b["t"] - a["t"] for a, b in steps]
    total = samples[-1]["t"] - samples[0]["t"]
    out.update(window_s=round(total, 1), max_gap_s=round(max(gaps), 2))
    if min(gaps) <= 0 or max(gaps) > MAX_GAP_S:
        reasons.append("sampling interval not positive or gap above 2.5 s")
        return reasons, out
    busy = [s["busy_ticks"] for s in samples]
    if any(b < a for a, b in zip(busy, busy[1:], strict=False)):
        reasons.append("host CPU counter went backward")
    host_cores = (busy[-1] - busy[0]) / hz / total
    out["host_busy_cores_mean"] = round(host_cores, 2)
    min_avail = min(s["avail_gib"] for s in samples)
    out["avail_gib_min"] = round(min_avail, 3)
    if min_avail < MIN_AVAIL_GIB:
        reasons.append("available memory below 8 GiB")
    reasons += pressure_reasons(
        [(s["mem_psi"], s["io_psi"]) for s in samples], gaps, out, "host", "host"
    )
    swaps = [{k: b["vm"][k] - a["vm"][k] for k in a["vm"] if k in b["vm"]} for a, b in steps]
    out["host_swap_deltas_by_interval"] = swaps
    if args.storage_phase and any(v for d in swaps for v in d.values()):
        reasons.append("host swap-out or zswap activity in a storage phase")
    workload = [s["workload"] for s in samples]
    w_cores = 0.0
    if cg:
        if any(w is None for w in workload):
            reasons.append("workload cgroup counters unreadable or the directory went missing")
        else:
            w_reasons, w_cores = workload_reasons(workload, gaps, total, out)
            reasons += w_reasons
    competing = host_cores - w_cores
    out["competing_cpu_cores_mean"] = round(competing, 2)
    if competing > MAX_COMPETING_CORES:
        reasons.append("competing CPU above 4 cores")
    return reasons, out


def pressure_reasons(pairs, gaps, out, label, key):
    """Memory and I/O full PSI over each observation interval; both must be readable."""
    if any(m is None or i is None for m, i in pairs):
        return [f"{label} pressure unreadable"]
    mem = [b[0] - a[0] for a, b in zip(pairs, pairs[1:], strict=False)]
    io = [b[1] - a[1] for a, b in zip(pairs, pairs[1:], strict=False)]
    if min(mem + io) < 0:
        return [f"{label} pressure counter went backward"]
    out[f"{key}_mem_full_psi_ms_max"] = round(max(mem) / 1000, 2)
    out[f"{key}_io_full_psi_ms_max"] = round(max(io) / 1000, 2)
    if max(mem) > MEM_PSI_MS * 1000 or max(io) > IO_PSI_MS * 1000:
        return [f"{label} pressure above the limit in an interval"]
    return []


def workload_reasons(w, gaps, total, out):
    reasons = []
    first = w[0]
    cpu = [x["cpu_usec"] for x in w]
    if any(b < a for a, b in zip(cpu, cpu[1:], strict=False)):
        reasons.append("workload CPU counter went backward")
    cores = (cpu[-1] - cpu[0]) / 1e6 / total
    out["workload_cpu_cores_mean"] = round(cores, 2)
    if any(x["id"] != first["id"] for x in w):
        reasons.append("workload cgroup replaced")
    if any((x["zswap"] is None) != (first["zswap"] is None) for x in w):
        reasons.append("memory.zswap.current availability changed")
    if any(set(x["stat"]) != set(first["stat"]) for x in w):
        reasons.append("memory.stat swap counters availability changed")
    if any(x["swap"] > first["swap"] for x in w):
        reasons.append("memory.swap.current grew")
    if first["zswap"] is not None and any((x["zswap"] or 0) > first["zswap"] for x in w):
        reasons.append("memory.zswap.current grew")
    if any(x["stat"] != first["stat"] for x in w):
        reasons.append("workload zswpin, zswpout or zswpwb changed")
    if any(x["events"] != first["events"] for x in w):
        reasons.append("workload memory.events high, max, oom or oom_kill changed")
    out["workload_zswap"] = "absent" if first["zswap"] is None else "present"
    reasons += pressure_reasons(
        [(x["mem_psi"], x["io_psi"]) for x in w], gaps, out, "workload", "workload"
    )
    return reasons, cores


def write_summary(args, samples, reasons, out, status):
    summary = {
        "observer": status,
        "pid": os.getpid(),
        "start_ticks": start_ticks(),
        "scope": out.pop("scope"),
        "workload_cgroup": out.pop("workload_cgroup"),
        "samples": len(samples),
        "first_sample": samples[0]["wall"] if samples else None,
        "last_sample": samples[-1]["wall"] if samples else None,
        **out,
    }
    if samples:
        with open(args.output + ".samples.jsonl", "w") as f:
            for s in samples:
                f.write(json.dumps(s) + "\n")
        cpu_s = sum(os.times()[:2])
        span = max(samples[-1]["t"] - samples[0]["t"], 1e-9)
        summary.update(
            observer_cpu_s=round(cpu_s, 2),
            observer_cpu_cores_mean=round(cpu_s / span, 3),
            observer_rss_peak_mib=round(self_status("VmHWM") / 1024, 1),
            samples_bytes=os.path.getsize(args.output + ".samples.jsonl"),
        )
        if summary["observer_cpu_cores_mean"] > args.max_observer_cores:
            reasons.append("observer CPU over budget")
        if summary["observer_rss_peak_mib"] > args.max_observer_rss_mib:
            reasons.append("observer resident memory over budget")
    summary["reasons"] = reasons
    summary["clean"] = not reasons
    with open(args.output, "w") as f:
        f.write(json.dumps(summary) + "\n")
    return summary["clean"]


def main():
    global PROC
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--output", default=os.environ.get("OBSERVER_OUT"))
    ap.add_argument("--workload-cgroup", default=os.environ.get("WORKLOAD_CGROUP"))
    ap.add_argument("--host-only", action="store_true")
    ap.add_argument("--storage-phase", action="store_true")
    ap.add_argument("--max-observer-cores", type=float, default=0.05)
    ap.add_argument("--max-observer-rss-mib", type=float, default=128)
    ap.add_argument("--proc-root", default="/proc", help="for tests: where /proc/stat etc. live")
    args = ap.parse_args()
    if not args.output:
        ap.error("--output or OBSERVER_OUT is required")
    PROC = args.proc_root
    for stale in (args.output, args.output + ".ready", args.output + ".samples.jsonl"):
        if os.path.exists(stale):
            os.remove(stale)
    signal.signal(signal.SIGTERM, on_signal)
    signal.signal(signal.SIGINT, on_signal)
    hz = float(os.sysconf("SC_CLK_TCK"))
    out = {"scope": "host-only", "workload_cgroup": None}
    samples = []
    reasons = []
    status = "ok"
    try:
        cg = None
        if args.workload_cgroup:
            cg = args.workload_cgroup.rstrip("/")
            if cg == "auto":
                cg = own_cgroup(os.getppid())
            out.update(scope="workload-cgroup", workload_cgroup=cg)
        elif not args.host_only:
            reasons.append("no workload cgroup given")
        samples.append(take(cg))
        open(args.output + ".ready", "w").close()
        while not stop.wait(1.0):
            samples.append(take(cg))
        samples.append(take(cg))  # the boundary at the stop, so the unit's tail is covered
        judged, figures = judge(samples, cg, hz, args)
        reasons += judged
        out.update(figures)
    except (OSError, ValueError, KeyError, IndexError) as error:
        status = "failed"
        reasons.append(f"observer error: {type(error).__name__}: {error}")
    clean = write_summary(args, samples, reasons, out, status)
    sys.exit(0 if clean else 1)


main()
