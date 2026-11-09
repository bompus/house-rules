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
affinity mask). `nproc --all` ignores a
cgroup CPU quota, because counters that follow a quota differ on fractions (on a 16-CPU
host, a 1.5 CPU quota reads 1 in Node and Bun, 2 in uutils `nproc` and 16 in GNU
`nproc`). Use the cap yourself when you set a tool's worker count.

A benchmark, timing run or other performance measurement keeps every rule of
`hr-benchmarking`. That includes keeping other work from competing with the run
and rejecting a run that competing load disturbs. It also includes any lock or
admission step the host defines for measurements. While a measurement that needs
the machine to itself is running, work that would compete with it follows that
measurement's isolation rules. The wait comes from the measurement, not from the
load.

Memory limits stay in force whatever the load, as protection against a crash.
Work risks exhausting memory when its expected or last measured memory leaves
little headroom in the memory available to it, or when its peak is unknown and
its input is large. Constrain such work using the host's supported controls; on
Linux with systemd, `systemd-run --user --scope -p MemoryMax=<size> -- <cmd>`, sized
from the job's measured memory (below) plus about 20%, but never above the memory available to
it less what the rest of the host needs, counting every job running at the same time (their
caps together stay within it); when that leaves less than the job's memory, shrink the job instead.
Check that the heavy processes run inside the capped scope:
work done by a daemon, such as a container build, needs the daemon's own limits.

Measure while the job runs: the scope's `memory.stat` reports current usage by kind, not peaks, and
the scope may be gone when the job ends. The journal line `Consumed …` and `memory.peak` keep only a
total peak, which counts file cache and is not what the job needs. Start from `anon` plus `shmem`
(anonymous and shared or tmpfs memory), check `memory.swap.current` separately, leave room for kernel
memory and the file-backed pages the job keeps using, and do not add counters that overlap (`shmem`
and `file_mapped` are part of `file`).

Clean file cache is normally reclaimed before `MemoryMax` kills anything; what cannot be reclaimed
(tmpfs or other shared memory without swap, pinned or dirty pages) counts against the cap. A soft limit
(`MemoryHigh`) below the cap starts reclaim and throttling earlier; it does not guarantee that the job
is not killed.

Per-job caps cannot stop jobs that start at the same moment from each sizing against the
same free memory. Where several agents share one host, use one shared budget that is an
ancestor of every job (on Linux, one cgroup that all of them are placed under, created at
system level when the agents run as different users). Start each job inside it, so the
ancestor exists before the workload can allocate memory: `--slice=<slice>` added to the
`systemd-run` command above for agents of one user (without it the scope lands outside
the caller's slice), a system-level unit for agents of different users. Check that the
capped cgroup is an ancestor of each job's scope; a check made after the job has finished
is too late to protect the host.

With no measured memory, lower parallelism and drop debug info before
raising the cap. A capped job that exits 137 or 143 without its own error was likely
killed for memory: check the system journal for an OOM kill before retrying.
Retry with a larger budget only when host evidence shows memory pressure caused
the failure; without that evidence, find the cause before raising the budget.
