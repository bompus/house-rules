---
description: Run one heavy job at a time with capped CPU and memory; other sessions may continue light work within its resource limits.
after: Coordination and isolation
---
## Shared machine load

Several sessions share this machine. Before a heavy test run or build, check
the load and other sessions' running jobs, and run one heavy step at a time.
Limit workers and compiler jobs to half the CPUs (at least one) and use
`nice -n 10` where available. Ask before heavy work when the user is working
interactively on the same machine.

Reserve a shared slot only for heavy local phases or a deliberately isolated
local performance measurement. Remote model inference, light CLI/API work and
remote waits need no exclusive slot. A memory cap, an agent/model comparison
or recording elapsed time alone does not make a job heavy. Coordinate heavy
local tool, build and test phases separately. Record the timing regime and
concurrent local work for remote or shared evaluations.

A local phase is heavy when its measured or expected CPU, memory or I/O use
exceeds the host's declared budget for concurrent light work. When the budget
or expected use is unknown, coordinate the local phase before launching it.

Other sessions may continue light work within the job's resource limits:
remote requests, targeted reads and edits in independent checkouts. Pause
competing CPU, memory or I/O jobs, not whole sessions. Include hooks and child
processes when assessing load. Preserve measured files, runtimes, dependencies
and services. During isolated local performance measurements, the measuring
session only monitors.
Between jobs, release the reservation while waiting on remote work or a review.

Run anything that can exceed about 1 GiB of memory (indexers, toolchain or
bundler builds, full-corpus probes) under a memory cap, for example
`systemd-run --user --scope -p MemoryMax=6G -- <command>` on systemd hosts.
Check free memory first and wait when it is low. With no measured peak, lower
parallelism and drop debug info before raising the cap. A capped job that exits
137 (killed) without an error of its own may have hit its cap; confirm in the
system log (on systemd, `journalctl --user | grep oom-kill`) before retrying
with more memory.
