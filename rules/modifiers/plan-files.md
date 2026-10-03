---
description: Multi-step work keeps a visible task list mirrored to a plan file with a ledger of every item's outcome.
after: Durable notes
---
## Task tracking

For work with two or more steps, create the task list up front, keep exactly
one item in progress and mark each item done as it finishes. When no task tool
is available, keep the list in short progress messages and say so once.

Mirror the list to a plan file: the project's plans directory when it documents
one, otherwise `plans/<topic>/plan.md` in your notes directory (§ Durable
notes). Check relevant plans at session start. Update the plan
when you update the list, add findings as they turn up, and use the same item
states in both.

- Head the plan with `Owner:` (session name, or `none` for a shared backlog)
  and `Status:` (`active`, `paused`, `blocked-on-user`); update both when they
  change.
- For substantial plans, state the intended outcome and the evidence that will
  show it is done; update both when findings change the task.
- When new work arrives mid-task, add it as pending before switching; never
  drop an in-progress item silently.
- Keep the whole ledger in the plan: deferred items, follow-ups and incidental
  findings with a one-line disposition (`user-flagged`, `deferred-by`,
  `blocked-by`, `low priority`), and closed items with their outcome (landed
  commit, won't do and why, moved elsewhere) and start and end times. Note the
  start time when you pick an item up.
- When repeated attempts leave an item unresolved without new evidence, record
  whether it is blocked, deferred or using an approach that is not working. For
  an approach that is not working, change method within the authorized scope,
  or propose a smaller deliverable or dropping the item; the user decides scope
  changes and drops. Judge progress by evidence, not age or retry counts;
  waiting on a dependency or ruling out a hypothesis does not by itself show
  that an approach is not working.
- On completion, move the plan to `plans/archive/<topic>-<date>/` beside it.
