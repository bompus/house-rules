# Consolidating a large ledger

A ledger past its budget (more than 100 open or deferred lines, or a plan of
256 KiB or more) often holds a lot of finished work: a result was logged on a new
line and the line that promised it stayed open. In the one run measured, 242 of
498 lines closed with checked evidence. Consolidation closes the lines
whose completion can be checked, with that evidence, and leaves every decision
to the user. It detects, reports and offers on its own; it spends tokens and
changes the ledger only after the user says go, and no helper's verdict closes a
line by itself.

## Before starting

1. Work in a scratch directory outside the repository, kept until the closures
   are applied and checked. Everything below is `node
   <skill-directory>/scripts/consolidate-ledger.mjs`.
2. `chunk <plan> <workdir>` copies the plan to `plan.snapshot.md` and splits its
   open and deferred lines into `chunk-NN.txt` files of about 60 lines or 70 KB. It
   writes only the scratch directory and starts nothing, so run it first to get
   the chunk count. Helpers and the later checks refer to the snapshot's line
   numbers, so it refuses a directory that already holds a snapshot or helper
   results unless you use a new one; `apply` writes `plan.before-closures.md`
   once, the plan as it stood before any closure.
3. Offer the consolidation (SKILL.md, step 1) with that chunk count as the helper
   count, the token range, the minutes and the plan quota the helpers draw on.
   One answer starts it or declines it.

One run used 8 helpers on chunks of 60 lines, 135,000 to 170,000 tokens each and
about 10 minutes of wall-clock time with the helpers in parallel. Long lines make
more chunks and more tokens, so say the estimate rests on that one run.

## Helpers

Start one read-only helper per chunk, only when the user says go. Brief each with
the chunk file, the snapshot path, the verdict list below and these rules:

- Be conservative. Never judge from an old description; a past `recheck:` date
  is not done. A merged pull request alone does not finish a line whose scope also
  needs an install, adoption, notice or cleanup.
- Use read-only checks only: `gh pr view` and `gh issue view`, `git log` and
  `git show` on local checkouts without fetching, plan files, small thread reads.
  Send no messages, make no commits, start no heavy command.
- Search the whole snapshot for a later line that records a result without
  closing the earlier one.
- Write only `results-NN.tsv`, and write it even for partial work: a server
  restart cancels running helpers and a results file is what survives.
- Reply in at most 12 lines: the count per verdict, anything surprising, the path.

One row per ledger line, tab-separated, with a header `line verdict evidence
note`. The line is `L<number>` from the snapshot. The evidence is at most 300
characters and names what a reader can re-check: `owner/repo#number` for a pull
request or issue, `L<number>` for a ledger line. The verdicts:

| Verdict    | Meaning                                                                    |
| ---------- | -------------------------------------------------------------------------- |
| DONE       | The full scope is finished, with concrete evidence that can be re-checked. |
| SUPERSEDED | A specific later line or offer carries the open scope.                     |
| WAITING    | Still valid; name the owner and the trigger or date.                       |
| DECISION   | Waits on a selection only the user can make.                               |
| OPEN       | Work remains under existing authority; name the next step.                 |
| UNCLEAR    | Say what was checked.                                                      |

## Checking and applying

`verify <workdir> [--exclude <file>] [--offline]` checks every DONE and SUPERSEDED
row against the snapshot and GitHub and writes `closure-candidates.json`. A DONE
row is `ok` only when it names at least one pull request, issue or ledger line
already marked done (a dropped line was given up, not finished), and every pull
request or issue it names, in the row or in the ledger line itself, is merged or
closed. A ledger line that the row or the line itself names and that is still
open, or closed without its proof, holds the row back, as does a line the row
names that does not exist.

A SUPERSEDED row is `ok` when it names another ledger line that exists and keeps
the scope: a line that is closed, stays open, or is itself superseded by one that
does (two lines superseding each other carry nothing). A replacement that is
itself superseded by a line that fails the check holds the first row back too;
fix the later row and verify again.

Everything else is held back with a flag: `BAD` (a named pull request, issue or
ledger line is open or not found), `UNCHECKED` (a DONE row, or its line, names a
pull request or issue without its repository, such as `tool#2` or `PR #42`, which
cannot be checked unless the same number is also named with one), `NOREF`
(nothing checkable is named), `EXCLUDED`, `CONFLICT` (two rows disagree),
`DUPLICATE` and `INVALID` (an unknown verdict, or a line that is not open or
deferred). Run one `verify` at a time per work directory. When GitHub cannot be
asked it exits 3 and checks nothing.

Put the lines whose evidence is weaker than you want to close on without a look
in the exclusion file, one `L<number>` per line (`#` starts a comment), and show
them to the user afterwards. Read the flagged rows too: a `NOREF` row is often
true and only lacks a reference to name.

`apply <workdir> <plan> --dry-run` lists what would close; without `--dry-run` it
closes each `ok` candidate in place with `close-ledger-line.mjs` (DONE as done,
SUPERSEDED as dropped), adding the checks that passed to the evidence. A line
edited since the snapshot, no longer open, or resting on a ledger line (or a chain
of them) whose text has changed in any way, other than by a closure an earlier
`apply` of this work directory made (it records each in `closures-written.json`),
or whose closed state has changed since `verify` is skipped and reported; a
snapshot that changed since `verify` stops the run. Apply soon after verifying:
pull request states are read once, by `verify`.

Nothing else should edit the plan while `apply` runs; it has no lock, so a line
changed between its check and its close is not caught. A single line of about
128 KiB or more cannot be passed to the close helper; `apply` reports that
closure as failed and leaves the line open. A superseded row rests on the first
named line that carries the scope, and a dropped line counts as carrying it
without the check following where its own `by:` text points; read the lines
closed as superseded in the report. Running it again changes nothing. Afterwards
run `check-open-work.mjs` on the plan and compare the counts with the dry run.

## What remains

WAITING, DECISION, OPEN and UNCLEAR rows stay in the ledger. Report the counts
and what closed. An UNCLEAR row on a long compound line usually means the line
holds several items; split it into separate lines with their own evidence, then
ask again. Do not close an UNCLEAR row to shrink the count. Group the decisions
by concern or project and ask them through the walk-through (SKILL.md), the group
whose answers unblock the others first. In the one run measured, a ledger of 498 open or deferred lines drew 247 closure
proposals; 242 were applied with checked evidence and 5 were held back as weaker.
Helpers returned UNCLEAR for 21 rows, mostly on long compound lines.
