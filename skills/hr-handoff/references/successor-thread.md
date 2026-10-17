# Replace a session with a successor thread

Follow this when a handoff moves work to a fresh thread that takes over from
the current one. It decides when replacing a session is warranted, when it is
safe and what the handoff and the successor record. It does not authorize
starting a thread. The house rules' § Repository work still requires the
user's direction, a standing spin-off preference or a rule that requires the
handoff. The host's own guidance owns the tool calls that create, rename and
rebind a thread.

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
registry row, the project and the thread id.

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
  holds no offer, such as a project Orchestrator, writes the list as "none"; an
  empty list is not left out.
- The inventory and read-backs from the skill's thread-move step. The
  receiving thread re-points to itself each item the host lets it bind:
  registry rows, scheduled tasks, pull request watches and the messaging name
  the work was known by. For an item it cannot bind, the handoff keeps the
  recorded reason it stays with the outgoing thread. Where the host does not let
  the successor take over the name, the handoff says which name the successor
  registers and who needs to be told.

## Successor record

- Mark the outgoing thread settled and record a pointer to the successor where
  the host keeps such notes. Do this last, after the successor confirms it has
  read the handoff.
- The successor starts by reading the handoff in full. It re-points each item
  it can bind, with a read-back, and records every result in the receipt,
  including the items that stay behind. Only then does it take new work.
