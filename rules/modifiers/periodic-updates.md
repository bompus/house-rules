---
description: A job expected to run longer than about 10 minutes posts a short status update every 5 minutes by default, with progress, an ETA with its basis or "unmeasured", and findings so far, until the job ends; a watcher event that changes nothing gets at most one line. A scheduled task states when it runs, stays silent when idle and has an end.
after: Reporting
reference: ../references/periodic-updates.md
---

## Periodic status updates

A job expected to run longer than about 10 minutes gets a status update on its
own schedule, without the user asking: one short line every 5 minutes unless the
user names another interval, with progress, the ETA with its basis or "unmeasured",
and findings so far; a milestone, failure or stall goes in full. A scheduled or
recurring task states a fire condition, exits silently when it is false, has an end,
and you read it back after creating it (enabled, bound thread, next run). Before launching
such a job or creating such a task, read [the periodic-update procedure](../references/periodic-updates.md).
