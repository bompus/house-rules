---
description: A job expected to run longer than about 10 minutes posts a short status update every 5 minutes by default, with progress, elapsed time, what it waits on and findings so far (a finish time only when a named comparable finished run supports it), until the job ends; a watcher event that changes nothing gets at most one line. A scheduled task states when it runs, stays silent when idle and has an end.
after: Reporting
reference: ../references/periodic-updates.md
---

## Periodic status updates

A job expected to run longer than about 10 minutes gets a status update on its
own schedule, without the user asking, and so does a job that has run that long
with no estimate. The launch reply gives the interval and what the job waits on, and a finish time only when a named comparable finished run supports it. The default is one short line every 5 minutes unless
the user names another, posted even when nothing changed, with progress, elapsed time, what the job waits on and findings so far, and no end time or whole-task ETA without that run; a milestone, failure, stall or change in a supported forecast goes in full. Where the host can run a background watcher or timer,
arm it when launching the job and wait on the job through it, not in one long
blocking call; stop the updates when the job ends. A scheduled or recurring task
states a fire condition, exits silently when it is false, has an end, sends no
"nothing to report" message and is read back after creating it (enabled, bound
thread, next run); it uses no metered route unless approved. When updating a task,
change only the fields you mean to: a thread binding or schedule reset as a side effect
is a change. Before launching such a job, or creating, updating or disabling such a
task, read
[the periodic-update procedure](../references/periodic-updates.md).
