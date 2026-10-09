"""Finite Linux CPU attribution; does not acquire admission, stop processes or print argv."""
import argparse
import json
import os
from pathlib import Path
import resource
import time
from datetime import datetime, timezone


def read_process(stat):
    end = stat.rfind(")")
    fields = stat[end + 2:].split()
    return {"name": stat[stat.find("(") + 1:end], "parentPid": int(fields[1]),
            "cpuTicks": int(fields[11]) + int(fields[12]),
            "reapedChildCpuTicks": int(fields[13]) + int(fields[14]), "birthTicks": fields[19],
            "rssPages": int(fields[21])}


def snapshot(proc=Path("/proc")):
    processes = {}
    missing = 0
    started = time.monotonic()
    for path in proc.iterdir():
        if not path.name.isdigit():
            continue
        try:
            processes[int(path.name)] = read_process((path / "stat").read_text(encoding="utf-8", errors="replace"))
        except (OSError, ValueError, IndexError):
            missing += 1
    cpu_lines = [line.split() for line in (proc / "stat").read_text().splitlines() if line.startswith("cpu")]
    ticks = list(map(int, cpu_lines[0][1:9]))
    per_cpu = {line[0][3:]: list(map(int, line[1:9])) for line in cpu_lines[1:]}
    peak = int(next(line for line in (proc / "self/status").read_text().splitlines()
                    if line.startswith("VmHWM:")).split()[1]) * 1024
    usage = resource.getrusage(resource.RUSAGE_SELF)
    return {"monotonic": time.monotonic(), "utc": datetime.now(timezone.utc).isoformat(),
            # Busy excludes idle, iowait and steal: steal is time the hypervisor ran
            # something else, not work by any guest thread.
            "hostBusyTicks": sum(ticks) - ticks[3] - ticks[4] - ticks[7],
            "cpuBusyTicks": {cpu: sum(t) - t[3] - t[4] - t[7] for cpu, t in per_cpu.items()},
            "processes": processes,
            "missingProcesses": missing, "scanSeconds": time.monotonic() - started,
            "observerCpuSeconds": usage.ru_utime + usage.ru_stime,
            "observerPeakRssBytes": peak}


def cpu_busy_cores(before, after, scale):
    # A CPU brought online or offline between snapshots has no interval value;
    # report it as None so a gate cannot read it as idle.
    return {cpu: (after[cpu] - before[cpu]) / scale if cpu in before and cpu in after else None
            for cpu in sorted(before.keys() | after.keys(), key=int)}


def compare(before, after, hz):
    seconds = after["monotonic"] - before["monotonic"]
    rows = []
    prior = before["processes"]
    current = after["processes"]
    matched = set()
    for pid, process in current.items():
        old = prior.get(pid)
        if old is None or old["birthTicks"] != process["birthTicks"]:
            continue
        matched.add(pid)
        cpu = process["cpuTicks"] - old["cpuTicks"]
        # When the parent reaps children, their total CPU is added to its
        # cutime/cstime. The delta attributes that CPU to the parent; it can
        # include CPU the children used before the interval started.
        reaped = process.get("reapedChildCpuTicks", 0) - old.get("reapedChildCpuTicks", 0)
        if cpu > 0 or reaped > 0:
            rows.append({"pid": pid, **process, "busyCores": cpu / hz / seconds,
                         "reapedChildCores": reaped / hz / seconds})
    return {"startUtc": before["utc"], "endUtc": after["utc"], "seconds": seconds,
            "hostBusyCores": (after["hostBusyTicks"] - before["hostBusyTicks"]) / hz / seconds,
            "cpuBusyCores": cpu_busy_cores(before.get("cpuBusyTicks", {}), after.get("cpuBusyTicks", {}),
                                           hz * seconds),
            "unmatchedBefore": len(prior) - len(matched),
            "unmatchedAfter": len(current) - len(matched),
            "processCpu": sorted(rows, key=lambda row: -row["busyCores"])}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seconds", type=int, default=20)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if not 1 <= args.seconds <= 300:
        parser.error("seconds must be between 1 and 300")
    hz = os.sysconf("SC_CLK_TCK")
    samples = [snapshot()]
    for _ in range(args.seconds):
        time.sleep(1)
        samples.append(snapshot())
    intervals = [compare(a, b, hz) for a, b in zip(samples, samples[1:])]
    result = {"version": 2, "observerPid": os.getpid(), "clockTicksPerSecond": hz,
              "bootId": Path("/proc/sys/kernel/random/boot_id").read_text().strip(),
              "samples": samples, "intervals": intervals,
              "limits": "Snapshots miss processes that start and exit between samples. reapedChildCores attributes children's CPU to the parent in the interval it reaps them, including CPU they used before the interval. Busy CPU excludes idle, iowait and steal. CPU attribution does not prove interference or grant admission. Observer overhead is included; no negligible-impact claim."}
    args.output.write_text(json.dumps(result, indent=2))
    print(json.dumps({"output": str(args.output), "intervals": len(intervals),
                      "peakHostBusyCores": max(row["hostBusyCores"] for row in intervals),
                      "observerPeakRssBytes": samples[-1]["observerPeakRssBytes"]}))


if __name__ == "__main__":
    main()
