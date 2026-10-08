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

After a model review, fix its findings and run the relevant checks. A fix
that changes code logic permits a follow-up review; it does not require one.
Code logic includes control flow, data handling, interfaces, queries and values
a program reads. Request a follow-up only for a named remaining risk that
local checks cannot resolve. Batch known fixes first, then focus the review on
changed logic and unresolved findings. Never restart a whole-change review
solely because a fix changed logic.

Before a follow-up, record its scope and round limit in the plan. A further
logic fix does not reset that limit. When the limit is reached, report any
remaining blocker and get the user's direction before another model round.
Fixes that touch only docs, comments, changelog text or tests ship on local
checks. The pull request body names the findings fixed and says when no
further round ran. Required repository checks and review gates still apply.

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
