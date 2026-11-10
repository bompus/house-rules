# Replace a session with a successor thread

Follow this when a handoff moves work to a fresh thread that takes over from
the current one. It decides when replacing a session is warranted, when it is
safe and what the handoff and the successor record. The host's own guidance owns
the tool calls that create, rename, place and rebind a thread.

Starting the successor needs the user's direction, a standing spin-off
preference or a rule that requires the handoff (§ Repository work). The user's
own words asking to hand off or rotate to a new conversation, or their choice of
a handoff or rotate option, are that direction: when the host can start a
conversation, start the successor yourself with the handoff prompt as its first
message, then retire the outgoing thread below. A request that names a move
without saying how is ambiguous: start the successor and say so in one line. A
request only to write or save a handoff directs no move.

Ending with a prompt for the user to paste is the fallback: the host cannot start
a conversation, the start failed (say why), or the handoff was written with no
direction to move (a pause, or a low-quota handoff where the user chose no
successor). A fresh session in the same thread starts no new conversation.

## When stale guidance warrants a new session

Replace a session because its injected guidance went stale only when the change
is session-critical:

- an always-on rule, or a safety rule
- the catalog entry (name and description) of a skill the session uses
- a subagent definition the session uses

A change to a skill body or a doc does not warrant a new session. The session
rereads it with `hr-agent-guidance-refresh` at its next boundary, and the body
is read when the skill runs. That skill notes that a reread does not prove the
injected context changed, so use the list above, not the reread, to decide
whether a replacement is needed.

## Boundary

Never replace a session mid-turn, in the middle of an evaluation that fixed its
guidance, or while an external action is pending. An action is pending when it
has started without a recorded result. Replace it only when the session is
idle, nothing is running and the ledger is reconciled under the house rules'
§ Finishing work.

## Successor title

A successor keeps the base title and ends it with ` v<N>`. The first thread
counts as `v1` and is renamed at the handoff.

1. If the title ends in ` v` followed by digits, the base is the title without
   that ending and N is that number. Otherwise the base is the whole title and
   N is 1.
2. Rename the outgoing thread to `<base> v<N>` when its title does not already
   end that way.
3. Give the successor `<base> v<N+1>`, writing N+1 as a plain number without
   leading zeros.

A title is a label for people. Never look a thread up by its title. Use the
thread record, the project and the thread id.

## Where the successor goes

The successor takes the outgoing thread's place, so the user finds it where
they left the old one. Read each value from the outgoing thread's own record
(the launcher is often another thread, whose own project a launch inherits),
set it on the successor and read it back:

- The same project or workspace, and the same environment when the host links
  several. A thread with no project gets a successor with no project.
- The same pin state, and the same snooze or grouping where the host has them.
  A host whose launch call cannot set one sets it with a second call right
  after the launch.
- The title series above, and the model and effort the outgoing thread runs
  unless the user chose others.

A user may pin or unpin the outgoing thread during the handoff, so read its pin
state again just before retiring it and copy a change.

A fresh session in the same thread (an in-place reset) keeps the thread id,
placement, bindings and links, so none of this applies to it.

## What the handoff records

- The outgoing thread's id and the successor's id, so each points to the other.
- Each open offer by the offer ID the ledger recorded for it, with its
  question, options and recommendation. The house rules' § Offers records an ID
  for every offer, including a text-only one that never displayed it. The
  successor treats an offer as open only if the handoff lists it and the latest
  ledger or source record still shows it open. An offer answered, completed,
  deferred or superseded since the handoff was written authorizes nothing. A
  bare code or `go` in the successor selects an offer only when one listed offer
  is open. With several, it asks which one, as § Offers requires. A thread that
  holds no offer, such as a standing worker thread, writes the list as "none"; an
  empty list is not left out.
- The inventory and read-backs from the skill's thread-move step. The
  receiving thread re-points to itself each item the host lets it bind:
  thread records the host keeps, scheduled tasks, pull request watches and the messaging name
  the work was known by. For an item it cannot bind, the handoff keeps the
  recorded reason it stays with the outgoing thread. Where the host does not let
  the successor take over the name, the handoff says which name the successor
  registers and who needs to be told.

## Successor record

The successor starts by reading the handoff in full. It re-points each item it
can bind, with a read-back, and records every result in the receipt, including
the items that stay behind. Only then does it take new work.

## Retiring the outgoing thread

Archive the outgoing thread as soon as the successor has accepted the handoff
(it has read it in full and re-pointed each item it can bind, as in Successor
record), holds what the host bound to the old thread, read back, and the checks
in step 2 hold. Do not wait for the successor's first report, a records pull
request or an acknowledgement sent back to the outgoing thread.

The successor, or the thread that launched it, does these steps; the outgoing
thread does no new work. Bound items move to the successor before the archive,
because archiving can end the outgoing thread's watches. A message to a thread
that is not archived starts a run in it, and a run after the settle undoes the
settle, so every run the outgoing thread still has to make (a last pointer to
the successor, retiring its own copy of a task that only it can unbind) comes
first and ends before the settle.

A thread that launched its own successor cannot archive itself while its run is
open. It does step 1 as its last run and records the archive as pending; the
handoff prompt tells the successor to archive the outgoing thread once that run
has ended and step 2 holds, to read the thread back after the archive and to add
that state to the receipt (steps 3 to 5).

1. Once the successor has accepted the handoff, read back that it holds each
   bound item (scheduled tasks, pull request links and watches, any messaging
   registration, pin position, placement) and finish any such last run. Then
   mark the outgoing thread settled and record a pointer to the successor where
   the host keeps such notes.
2. Archive it without being asked, unless the user said to keep it, when all
   hold: the successor is live, not archived and placed as above; no scheduled
   task is bound to the outgoing thread and no watch it holds is still needed;
   each pull request linked to it is merged, closed or tracked by the
   successor; no worktree or branch of the outgoing thread holds uncommitted or
   unpushed work that the successor does not own; nothing is running, queued or
   waiting on a question or an approval in it, and no delegated task or
   background command it started is still running.
3. When a check fails, leave the thread settled and not archived, and name the
   failed check in the receipt; archive it once the check holds.
4. When a read-back taken after the archive fails, unarchive the outgoing
   thread, repair the item and read it back, then settle and archive it again
   under steps 1 and 2, or leave it settled under step 3 when a check fails.
5. The receipt records the successor's placement and the outgoing thread's
   state (settled, archived or the failed check), each with the read-back that
   verified it, and any unarchive and repair.

## On T3 Code

The host adapter for the steps above; the tool calls are T3's, and each takes
`environmentId` for a thread on a linked environment.

- `t3_thread_launch` has no pin or snooze field. It takes `projectId` (omitted:
  the launcher's own project), `scratch: true` (a new scratch folder, not the
  outgoing thread's) and `environmentId` (omitted: the launcher's own
  environment). Pass the outgoing thread's `projectId` from `t3_thread_read`,
  `scratch` only when its record has none, and its `environmentId` (the second
  part of its thread link). Then call `t3_thread_organize` on the successor's
  `threadId`: `action: pin` when the outgoing thread is pinned, and `snooze`
  with its `snoozedUntil` when it is snoozed. Pin and snooze are separate; set
  each that applies, with `unpin` or `unsnooze` for a change made meanwhile.
- `t3_thread_read` and `t3_thread_list` show `projectId`, `title`, `settled`,
  `snoozed`, `snoozedUntil` and `archived`, but not the pin. Read the pin as
  `pinnedAt` in the local state database of the environment the thread lives
  on: the `payload_json` of its row in `orchestration_v2_projection_threads`,
  through a read-only connection.
- `t3_thread_launch` copies the launcher's model unless the launch names one,
  and the thread tools above do not show the stored model. Read the outgoing
  thread's provider, model and effort with `t3_thread_configure`, name them in
  the launch, and read the successor's back with the same call.
- `t3_thread_organize` with `action: settle`, then `archive`. A thread's own
  settle applies at the end of its turn and a failed turn or queued message
  leaves it active, so verify with `t3_thread_read` after the run ends.
  `unarchive` undoes a premature archive, for the repair in step 4.
