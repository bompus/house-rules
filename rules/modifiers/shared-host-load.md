---
description: Only benchmarks and other performance measurements wait for a quiet host. Other work runs whatever the load; while an isolated measurement runs, competing work follows its isolation rules. Very large jobs still run under a memory cap.
after: Coordination and isolation
---

## Shared machine load

Work that is not a benchmark, timing run or other performance measurement is
never delayed, serialized or refused because the host is busy, and needs no lock
or admission check. Several heavy jobs may run at the same time. Checking and
reporting load or running jobs stays allowed; what you see informs the report and
never holds the work back. A limit the user states for a run still applies. Cap
parallel workers and compiler jobs at max(1, floor(CPUs / 2)); count CPUs with
`nproc --all`, which ignores a cgroup CPU quota, because counters that follow a quota
differ on fractions (a 1.5 CPU quota reads 1 in Node and Bun, 2 in uutils `nproc` and
16 in GNU `nproc`).

A benchmark, timing run or other performance measurement keeps every rule of
`hr-benchmarking`. That includes keeping other work from competing with the run
and rejecting a run that competing load disturbs. It also includes any lock or
admission step the host defines for measurements. While a measurement that needs
the machine to itself is running, work that would compete with it follows that
measurement's isolation rules. The wait comes from the measurement, not from the
load.

Memory limits stay in force whatever the load, as protection against a crash.
Work risks exhausting memory when its expected or last measured peak leaves
little headroom in the memory available to it, or when its peak is unknown and
its input is large. Constrain such work using the host's supported controls; on
Linux with systemd, `systemd-run --user --scope -p MemoryMax=<size> -- <cmd>`, sized
from the job's measured peak plus about 20% (the scope's journal line reports
`Consumed …`). With no measured peak, lower parallelism and drop debug info before
raising the cap. A capped job that exits 137 or 143 without its own error was likely
killed for memory: check the system journal for an OOM kill before retrying.
Retry with a larger budget only when host evidence shows memory pressure caused
the failure; without that evidence, find the cause before raising the budget.
