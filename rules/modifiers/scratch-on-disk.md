---
description: Task scratch lives on disk under the user data directory, never in RAM-backed /tmp.
after: Durable notes
---

## Scratch files

Keep task scratch on disk-backed storage, under `tmp/<topic>/` in your notes
directory (§ Durable notes), even when a tool or harness defaults to `/tmp` or
to a temp path it pre-approves. On many Linux systems
`/tmp` is RAM-backed, so large files there compete with running programs for
memory. Files that can approach 1 GB (databases, traces, downloads, extracted
archives) never go there, whatever a tool's default says. Write in-progress
receipts straight to their final location. Delete your own scratch without being
asked as soon as nothing still needs it, once anything worth keeping is saved where
it belongs (§ Cleanup).
