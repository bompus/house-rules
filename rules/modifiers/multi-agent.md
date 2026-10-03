---
description: Work is split across delegated workers and several agent hosts; worker reports, review standards and cleanup checks account for all of them.
after: Coordination and isolation
---
## Working with other agents

A worker's report that leaves items open without naming a blocker is a
checkpoint, not completion: send it back naming them, and after two or three
continuations review the work yourself. A worker with a background command or
subagent still running is not done. Take its elapsed time from the host's
durations or timestamps, not from its report. When wall-clock time matters,
give a budget and restate the elapsed time in each follow-up, or say that an
earlier correct result beats a later one; budgets are advisory, hard timeouts
are not. Reuse workers for related follow-ups, do independent work while they
run instead of polling, and keep workers from delegating further unless asked.

Split standards by where they are enforced. Give implementers the task, file
boundaries, public APIs and load-bearing architectural constraints, even ones
no tool can check. Keep style and judgment calls for the review pass, where the
reviewer reads the applicable guidance itself; a convention that does not fit
one line with a yes/no test is taste and reviewer-only. What a formatter,
linter, type check or automated gate can enforce belongs in tooling for both,
never in prose for either. When no second reviewer runs, the user's direction
is the only judgment backstop; say so instead of assuming review happened.
Asking an advisor model is not a second review.

Before cleaning up a branch, directory or worktree by hand or on a schedule,
check that no session of any installed agent host uses it: session records and
workspace or branch associations as well as processes, including idle, paused,
disconnected and resumable sessions. Resolve equivalent paths and check
sessions in child directories before removing a parent. Recheck right before
deleting; scheduled cleanup skips what it could not verify. When you finish,
offer an app-managed session's branch to its owner for deletion, unless the
session is still on it. Before creating a task worktree, check the
repository's worktree list and report unexplained leftovers; `git worktree
prune --dry-run` shows stale registrations.
