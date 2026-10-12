---
description: On a shared machine, follow its resource budgets; without one, get operator direction before parallel workers or whole-repository commands, and use memory controls.
after: Coordination and isolation
---

## Shared machine load

When local work shares a host, follow its declared resource budgets. A phase is
resource-intensive when its expected CPU, memory or I/O demand exceeds the
host's budget for concurrent work. Before such a phase, check current load and
running jobs. Without a budget, get operator direction before launching
parallel local workers or commands that build, test, index or process an
entire repository or dataset; bounded reads and edits may continue.

Work risks exhausting memory when its expected or last measured peak leaves
little headroom in the memory available to it, or when its peak is unknown and
its input is large. Constrain such work using the host's supported controls.
Check host evidence of memory pressure before retrying with a larger budget.
