---
description: On a shared machine, follow its resource budgets, get operator direction before parallel whole-repository work, and use memory controls.
after: Coordination and isolation
---

## Shared machine load

When local work shares a host, follow its declared resource budgets. Before
resource-intensive builds, tests or tools, check current load and running jobs.
Without a budget, get operator direction before launching parallel local
workers or commands that build, test, index or process an entire repository or
dataset; bounded reads and edits may continue.

Constrain work that risks exhausting memory using the host's supported
controls, and check host evidence of memory pressure before retrying with a
larger budget.
