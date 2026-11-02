---
description: A job expected to run longer than about 10 minutes posts a short status update every 5 minutes by default, with progress, an ETA with its basis or "unmeasured", and findings so far, until the job ends; a watcher event that changes nothing gets at most one line. A scheduled task states when it runs, stays silent when idle and has an end.
after: Reporting
reference: ../references/periodic-updates.md
---

## Periodic status updates

A job expected to run longer than about 10 minutes gets a status update on its
own schedule, without the user asking, and so does a job that has run that long
with no estimate. The launch reply gives the total ETA with its basis (or
"unmeasured") and the interval. The default is one short line every 5 minutes unless
the user names another, posted even when nothing changed, with progress, the ETA with
its basis or "unmeasured", and findings so far; a milestone, failure, stall or change
in the forecast goes in full. Where the host can run a background watcher or timer,
arm it when launching the job and wait on the job through it, not in one long
blocking call; stop the updates when the job ends. A scheduled or recurring task
states a fire condition, exits silently when it is false, has an end, sends no
"nothing to report" message and is read back after creating it (enabled, bound
thread, next run); it uses no metered route unless approved. Before launching such
a job or creating such a task, read
[the periodic-update procedure](../references/periodic-updates.md).
