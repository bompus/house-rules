---
description: A watcher event or timer that changes nothing gets at most one line, and watchers are armed to emit only milestones, failures, stalls, forecast changes and run completion.
after: Reporting
---

## Quiet watchers

A watcher event or timer that changes nothing needs at most one line, not a
status report. Report in full at a milestone, a failure, a stall, a change in the forecast or
the run's completion, and arm a watcher to emit those, not every item.
