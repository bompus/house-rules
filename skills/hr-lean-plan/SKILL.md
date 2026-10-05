---
name: hr-lean-plan
description: Write or critique an implementation plan so it reaches the goal with the fewest moving parts, before any code is written. Use when the user asks for an implementation plan, or asks to review or tighten an existing one.
disable-model-invocation: true
---

# Lean plan

A plan is cheap to change and code is not. This skill spends effort on the plan
so the build has less to do. It has two modes with one bar: **write** a plan
from a request, or **critique** a plan someone else wrote. Either way the output
is a plan or a review of one; change no files and write no code here.

The bar: every step produces an outcome someone can check, and no step survives
that the goal does not need.

## Pin the goal

Before drafting steps, write down four things:

- **Done means**: what is observably true when the work is finished.
- **Out of scope**: what a reader might expect but this work will not do.
- **Must not regress**: behavior, data, interfaces or performance that has to
  stay as it is.
- **The real constraint**: the one limit that shapes the plan, such as a
  deadline, a frozen interface, a migration window or a team boundary.

Read the code, docs and config that touch the goal before asking anything. Ask
only questions whose answer would change the plan's shape; a detail you can
choose sensibly, choose and record as an assumption. When an answer that
decides the shape is missing, stop there: return the questions and an outline
headed **Provisional, pending answers**, with each open question marked where
it would change a step.

## Shrink before you sequence

Look for a framing that deletes work before ordering it:

- Can an existing module, table, flag or endpoint carry the new behavior? Grow
  the code that already owns that idea rather than adding a layer, service
  or package for one feature.
- Does the plan need a migration, feature flag, compatibility shim or a second
  code path running beside the first? Each one has to be built, tested and later
  removed. Keep it only when the must-not-regress list or the real constraint
  requires it, and say which.
- Would a narrower done-state, agreed with the user, remove a whole phase?
  Offer it rather than assuming it.

Count the moving parts the plan adds: new files, modules, services,
dependencies, config keys, flags, migrations, background jobs and parallel
paths. A smaller count that still meets the done-state is the better plan.

## Write each step

Each step carries these slots:

- **Outcome**: a concrete state of the system, not an activity. "Orders API
  returns `shipped_at`" is an outcome; "work on the orders API" is not.
- **Owner**: the person, team, agent or module that holds it.
- **Check**: how anyone confirms the outcome, tied to that outcome.
- **Depends on**: earlier steps it needs, or "none".

Steps such as "handle edge cases", "refactor as needed", "clean up" or "add
tests" are defects: name the cases, the refactor or the behavior under test,
or delete the step. For each step ask what breaks if it is removed; if nothing
in the done-state does, remove it.

Watch for conditionals. Several steps that say "if X, also do Y" mean a
decision has not been made. Make that decision, or a short time-boxed spike
whose result is the decision, an explicit early step, then write the later
steps for the chosen branch only.

## Order and slice

- Put the riskiest unknown first, so a bad answer changes the plan while it is
  still cheap.
- Slice the work into pieces that can each merge on their own and leave the
  system working. A slice that only makes sense once the next one lands is half
  of a larger slice.
- Mark steps with no dependency between them as parallel.
- Make each cutover atomic. When it cannot be, name the intermediate state the
  system will sit in, how long it may stay there, and how to roll back from it.

## Verify against outcomes

Verification answers "is the done-state true and did nothing on the
must-not-regress list break?" Map each done-state item to the check that proves
it: a test of the behavior at its real boundary, a command, a query, a
measurement or a manual observation with its expected result. "Add tests" with
no named behavior is not verification. When a check needs a test, `hr-test-audit`
decides whether that test is worth writing.

## Plan layout

Lay the plan out as:

1. Goal: done means, out of scope, must not regress, real constraint.
2. Assumptions you made and open questions, if any.
3. The approach in two to four sentences, including what you chose not to
   build and why.
4. Steps, each with outcome, owner, check and dependencies.
5. Cutover and rollback, when the system passes through an intermediate state.
6. Moving-part count.

Use a table or diagram only when it changes how someone carries out the plan,
such as a dependency graph that shows which slices run in parallel. Prose and
lists cover the rest.

## Critiquing a plan

Read the plan against the sections above, then report three things in order:

1. **Blocks starting**: missing goal slots, undecided branches, steps with no
   checkable outcome or owner, and cutovers with no rollback.
2. **Would make it smaller**: steps, layers, flags, migrations or parallel paths
   that can go, each with the reason and the moving-part count before and after.
3. **Revised outline**: the plan rewritten in the layout above, short enough to
   compare with the original side by side.

Quote the plan's own wording when pointing at a defect. When the plan is
already lean, say so and list only what blocks starting.
