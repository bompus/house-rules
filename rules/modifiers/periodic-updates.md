---
description: A job expected to run longer than about 10 minutes posts a short status update every 5 minutes by default, with progress, an ETA with its basis or "unmeasured", and findings so far, until the job ends; a watcher event that changes nothing gets at most one line. A scheduled task states when it runs, stays silent when idle and has an end.
after: Reporting
---

## Periodic status updates

A job expected to run longer than about 10 minutes gets a status update on its
own schedule, without the user asking. So does a job that has run that long with
no estimate. This covers a build, test suite, benchmark, CI run, long search or
similar. The default interval is 5 minutes. That figure is a default, not a
measured value; use the interval the user names instead. In the reply that
launches the job, give its total ETA with the basis (or "unmeasured") and the
interval. Give the ETA again whenever it changes, including when more rounds are
queued.

Each update is one short line, not a report, posted even when nothing has
changed. It gives completed/total or a percent (the current step when the job
reports no total), the ETA with its basis or the word "unmeasured", and a
one-line summary of findings so far. A milestone, failure, stall or change in
the forecast goes in full instead.

Where the host can run a background watcher or timer, arm it in the step that
launches the job. It posts a line every interval, even when nothing changed. It
reports in full only a milestone, failure, stall, forecast change or the run's
completion. A watcher that fires only on milestones leaves the user with silence
between them. A watcher event that changes nothing gets at most one line. Wait
on the job through the watcher, not in one long blocking call. Such a call shows
nothing until it returns, and a user message can interrupt it. Otherwise post at
the first natural checkpoint after each interval has passed, when a step
finishes or a tool call returns. Stop the updates when the job ends;
the final report replaces them.

A scheduled or recurring task states a fire condition (what must be true for a run to
do work), exits silently when the condition is false, and has an end: it disables
itself after 3 consecutive runs that found nothing to do, or it carries an end date.
A run that has nothing to report sends no "nothing to report" message.

Before creating one, settle its purpose and owning thread, the scope it may change (no
metered route unless approved), and who is told, and only on a change or failure.
After creating it, read it back: enabled, bound thread, next run. When updating a
task, change only the fields you mean to; a thread binding or schedule reset as a side
effect is a change.
