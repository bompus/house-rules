---
description: Task scratch lives on disk under the user data directory, never in RAM-backed /tmp.
after: Durable notes
---
## Scratch files

Keep task scratch on disk-backed storage, under `tmp/<topic>/` in your notes
directory (§ Durable notes), even when a tool defaults to `/tmp`. On many Linux systems
`/tmp` is RAM-backed, so large files there compete with running programs for
memory. Files that can approach 1 GB (databases, traces, downloads, extracted
archives) never go there, whatever a tool's default says. Delete scratch when
the task ends.
