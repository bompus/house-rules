---
description: Only benchmarks and other performance measurements wait for a quiet host. Other work runs whatever the load; while an isolated measurement runs, competing work follows its isolation rules. Very large jobs still run under a memory cap.
after: Coordination and isolation
reference: ../references/shared-machine-load.md
core: true
---

## Shared machine load

Work that is not a benchmark, timing run or other performance measurement is
never delayed, serialized or refused because the host is busy, and needs no lock
or admission check. Several heavy jobs may run at the same time. Checking and
reporting load or running jobs stays allowed; what you see informs the report and
never holds the work back. A limit the user states for a run still applies.

Cap
parallel workers and compiler jobs at max(1, floor(CPUs / 2)); count CPUs with
`nproc --all` (macOS: `sysctl -n hw.logicalcpu`; Windows: `NUMBER_OF_PROCESSORS`).

A benchmark, timing run or other performance measurement keeps every rule of
`hr-benchmarking`.

While a measurement that needs
the machine to itself is running, work that would compete with it follows that
measurement's isolation rules.

Memory limits stay in force whatever the load, as protection against a crash.
Work risks exhausting memory when its expected or last measured peak leaves
little headroom in the memory available to it, or when its peak is unknown and
its input is large. Constrain such work using the host's supported controls; on
Linux with systemd, `systemd-run --user --scope -p MemoryMax=<size> -- <cmd>`, sized
from the job's measured peak plus about 20%, but never above the memory available to
it less what the rest of the host needs, counting every job running at the same time (their
caps together stay within it); when that leaves less than the peak, shrink the job instead (where systemd reports it, the scope's journal line `Consumed …`
includes the peak memory). Check that the heavy processes run inside the capped scope:
work done by a daemon, such as a container build, needs the daemon's own limits.

For the worker-count detail, the shared memory budget across agents and retrying a capped job, read
[the shared-load procedure](../references/shared-machine-load.md).
