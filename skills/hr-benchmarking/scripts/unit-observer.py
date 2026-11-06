#!/usr/bin/env python3
"""Continuous observer for one measured unit on a native Linux host.

Run it beside a unit (a timed run, a phase) that executes inside one cgroup. It samples once a
second until SIGTERM or SIGINT, takes one last sample at that moment, then writes one JSON summary
to --output (and every sample to `<output>.samples.jsonl`) and exits 0 when the unit may count, 1
when it may not. It writes `<output>.ready` after its first sample; start the unit after that. A
first sample that already fails writes no `.ready`: the observer exits 1 with the reasons in the
summary.

Limits are these defaults; a protocol that declares others applies its own, through --max-gap-s,
--min-avail-gib, --mem-psi-ms, --io-psi-ms and --max-competing-cores. Host scope: available memory
at least 8 GiB in every sample (unrounded); memory full PSI at most 10 ms and I/O full PSI at most
100 ms per observation interval (each measured interval is scaled to one second by the time
between the reads of that total, and none counts as shorter than half a second); coverage with no
gap over 2.5 s (monotonic clock) and no sample whose reads took longer than that, and at least two
samples; PSI must be readable. Competing CPU:
the mean over the whole run of host busy cores minus the workload cgroup's own CPU (usage_usec,
descendants included) is at most 4; with --host-only there is no workload to subtract, so the
unit's own CPU counts. Workload scope (the cgroup given with --workload-cgroup, or `auto` for the
observer's parent's cgroup): the same pressure limits on its own pressure files; in every sample
no growth of memory.swap.current or memory.zswap.current over the first sample, no change of
zswpin, zswpout or zswpwb and no change of memory.events high, max, oom or oom_kill from the first
sample, the same directory (device and inode), readable required counters, the same set of
optional counters (zswap) as in the first sample, and a memory.current or io.stat that stays
readable once it has been. A CPU or PSI counter that goes backward is a failure.

Host-wide swap-out and zswap activity (pswpout, zswpout, zswpwb) is recorded for every interval
and rejects the unit only with --storage-phase, the phases the rules name; a storage phase also
requires pswpout (and a zswap counter the first sample had) in every sample.

Observer cost is recorded (CPU, resident peak, output bytes) and checked against budgets
(--max-observer-cores, default 0.05, over the collection interval from the first to the last
sample; --max-observer-rss-mib, default 128); a protocol declares its
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
# PSI limits are for one nominal observation interval of NOMINAL_INTERVAL_S seconds. Each measured
# interval's stall is scaled to it by the interval's length, and an interval counts as at least
# MIN_PSI_INTERVAL_S, so a stop right after a sample cannot turn a millisecond of stall into a
# rejection.
NOMINAL_INTERVAL_S = 1.0
MIN_PSI_INTERVAL_S = 0.5
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
    if path.strip("/") == "":
        raise OSError(
            "the observer's parent is in the root cgroup, so `auto` would watch the whole host; "
            "pass the workload cgroup's path"
        )
    for root in ("/sys/fs/cgroup", "/sys/fs/cgroup/unified"):
        if os.path.exists(f"{root}/cgroup.controllers"):
            return root + path
    raise OSError("no unified cgroup v2 mount found")


def optional_int(path):
    try:
        return int(read(path)[0])
    except (OSError, ValueError, IndexError):
        return None


def io_bytes(path):
    """Read and written bytes summed over the cgroup's devices; None without io.stat."""
    try:
        total = {"rbytes": 0, "wbytes": 0}
        for line in read(path):
            for field in line.split()[1:]:
                key, _, value = field.partition("=")
                if key in total:
                    total[key] += int(value)
        return total
    except (OSError, ValueError):
        return None


def workload_sample(path):
    """The workload cgroup's counters, or None when a required one is unreadable."""
    try:
        st = os.stat(path)
        mem_psi = psi_full(f"{path}/memory.pressure")
        mem_psi_t = time.monotonic()  # when each total was read, for scaling its delta
        io_psi = psi_full(f"{path}/io.pressure")
        io_psi_t = time.monotonic()
        events = {k: v for k, v in keyed(f"{path}/memory.events").items() if k in EVENTS}
        if set(events) != set(EVENTS):
            return None
        stat = keyed(f"{path}/memory.stat")
        zswap = None
        if os.path.exists(f"{path}/memory.zswap.current"):
            zswap = int(read(f"{path}/memory.zswap.current")[0])
        return {
            "memory_current": optional_int(f"{path}/memory.current"),
            "io_bytes": io_bytes(f"{path}/io.stat"),
            "id": [st.st_dev, st.st_ino],
            "cpu_usec": keyed(f"{path}/cpu.stat")["usage_usec"],
            "events": events,
            "stat": {k: stat[k] for k in WORKLOAD_STAT if k in stat},
            "swap": int(read(f"{path}/memory.swap.current")[0]),
            "zswap": zswap,
            "mem_psi": mem_psi,
            "io_psi": io_psi,
            "mem_psi_t": mem_psi_t,
            "io_psi_t": io_psi_t,
        }
    except (OSError, KeyError, ValueError, IndexError):
        return None


def take(cg):
    sample = {
        "t": time.monotonic(),
        "wall": time.time(),
        "cpu": sum(os.times()[:2]),
        "busy_ticks": host_busy_ticks(),
        "mem_psi": psi_full(f"{PROC}/pressure/memory"),
    }
    sample["mem_psi_t"] = time.monotonic()  # when each total was read, for scaling its delta
    sample["io_psi"] = psi_full(f"{PROC}/pressure/io")
    sample["io_psi_t"] = time.monotonic()
    sample["avail_gib"] = avail_gib()
    sample["vm"] = vmstat()
    sample["workload"] = workload_sample(cg) if cg else None
    sample["t_end"] = time.monotonic()  # a read that blocks past the limit is not a clean sample
    return sample


def first_sample_reasons(sample, cg):
    """Reasons the first sample already fails, so a unit is not started that cannot count."""
    reasons = []
    if sample["mem_psi"] is None or sample["io_psi"] is None:
        reasons.append("host pressure unreadable")
    if sample["avail_gib"] < MIN_AVAIL_GIB:
        reasons.append(f"available memory below {MIN_AVAIL_GIB:g} GiB")
    if cg:
        workload = sample["workload"]
        if workload is None:
            reasons.append("workload cgroup counters unreadable or the directory went missing")
        elif workload["mem_psi"] is None or workload["io_psi"] is None:
            reasons.append("workload pressure unreadable")
    return reasons


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
        reasons.append(f"sampling interval not positive or gap above {MAX_GAP_S:g} s")
        return reasons, out
    if max(s["t_end"] - s["t"] for s in samples) > MAX_GAP_S:
        reasons.append(f"a sample's reads took longer than {MAX_GAP_S:g} s")
        return reasons, out
    busy = [s["busy_ticks"] for s in samples]
    if any(b < a for a, b in zip(busy, busy[1:], strict=False)):
        reasons.append("host CPU counter went backward")
    host_cores = (busy[-1] - busy[0]) / hz / total
    out["host_busy_cores_mean"] = round(host_cores, 2)
    min_avail = min(s["avail_gib"] for s in samples)
    out["avail_gib_min"] = round(min_avail, 3)
    if min_avail < MIN_AVAIL_GIB:
        reasons.append(f"available memory below {MIN_AVAIL_GIB:g} GiB")
    reasons += pressure_reasons(
        [(s["mem_psi"], s["mem_psi_t"], s["io_psi"], s["io_psi_t"]) for s in samples],
        out,
        "host",
        "host",
    )
    swaps = [{k: b["vm"][k] - a["vm"][k] for k in a["vm"] if k in b["vm"]} for a, b in steps]
    out["host_swap_deltas_by_interval"] = swaps
    if args.storage_phase and any(v for d in swaps for v in d.values()):
        reasons.append("host swap-out or zswap activity in a storage phase")
    # pswpout is required; a zswap counter is required once the first sample has it.
    needed = {"pswpout", *samples[0]["vm"]}
    if args.storage_phase and any(k not in x["vm"] for x in samples for k in needed):
        reasons.append("host swap counter unreadable in a storage phase")
    workload = [s["workload"] for s in samples]
    w_cores = 0.0
    if cg:
        if any(w is None for w in workload):
            reasons.append("workload cgroup counters unreadable or the directory went missing")
        else:
            w_reasons, w_cores = workload_reasons(workload, total, out)
            reasons += w_reasons
    competing = host_cores - w_cores
    out["competing_cpu_cores_mean"] = round(competing, 2)
    if competing > MAX_COMPETING_CORES:
        reasons.append(f"competing CPU above {MAX_COMPETING_CORES:g} cores")
    return reasons, out


def pressure_reasons(rows, out, label, key):
    """Memory and I/O full PSI over each observation interval; both must be readable.

    Each row is (memory total, time it was read, I/O total, time it was read). A delta is scaled by
    the time between its own two reads, and reads further apart than MAX_GAP_S leave pressure
    unobserved, which rejects.
    """
    if any(r[0] is None or r[2] is None for r in rows):
        return [f"{label} pressure unreadable"]
    pairs = list(zip(rows, rows[1:], strict=False))
    mem = [b[0] - a[0] for a, b in pairs]
    io = [b[2] - a[2] for a, b in pairs]
    if min(mem + io) < 0:
        return [f"{label} pressure counter went backward"]
    mem_gaps = [b[1] - a[1] for a, b in pairs]
    io_gaps = [b[3] - a[3] for a, b in pairs]
    if max(mem_gaps + io_gaps) > MAX_GAP_S:
        return [f"{label} pressure reads more than {MAX_GAP_S:g} s apart"]
    mem = [
        d * NOMINAL_INTERVAL_S / max(g, MIN_PSI_INTERVAL_S)
        for d, g in zip(mem, mem_gaps, strict=True)
    ]
    io = [
        d * NOMINAL_INTERVAL_S / max(g, MIN_PSI_INTERVAL_S)
        for d, g in zip(io, io_gaps, strict=True)
    ]
    out[f"{key}_mem_full_psi_ms_max"] = round(max(mem) / 1000, 2)
    out[f"{key}_io_full_psi_ms_max"] = round(max(io) / 1000, 2)
    if max(mem) > MEM_PSI_MS * 1000 or max(io) > IO_PSI_MS * 1000:
        return [f"{label} pressure above the limit in an interval"]
    return []


def lost(values):
    """True when a value that was readable is later not; one never readable is just unknown."""
    seen = False
    for value in values:
        if value is not None:
            seen = True
        elif seen:
            return True
    return False


def workload_reasons(w, total, out):
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
    currents = [x["memory_current"] for x in w]
    if lost(currents):
        reasons.append("workload memory.current became unreadable")
    out["workload_memory_current_peak_bytes"] = max(currents) if None not in currents else "unknown"
    ios = [x["io_bytes"] for x in w]
    if lost(ios):
        reasons.append("workload io.stat became unreadable")
    io_first, io_last = first["io_bytes"], w[-1]["io_bytes"]
    out["workload_io_bytes_delta"] = (
        {k: io_last[k] - io_first[k] for k in io_first} if io_first and io_last else "unknown"
    )
    reasons += pressure_reasons(
        [(x["mem_psi"], x["mem_psi_t"], x["io_psi"], x["io_psi_t"]) for x in w],
        out,
        "workload",
        "workload",
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
        # The budget is the CPU spent between the first and last sample, over that interval.
        # Start-up CPU comes before the first sample and output CPU after the last; the lifetime
        # figure is reported beside it.
        cpu_s = sum(os.times()[:2])
        interval_cpu_s = samples[-1]["cpu"] - samples[0]["cpu"]
        span = max(samples[-1]["t"] - samples[0]["t"], 1e-9)
        cores, rss_mib = interval_cpu_s / span, self_status("VmHWM") / 1024
        summary.update(
            observer_cpu_s=round(cpu_s, 2),
            observer_cpu_interval_s=round(interval_cpu_s, 3),
            observer_cpu_cores_mean=round(cores, 3),
            observer_rss_peak_mib=round(rss_mib, 1),
            samples_bytes=os.path.getsize(args.output + ".samples.jsonl"),
        )
        # The budgets compare the figures before they are rounded for the summary.
        if cores > args.max_observer_cores:
            reasons.append(
                f"observer CPU over budget: {cores:.4f} > {args.max_observer_cores:g} cores"
            )
        if rss_mib > args.max_observer_rss_mib:
            reasons.append(
                "observer resident memory over budget: "
                f"{rss_mib:.2f} > {args.max_observer_rss_mib:g} MiB"
            )
    summary["reasons"] = reasons
    summary["clean"] = not reasons
    with open(args.output, "w") as f:
        f.write(json.dumps(summary) + "\n")
    return summary["clean"]


def positive(text):
    """An argparse type for an admission limit: a finite number above zero."""
    try:
        value = float(text)
    except ValueError:
        value = float("nan")
    if not value > 0 or value == float("inf"):
        raise argparse.ArgumentTypeError(f"must be a positive number, got {text!r}")
    return value


def main():
    global PROC, MAX_GAP_S, MAX_COMPETING_CORES, MIN_AVAIL_GIB, MEM_PSI_MS, IO_PSI_MS
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--output", default=os.environ.get("OBSERVER_OUT"))
    ap.add_argument("--workload-cgroup", default=os.environ.get("WORKLOAD_CGROUP"))
    ap.add_argument("--host-only", action="store_true")
    ap.add_argument("--storage-phase", action="store_true")
    ap.add_argument("--max-gap-s", type=positive, default=MAX_GAP_S)
    ap.add_argument("--min-avail-gib", type=positive, default=MIN_AVAIL_GIB)
    ap.add_argument("--mem-psi-ms", type=positive, default=MEM_PSI_MS)
    ap.add_argument("--io-psi-ms", type=positive, default=IO_PSI_MS)
    ap.add_argument("--max-competing-cores", type=positive, default=MAX_COMPETING_CORES)
    ap.add_argument("--max-observer-cores", type=float, default=0.05)
    ap.add_argument("--max-observer-rss-mib", type=float, default=128)
    ap.add_argument("--proc-root", default="/proc", help="for tests: where /proc/stat etc. live")
    args = ap.parse_args()
    if not args.output:
        ap.error("--output or OBSERVER_OUT is required")
    PROC = args.proc_root
    MAX_GAP_S, MIN_AVAIL_GIB = args.max_gap_s, args.min_avail_gib
    MEM_PSI_MS, IO_PSI_MS = args.mem_psi_ms, args.io_psi_ms
    MAX_COMPETING_CORES = args.max_competing_cores
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
                parent = os.getppid()
                if parent == 1:
                    raise OSError(
                        "`auto` needs a parent inside the workload cgroup, but the parent is pid 1 "
                        "(a double fork or a service started outside the unit); pass the path"
                    )
                cg = own_cgroup(parent)
            if not cg or not os.path.isdir(cg):
                raise OSError(f"the workload cgroup is not a directory: {cg!r}")
            out.update(scope="workload-cgroup", workload_cgroup=cg)
        elif not args.host_only:
            reasons.append("no workload cgroup given")
        samples.append(take(cg))
        doomed = first_sample_reasons(samples[0], cg)
        if doomed:
            # No .ready: the driver must not start a unit this run cannot count.
            reasons += doomed
        else:
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


if __name__ == "__main__":
    main()
