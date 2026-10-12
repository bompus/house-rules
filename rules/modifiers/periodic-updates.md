---
description: A job expected to run longer than about 10 minutes posts a short status update every 5 minutes by default, with progress, an ETA with its basis or "unmeasured", and findings so far, until the job ends.
after: Reporting
---

## Periodic status updates

A job expected to run longer than about 10 minutes gets a status update on its
own schedule, without the user asking. So does a job that has run that long with
no estimate. This covers a build, test suite, benchmark, CI run, long search or
similar. The default interval is 5 minutes. That figure is a default, not a
measured value; use the interval the user names instead.

Each update is a short line, posted even when nothing has changed. It gives
completed/total or a percent (the current step when the job reports no total),
the ETA with its basis or the word "unmeasured", and a one-line summary of
findings so far. A milestone, failure, stall or change in the forecast goes in
full instead.

Where the host can run a background watcher or timer, arm it to post the
updates. Otherwise post at the first natural checkpoint after each interval has
passed, when a step finishes or a tool call returns. Stop the updates when the
job ends; the final report replaces them.
