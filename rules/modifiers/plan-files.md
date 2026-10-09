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
notes). At session start, read the relevant plans and every `blocked-on-user`
plan whatever its owner, so unanswered decisions stay visible; that read is not
the sweep below. Update the plan when you update the list, add findings as they
turn up, and use the same item states in both. At each reconciliation event in
§ Finishing work, update both records before choosing the next action. Point at
the plan or handoff that owns an item instead of copying it; a handoff points
at its plan.

- Head the plan with `Owner:` (session name, or `none` for a shared backlog)
  and `Status:` (`active`, `paused`, `blocked-on-user`, `completed`); update both
  when they change.
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
- Before archiving a completed plan, save its completed status, completion
  time and evidence. Apply § Finishing work before marking the whole session
  completed. Then move the plan to `plans/archive/<topic>-<date>/` beside it.

Sweep other sessions' plans and handoffs only when the user asks, such as
"what's waiting on me?", and only for the current project. Offer unowned items,
`blocked-on-user` items and items whose owner has no live session in the host's
session list or coordination roster, naming each owner. When you cannot tell
whether an owner is live, or who owns an item, mention it as another session's
context instead of offering it.
