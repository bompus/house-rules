#!/usr/bin/env python3
"""
Continuous observer for one measured unit on a native Linux host.

Run it beside a unit (a timed run, a phase) that executes inside one cgroup. It samples once a
second until SIGTERM or SIGINT, then writes one JSON summary to --output and exits 0 when the unit
may count, 1 when it may not. It writes `<output>.ready` after its first sample; start the unit
after that.

Limits are the ones in the host benchmarking rules. Host scope: available memory at least 8 GiB in
every sample (unrounded); memory full PSI at most 10 ms and I/O full PSI at most 100 ms per
second; no swap-out, zswap-out or zswap writeback. Competing CPU: the mean over the whole run of
host busy cores minus the workload cgroup's own CPU is at most 4. Workload scope (the cgroup given
with --workload-cgroup, or `auto` for the observer's parent's cgroup): the same PSI limits on its
own pressure files; no growth of memory.swap.current or memory.zswap.current; no change in its
zswpin, zswpout or zswpwb; no increment of memory.events high, max, oom or oom_kill; the same
directory (device and inode) and readable counters in every sample. Coverage: no gap over 2.5 s
between samples, timed with the monotonic clock, and at least two samples. Without PSI the
pressure limits cannot be read and the unit is not clean. A zswap counter the kernel does not
provide is recorded as absent.

Without a workload cgroup the unit is not clean unless --host-only is given, which records
"scope": "host-only" and checks the host limits (competing CPU then includes the unit's own).

The summary also records the observer's process identity (pid and start ticks), its own CPU time,
the sample count, the first and last wall-clock times, and the largest gap. The observer changes
nothing.
"""

import argparse
import json
import os
import signal
import sys
import time

SWAPS = ("pswpout", "zswpout", "zswpwb")
WORKLOAD_STAT = ("zswpin", "zswpout", "zswpwb")
EVENTS = ("high", "max", "oom", "oom_kill")
MAX_GAP_S = 2.5
MAX_FOREIGN_CORES = 4
MIN_AVAIL_GIB = 8
MEM_PSI_MS = 10
IO_PSI_MS = 100
stop = False


def on_signal(_signum, _frame):
    global stop
    stop = True


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


def host_cpu():
    v = [int(x) for x in read("/proc/stat")[0].split()[1:9]]
    return sum(v) - v[3] - v[4]


def psi_full(path):
    try:
        for line in read(path):
            if line.startswith("full"):
                return int(line.split("total=")[1])
    except FileNotFoundError:
        return None


def avail_gib():
    for line in read("/proc/meminfo"):
        if line.startswith("MemAvailable"):
            return int(line.split()[1]) / 1048576


def vmstat():
    return {k: v for k, v in keyed("/proc/vmstat").items() if k in SWAPS}


def start_ticks(pid="self"):
    return read(f"/proc/{pid}/stat")[0].rsplit(")", 1)[1].split()[19]


def own_cgroup(pid):
    for line in read(f"/proc/{pid}/cgroup"):
        if line.startswith("0::"):
            return "/sys/fs/cgroup" + line[3:]
    raise SystemExit("no cgroup v2 path for the observer's parent")


def workload_sample(path):
    """The workload cgroup's counters, or None when any required one is unreadable."""
    try:
        st = os.stat(path)
        s = {"id": (st.st_dev, st.st_ino), "cpu_usec": keyed(f"{path}/cpu.stat")["usage_usec"]}
        s["events"] = {k: v for k, v in keyed(f"{path}/memory.events").items() if k in EVENTS}
        stat = keyed(f"{path}/memory.stat")
        s["stat"] = {k: stat[k] for k in WORKLOAD_STAT if k in stat}
        for name in ("memory.swap.current", "memory.zswap.current"):
            try:
                s[name] = int(read(f"{path}/{name}")[0])
            except FileNotFoundError:
                s[name] = None
        s["mem_psi"] = psi_full(f"{path}/memory.pressure")
        s["io_psi"] = psi_full(f"{path}/io.pressure")
        return s
    except (OSError, KeyError, ValueError, IndexError):
        return None


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument(
        "--output",
        default=os.environ.get("OBSERVER_OUT"),
        required=not os.environ.get("OBSERVER_OUT"),
    )
    ap.add_argument("--workload-cgroup", default=os.environ.get("WORKLOAD_CGROUP"))
    ap.add_argument("--host-only", action="store_true")
    args = ap.parse_args()
    signal.signal(signal.SIGTERM, on_signal)
    signal.signal(signal.SIGINT, on_signal)
    hz = float(os.sysconf("SC_CLK_TCK"))
    cg = None
    if args.workload_cgroup:
        cg = (
            own_cgroup(os.getppid())
            if args.workload_cgroup == "auto"
            else args.workload_cgroup.rstrip("/")
        )
    have_psi = psi_full("/proc/pressure/memory") is not None
    v0 = vmstat()
    wall_first = time.time()
    first = workload_sample(cg) if cg else None
    # each sample: (monotonic, host busy ticks, host memory PSI, host I/O PSI, avail GiB, workload)
    samples = []

    def take():
        samples.append(
            (
                time.monotonic(),
                host_cpu(),
                psi_full("/proc/pressure/memory"),
                psi_full("/proc/pressure/io"),
                avail_gib(),
                workload_sample(cg) if cg else None,
            )
        )

    take()
    open(args.output + ".ready", "w").close()
    while not stop:
        time.sleep(1)
        take()
    wall_last = time.time()
    delta = {k: vmstat()[k] - v for k, v in v0.items()}
    reasons = []
    out = {
        "observer": "ok",
        "pid": os.getpid(),
        "start_ticks": start_ticks(),
        "scope": "workload-cgroup" if cg else "host-only",
        "workload_cgroup": cg,
        "samples": len(samples),
        "psi": "available" if have_psi else "unavailable",
        "host_deltas": delta,
        "first_sample": wall_first,
        "last_sample": wall_last,
    }
    if cg is None and not args.host_only:
        reasons.append("no workload cgroup given")
    if cg and first is None:
        reasons.append("workload cgroup counters unreadable at the start")
    steps = list(zip(samples, samples[1:], strict=False))
    if not steps:
        reasons.append("fewer than two samples")
    else:
        gaps = [b[0] - a[0] for a, b in steps]
        total = samples[-1][0] - samples[0][0]
        host_cores = (samples[-1][1] - samples[0][1]) / hz / total
        min_avail = min(s[4] for s in samples)
        out.update(
            window_s=round(total, 1),
            max_gap_s=round(max(gaps), 2),
            host_busy_cores_mean=round(host_cores, 2),
            avail_gib_min=round(min_avail, 3),
            observer_cpu_s=round(sum(os.times()[:2]), 2),
        )
        if min(gaps) <= 0 or max(gaps) > MAX_GAP_S:
            reasons.append("sampling interval not positive or gap above 2.5 s")
        if have_psi:
            mem = [(b[2] - a[2]) / 1000 / (b[0] - a[0]) for a, b in steps]
            io = [(b[3] - a[3]) / 1000 / (b[0] - a[0]) for a, b in steps]
            out.update(
                host_mem_full_psi_ms_max=round(max(mem), 2),
                host_io_full_psi_ms_max=round(max(io), 2),
            )
            if max(mem) > MEM_PSI_MS or max(io) > IO_PSI_MS:
                reasons.append("host pressure above the limit in a second")
        else:
            reasons.append("PSI unavailable: pressure cannot be read")
        if min_avail < MIN_AVAIL_GIB:
            reasons.append("available memory below 8 GiB")
        if any(delta.values()):
            reasons.append("host swap-out or zswap activity")
        workload = [s[5] for s in samples]
        if cg and all(w is not None for w in workload):
            w_cores = (workload[-1]["cpu_usec"] - workload[0]["cpu_usec"]) / 1e6 / total
            out.update(
                workload_cpu_cores_mean=round(w_cores, 2),
                competing_cpu_cores_mean=round(host_cores - w_cores, 2),
            )
            if host_cores - w_cores > MAX_FOREIGN_CORES:
                reasons.append("competing CPU above 4 cores")
            if any(w["id"] != workload[0]["id"] for w in workload):
                reasons.append("workload cgroup replaced")
            for name in ("memory.swap.current", "memory.zswap.current"):
                vals = [w[name] for w in workload]
                if None not in vals and max(vals) > vals[0]:
                    reasons.append(f"{name} grew")
            if any(
                workload[-1]["stat"].get(k, 0) != workload[0]["stat"].get(k, 0)
                for k in WORKLOAD_STAT
            ):
                reasons.append("workload zswpin, zswpout or zswpwb changed")
            if any(
                workload[-1]["events"].get(k, 0) != workload[0]["events"].get(k, 0) for k in EVENTS
            ):
                reasons.append("workload memory.events high, max, oom or oom_kill incremented")
            if all(w["mem_psi"] is not None for w in workload):
                wm = [(b[5]["mem_psi"] - a[5]["mem_psi"]) / 1000 / (b[0] - a[0]) for a, b in steps]
                wi = [(b[5]["io_psi"] - a[5]["io_psi"]) / 1000 / (b[0] - a[0]) for a, b in steps]
                out.update(
                    workload_mem_full_psi_ms_max=round(max(wm), 2),
                    workload_io_full_psi_ms_max=round(max(wi), 2),
                )
                if max(wm) > MEM_PSI_MS or max(wi) > IO_PSI_MS:
                    reasons.append("workload pressure above the limit in a second")
            else:
                reasons.append("workload pressure files unreadable")
        elif cg:
            reasons.append(
                "workload cgroup counters unreadable or the directory went missing during the run"
            )
    out["reasons"] = reasons
    out["clean"] = not reasons
    with open(args.output, "w") as f:
        f.write(json.dumps(out) + "\n")
    sys.exit(0 if not reasons else 1)


main()
