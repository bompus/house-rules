---
description: On a machine shared by many sessions, heavy work runs one at a time with capped CPU and memory.
after: Coordination and isolation
---
## Shared machine load

Several sessions share this machine. Before a heavy test run or build, check
the load and other sessions' running jobs, and run one heavy step at a time.
Limit workers and compiler jobs to half the CPUs (at least one) and use
`nice -n 10` where available. Ask before heavy work when the user is working
interactively on the same machine.

Run anything that can exceed about 1 GiB of memory (indexers, toolchain or
bundler builds, full-corpus probes) under a memory cap, for example
`systemd-run --user --scope -p MemoryMax=6G -- <command>` on systemd hosts.
Check free memory first and wait when it is low. With no measured peak, lower
parallelism and drop debug info before raising the cap. A capped job that exits
137 (killed) without an error of its own may have hit its cap; confirm in the
system log (on systemd, `journalctl --user | grep oom-kill`) before retrying
with more memory.
