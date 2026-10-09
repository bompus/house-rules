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
            "cpuTicks": int(fields[11]) + int(fields[12]), "birthTicks": fields[19],
            "rssPages": int(fields[21])}


def snapshot(proc=Path("/proc")):
    processes = {}
    missing = 0
    started = time.monotonic()
    for path in proc.iterdir():
        if not path.name.isdigit():
            continue
        try:
            processes[int(path.name)] = read_process((path / "stat").read_text())
        except (OSError, ValueError, IndexError):
            missing += 1
    ticks = list(map(int, (proc / "stat").read_text().splitlines()[0].split()[1:9]))
    peak = int(next(line for line in (proc / "self/status").read_text().splitlines()
                    if line.startswith("VmHWM:")).split()[1]) * 1024
    usage = resource.getrusage(resource.RUSAGE_SELF)
    return {"monotonic": time.monotonic(), "utc": datetime.now(timezone.utc).isoformat(),
            "hostBusyTicks": sum(ticks) - ticks[3] - ticks[4], "processes": processes,
            "missingProcesses": missing, "scanSeconds": time.monotonic() - started,
            "observerCpuSeconds": usage.ru_utime + usage.ru_stime,
            "observerPeakRssBytes": peak}


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
        if cpu > 0:
            rows.append({"pid": pid, **process, "busyCores": cpu / hz / seconds})
    return {"startUtc": before["utc"], "endUtc": after["utc"], "seconds": seconds,
            "hostBusyCores": (after["hostBusyTicks"] - before["hostBusyTicks"]) / hz / seconds,
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
    result = {"version": 1, "observerPid": os.getpid(), "clockTicksPerSecond": hz,
              "bootId": Path("/proc/sys/kernel/random/boot_id").read_text().strip(),
              "samples": samples, "intervals": intervals,
              "limits": "Snapshots miss processes that start and exit between samples. CPU attribution does not prove interference or grant admission. Observer overhead is included; no negligible-impact claim."}
    args.output.write_text(json.dumps(result, indent=2))
    print(json.dumps({"output": str(args.output), "intervals": len(intervals),
                      "peakHostBusyCores": max(row["hostBusyCores"] for row in intervals),
                      "observerPeakRssBytes": samples[-1]["observerPeakRssBytes"]}))


if __name__ == "__main__":
    main()
