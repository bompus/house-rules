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
`nproc --all` (macOS: `sysctl -n hw.logicalcpu`; Windows: `NUMBER_OF_PROCESSORS`),
and, where `nproc` exists, never above it with `OMP_NUM_THREADS` unset (it honors a CPU
affinity mask).

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
from the job's measured peak plus about 20%, but never above the memory available to
it less what the rest of the host needs, counting every job running at the same time (their
caps together stay within it); when that leaves less than the peak, shrink the job instead (where systemd reports it, the scope's journal line `Consumed …`
includes the peak memory). Check that the heavy processes run inside the capped scope:
work done by a daemon, such as a container build, needs the daemon's own limits.

Per-job caps cannot stop jobs that start at the same moment from each sizing against the
same free memory. Where several agents share one host, use one shared budget that is an
ancestor of every job (on Linux, one cgroup that all of them are placed under, created at
system level when the agents run as different users).

Check that the
capped cgroup is an ancestor of each job's scope; a check made after the job has finished
is too late to protect the host.

With no measured peak, lower parallelism and drop debug info before
raising the cap. A capped job that exits 137 or 143 without its own error was likely
killed for memory: check the system journal for an OOM kill before retrying.
Retry with a larger budget only when host evidence shows memory pressure caused
the failure; without that evidence, find the cause before raising the budget.

For the cgroup quota note, starting a job inside the shared budget and the worker-count hint, read
[the shared-load procedure](../references/shared-machine-load.md).
