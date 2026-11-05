---
description: A job expected to run longer than about 10 minutes posts a short status update every 5 minutes by default, with progress, elapsed time, what it waits on and findings so far (a finish time only when a named comparable finished run supports it), until the job ends; a watcher event that changes nothing gets at most one line. A scheduled task states when it runs, stays silent when idle and has an end.
after: Reporting
reference: ../references/periodic-updates.md
---

## Periodic status updates

A job expected to run longer than about 10 minutes, or one that has run that long with no
estimate, gets a status update on its own schedule without the user asking: by default one
short line every 5 minutes, posted even when nothing changed, with progress, elapsed time,
what the job waits on and findings so far, until the job ends; a milestone, failure, stall or change in a supported forecast goes in full; a finish time only when a
named comparable finished run supports it. A scheduled or recurring task
states a fire condition, exits silently when it is false, has an end, uses no metered route unless approved and sends no "nothing
to report" message. Before launching such a job, or creating, updating or disabling such a
task, read [the periodic-update procedure](../references/periodic-updates.md).
