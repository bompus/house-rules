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
- Each open offer by its offer ID, with its question, options and
  recommendation. The successor treats an offer as open only if the handoff
  lists it. A bare code or `go` in the successor selects an offer only when one
  listed offer is open. With several, it asks which one, as the house rules'
  § Offers requires.
- The inventory and read-backs from the skill's thread-move step. For a
  successor, the receiving thread re-points these to itself: registry rows,
  scheduled tasks, pull request watches and the messaging name the work was
  known by. Where the host does not let the successor take over the name, the
  handoff says which name the successor registers and who needs to be told.

## Successor record

- Mark the outgoing thread settled and record a pointer to the successor where
  the host keeps such notes. Do this last, after the successor confirms it has
  read the handoff.
- The successor starts by reading the handoff in full, re-pointing each bound
  item with a read-back and recording the result in the receipt before taking
  new work.
