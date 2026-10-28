# Adjudicate a panel

Use this after a panel of models has answered the same brief and you must turn
their replies into one result. It covers reading the replies, checking what they
cite and reporting the choices. Resolving the seats comes first and is in
[the panel plan contract](panel-plan.md).

## Read the replies

1. Extract each seat's text from its log. List what the seats agree on and where
   they contradict each other.
2. For every claim that carries weight, note whether each seat cites a receipt
   that passes the check below. Two seats that cite the same line, or neither
   citing anything, are unverified agreement, not corroboration.
3. Run the citation gate on the logs:

   ```sh
   bun <skill-directory>/scripts/check-receipts.mjs --repo <repo> <panel-log>...
   ```

   A citation written as `` `name` (path:line) `` passes only when the identifier
   appears on the cited lines. A bare `path:line` passes when the file has that
   line. A file named by basename or subpath must resolve to exactly one file in
   the repository. Exit 1 means adjudicate those claims by hand; it does not mean
   the panel failed. Exit 2 means no citations were found, a log could not be read or the
   arguments were wrong; treat it as an unverified gate. Only exit 0 passes. A citation
   to a file outside the repository fails.

4. A person checks the remaining claims against the source. Record the base you
   chose, what you took from other seats, what you rejected and which seats
   dropped out. Keep the logs in the task's scratch directory, not in the repository.

## Compare competing implementations

When the brief asks seats to produce competing implementations and a cheap
objective check (tests, a diff) exists, state the rubric before the run. The
result may name a base and graft the others' best parts by hand, so the whole
stays coherent. Name the premise the choice depends on and challenge it with one
concrete case, including any hand edits made after the verdict. A graft that fails
the case is recorded as unresolved, not named a winner.

## Break a tie

Give one seat both verdicts and your adjudication, and ask for residuals only,
under the same read-only contract. Residuals are what the reference method misses,
whether each surviving item is earned, and anything wrongly declined.

## Open the report with a receipt

Begin every panel report with this header so the choices can be audited without
re-reading the thread:

- **Seats:** each model, its family and its role (consensus, contrarian, tie-break).
- **Settings per seat:** the effort or variant actually used and the one-line rule
  that selected it (task mapping, seat rule or the user's explicit choice).
- **Deviations:** any seat that did not run as briefed (fallback route, escalation,
  dropout) and what replaced it.
- **Adjudication basis:** the gate result, what was checked by hand and what remains inference.
