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

After a model review, treat each finding as a claim. Fix it when a reproduced
failure (a test that fails before the fix, where one fits) or a cited
requirement confirms it, with the smallest change that clears it; a reviewer's
proposed remedy is a suggestion. Answer an unconfirmed finding with the reason.
Run the relevant checks. A fix that changes code logic permits a follow-up
review; it does not require one.
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
remove your own released scratch, worktrees and branches as § Cleanup says, and
offer an app-managed session's branch to its owner for deletion, unless the
session is still on it. Before creating a task worktree, check the
repository's worktree list and report unexplained leftovers; `git worktree
prune --dry-run` shows stale registrations.

Bind a chosen model effort explicitly through the live host's advertised
control, for a session, a panel seat, a subagent, a reviewer or a benchmark
arm. Verify the effective settings; a model suffix, catalog entry or
requested value is not an effective-effort receipt. Fail closed if the route
cannot honor the choice. Preserve frozen comparison inputs and historical
runs; record a new cohort for any newly selected effort instead of relabeling
prior results.

A sender that retains follow-through until a handoff is accepted records it
as an item inside its plan's Ledger, never only as a note: recipient, the
work id the acceptance must name, and a near `recheck:` date, so open-work
checks count it and surface it when overdue. The acceptance names that work
id. An acceptance arriving in the sender's thread is work for whichever
session receives it, not a notification: its first action, before other work
or any handback, is to verify the receiver's canonical record and close the
sender's Ledger item in place with a pointer to it. Delivery of the handoff
or of the acceptance is not that recording, and the task is not finished
while its acceptance item is open. Recording acceptance only retires the
sender's tracking item: it authorizes no recipient operation, replay of a
completed external effect, or waiver of access, attempt, publication or
frozen-evaluation limits, and unknown external outcomes still need
verification before any repetition.

On a host whose delegated tasks run through T3 Code (`delegate_task`), the T3 section below covers telling working from waiting or stuck.

### Reading a T3 delegated task's progress

How a parent thread tells whether a task from `delegate_task` is working, waiting
or stuck. Two events wake the parent: the task finishing, and a user question
from the child, which also ends a `mode=wait` call early (`hasPendingQuestion`).
An approval request does not send an asynchronous wake. A blocking `mode=wait`
returns `pendingApproval` on servers with pingdotgg/t3code #20037. Read the
fresh request in the child; that result grants no authority to approve it.
Field names below were read from live `t3_thread_read` output; the stall rule is
a heuristic, not a T3 contract.

#### When the task is over

`task_status(taskId)` is the end of the task. Its `workState` is `working`,
`waiting_for_children` or `result_available`; a completed turn with live nested
work is not a finished task. `summary` is the final result, including a provider
error on failure. `hasPendingChildRuns` reports later queued or running turns in
the backing thread. Completion also wakes the parent, so end the turn instead of
polling. `t3_thread_wait` reports run status only, a timeout does not stop the
child, and waiting does not acknowledge the result.

On servers with pingdotgg/t3code #22709, completion is checked again when a
child's background work or nested delegates settle. A run ending before that
work finishes is expected; wait for the task result. The built-in Grok ACP
adapter also recognizes completed background command output and successful
kill results, so those commands no longer leave a finished task running.

#### Do not launch a child that can wait for approval

An async child runs in a hidden thread. In `approval-required` mode its first
tool prompt waits for a click nobody sees: the parent shows `running`, the child
shows `status: running` with `pendingRequestCount` above zero, and nothing moves.
On 2026-10-11 two research advisors sat that way for about two hours before the
user asked for progress.

- Leave `runtimeMode` unset (inherit) on `delegate_task`; never pass
  `approval-required` for a background child. Inherit only helps when your own
  mode does not require approval: check it first, and when your own mode is
  `approval-required`, do not launch a hidden async child at all, because it
  inherits the blocking mode. Use a visible route the user already authorized,
  or ask. Keep a child read-only by saying so
  in its task prompt and naming the one folder it may write, not by choosing a
  mode that blocks it.
- Ask for a bounded result: a word limit and a stop condition in the prompt.
- Check once about two minutes after launching: `t3_thread_read` must show
  `pendingRequestCount` 0 and an `updatedAt` after the start. A count above zero
  is not by itself a blockage: read the pending requests first (see
  `pendingRequestCount` below) and handle a legitimate question instead of
  interrupting. Interrupt with `t3_thread_interrupt` only when the child waits
  on an approval nobody will see, or nothing has moved; say so to the user and
  relaunch only after fixing the cause. Do not poll beyond this check while
  completion wakes the parent; the cases below that never send that wake get
  bounded follow-up checks instead.
- Tell the user within the same reply when a child is stuck. Never wait for
  them to ask.

#### While it runs

Read the child's `childThreadId` with `t3_thread_read` and `view=activity`. Use a
small `limit` and `maxCharsPerItem`, then continue with `afterPosition`; a full
read of a long thread is very large. The thread header carries:

- `status` and `activeRunId`: whether a run is in progress.
- `updatedAt`: the latest change to the thread; each activity item has its own.
- `recentRuns`: each run's status, `startedAt` and `completedAt`.
- `pendingRequestCount`: the child is waiting on a request, not working. The
  count includes approval requests as well as user questions. Read user questions
  with `t3_pending_request` with `action: 'list'`; approval requests are not listed there, so a
  count above zero with an empty list means the child waits for an approval click
  in its own thread.

#### Is it stuck?

A running child whose `updatedAt` has not moved for a window you choose may be
stalled. No threshold is documented. A model can reason silently for minutes, so
a quiet interval alone is not failure: check `pendingRequestCount` first, then
read the newest activity item, then decide whether to wait or `task_cancel`.
`task_cancel` also stops queued turns in the backing thread. From nightly 3373
(pingdotgg/t3code #21487) it removes the task's own queued run even while the
thread's queue is held, leaves other queued work in place, and the parent task
cards stop showing a stale status. Older servers left the held run queued.
With pingdotgg/t3code #22653, Stop also clears stuck parent task cards even
when the child is busy or its bound run has already finished. Cancelling can
stop work still running in the child; read its current activity first.

#### A child that finished but still shows running

A Cursor child can post its full answer and stay
`running`. T3 closes a Cursor run only when the SDK's `run.wait()` resolves; there
is no idle timeout. On 2026-10-11 a Grok seat's SDK `turn-ended` event fired and
T3 never logged a run completion. That observation is about the Cursor SDK,
not the built-in Grok ACP adapter fixed by #22709. The same PR fixes the
background-work settlement case reported in #17512; neither change establishes
that the Cursor SDK now ends these runs. Check the current issue status before
filing a report; #17565 was closed as not planned because it is the Cursor SDK's
behavior.

- End every brief for a panel seat with a fixed last line, such as
  `END-OF-REPORT`, and say it is the last thing the seat writes.
- Keep the `taskId` and the `childThreadId`. Read the child with
  `t3_thread_read` and `view=activity`, a small `limit`, and `itemId` for the full
  text of a long answer.
- Rules of thumb, not T3 contract. Because these children send no completion
  wake, bounded follow-up reads replace it: check at the intervals the task's
  expected duration suggests, not continuously. A reasoning or tool item under
  about 3 minutes old means it is working. An assistant message ending in the
  sentinel that is over 2 minutes old with the run still `running` means it
  finished, but only when the message belongs to the current run: check it
  against the active run's identity or `startedAt`, and ignore sentinel
  messages from earlier runs in the same thread, which a follow-up in that
  thread leaves behind. Read the answer first, then `task_cancel`. Any item over 10 minutes
  old without the sentinel is only a trigger to investigate, as above: a long
  command can run quietly for longer than that. Cancel after confirming a
  stall, or at a timeout selected for the task in advance, not on age alone.
- Cancelling shows the task as cancelled or interrupted, not `result_available`.
  Take the result from the thread read. On 2026-10-11 `t3_thread_interrupt` on such
  a child closed it in about 10 seconds, the SDK's interrupt timeout.
- Whether the Cursor agent keeps working after `turn-ended` is unverified.

Do not start another independent review round by sending a message to `childThreadId`; start a
new `delegate_task` with the full brief. A follow-up that needs the same child's conversation is
the exception: send it with `t3_thread_send` on `childThreadId`.
