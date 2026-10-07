---
name: hr-split-to-prs
description: Split a branch, working tree or proposed change into coherent pull requests when the user asks to divide the work.
---

# Split work into pull requests

Produce slices that can be reviewed and verified against their actual bases.
A request for a split proposal authorizes analysis. Execute a selected split
within the user's existing authorization; ask only about unresolved scope.
Repository guidance owns checks, submission, landing and cleanup.

## Establish what belongs to the task

Identify the default branch and the checkout's committed, staged, unstaged and
untracked work. Inspect ownership guidance for affected paths. Record other
owners' changes separately and preserve them throughout the split.

Describe each slice by its resulting behavior, affected paths and acceptance
check. Divide independent concerns; keep changes together when separating them
would break either slice or require temporary machinery with no outside user.

For a real dependency, state which change must land first and why. Use a stack
only when a slice cannot work against the default branch. Compatibility stages
need an actual outside caller, released interface or stored-data constraint.
An API replacement with no such dependency can migrate its callers and remove
the old path together.

Present the proposed PR titles and dependencies before moving work unless the
user already selected that plan. Name any work left outside the split. A title
that describes only part of a slice calls for a better title or a different cut.

## Preserve and partition

Before moving changes, establish a recovery point for all owned work. Committed
work needs a retained commit or ref. Dirty tracked files and untracked files
need a verified snapshot that preserves their contents. `git stash create`
can capture tracked changes without altering the tree; it omits untracked files.
Do not claim a backup is complete until those files are accounted for too.

Choose isolated checkouts when the starting checkout is shared. For each
selected slice, reconstruct only its owned changes on the intended base.
Stage explicit paths or hunks and inspect the staged diff before committing.
Do not discard the starting work or rewrite published history to obtain a clean
slice. If a path mixes concerns, split its hunks only when each result remains
correct; otherwise keep the dependent changes together.

Verify each slice against the base it will actually target, including any
required earlier slice. Run its relevant checks and every repository-required
gate. A passing combined branch does not prove each separated PR works.

Submit and land only within existing authorization through the repository's
required path. Follow its rules for stacked targets and branch retirement.
Preserve recovery material until cleanup is authorized and no owner needs it.

## Account for the result

Report each PR or retained branch, its base and verification result. Reconcile
remaining working-tree files and commits against the original inventory.
Identify blockers, other owners' work and any recovery material still retained.
Use `hr-writing-pr` for PR text when that skill is available.
