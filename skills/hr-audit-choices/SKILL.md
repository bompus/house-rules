---
name: hr-audit-choices
description: "Audit the decisions an implementing agent made on the user's behalf, not its diff: trace the work into a choices ledger with a verdict per choice, changing no code. Use when the user asks which choices or assumptions went into implemented work, before landing delegated or AI-implemented work the user wants to review by decision, or when a fix works but may be shaped to one failing case."
---

# Audit choices

Where a task is underspecified, the implementer decides for the user, and the
diff does not flag it. Working code can still rest on a data shape, storage
location, dependency, API contract or tradeoff the user never chose, and later
work inherits each one. This audit lists those decisions so the user reviews
choices instead of lines. It changes no code and never blocks a run; acting on
the verdicts belongs to the caller. For whether the diff meets its spec and the
repository's standards, use `hr-code-review`.

## Steps

1. **Fix the baseline.** Collect what the user actually specified: the prompt,
   later user replies, the plan file and any spec. Choices those sources
   explicitly left to the implementer are discretion, not audit items. Done
   when each requirement cites its source.
2. **Trace every choice.** Walk the session's steps, subagent reports and
   transcripts, diffs and commits. Ask a live implementer which choices it is
   least sure of, but treat its answer as a floor, since implementers
   under-report. Sweep each category: data shapes and formats; storage, paths
   and naming schemes; API contracts and error behavior; added dependencies;
   concurrency, performance and resource tradeoffs; scope interpretation;
   patterns later code will copy. Done when every category has been checked
   against the diff and every choice found is either listed or cited to the
   baseline.
3. **Judge each choice.** Give one verdict:
   - **sound**: general and defensible.
   - **unsound**: state the corrected decision, the property that must hold in
     general, rather than a patch on top. A fix shaped to the one failing case
     is unsound even when the tests pass.
   - **needs-user**: only for taste, product direction or external cost.
     Record a reversible provisional call so an unattended run can continue.
4. **Write the ledger** below. When the task has a plan file, promote
   load-bearing sound choices into it as givens. Done when every choice from step 2 has an entry;
   trivial discretion (internal names, cosmetic calls) may collapse to a
   one-line count.
5. **Report.** Group by verdict in the order needs-user, unsound, sound. Within
   each group, put first the choices the user is least likely to have made the
   same way. When the ledger is long, open with the two or three such choices
   overall. Each needs-user entry becomes a close-out question, shaped as the house
   rules' § Offers describes, with its provisional call as the recommended
   option. List sound entries too: they
   are the architecture the user now owns.

## Ledger

Write `choices.md` beside the task's plan file, or in the task's notes
directory (§ Durable notes) when there is no plan file. Each entry carries:

- **Choice**: a one-line headline, then a scenario that stands alone without
  the diff: the triggering event, what the work does now, and what the
  alternative would do. Define any term of art where it first appears.
- **Gap**: what the baseline left unspecified.
- **Reach**: what later work this constrains or enables.
- **Verdict**, with a one-line reason, plus the corrected decision or the
  provisional call and how to reverse it.
- **Where**: the commit or pass that introduced it.

A `sound` choice already in the ledger or promoted into the plan is settled;
later passes do not list or decide it again. `unsound` and `needs-user` entries
stay open until they are fixed or the user decides them. When entries cluster in one area, the
plan was vague there, so say so in the report.
