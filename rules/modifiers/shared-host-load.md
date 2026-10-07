---
description: Coordinate shared local work within host-defined resource budgets; isolate measurements and release reservations during remote waits.
after: Coordination and isolation
---
## Shared machine load

When local work shares a host, follow its declared CPU, memory and I/O budgets
and admission procedure. Before resource-intensive builds, tests or tools,
check current load and running jobs. Choose concurrency and memory controls
within that budget, accounting for interactive use of the machine.

Classify each local phase and its actual commands, hooks and children. A phase
is resource-intensive when its expected CPU, memory or I/O demand exceeds the
host's concurrent-work budget. Use the host's qualification procedure when
expected demand is unknown. Without a budget or qualification procedure, get
operator direction before launching parallel local workers or commands that
build, test, index or process an entire repository or dataset. Bounded reads
and edits may continue. Coordinate competing phases without blocking whole
sessions.

Use an exclusive slot when the host policy requires one or a local performance
measurement needs isolation. Remote inference, light CLI/API work and remote
waits need no exclusive slot. A memory cap, an agent/model comparison or
recording elapsed time alone does not make a phase heavy. Record timing
conditions and concurrent local work for shared or remote evaluations.

Other sessions may continue light reads, edits and remote requests within the
reservation's budget. Preserve measured files, runtimes, dependencies and
services. During isolated local performance measurements, the measuring session
only monitors. Release reservations while waiting on remote work or review.

Constrain work that risks exhausting memory using the host's supported controls.
Check host evidence of memory pressure before retrying with a larger budget.
