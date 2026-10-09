---
name: hr-maintainability-review
description: "Review a diff or an entire codebase for maintainability and structure, preserving behavior. Use when explicitly requested for a strict, deep, harsh or thermo-nuclear maintainability review, or a whole-repository over-engineering or bloat audit. Report-only; correctness, UI quality, test coverage and measured performance need separate assessments."
disable-model-invocation: true
---

# Maintainability review

A demanding read of the requested code, asking a single question: is this
the simplest shape the code could take while doing exactly what it does now?
Correctness is out of scope. For a routine review against repository
standards, use `hr-code-review`; for hunting a bug, use `hr-diagnosing-bugs`. This
review changes no code; it reports findings and a verdict.

## Choose the scope

Use the user's requested scope: a diff, a subsystem or the entire repository.
Record the revision and whether working-tree and untracked files are included.
For a whole-codebase review, recent changes may inform priority but never narrow
coverage to touched files. If the request names no scope, use the current
branch's changes against the repository's default branch.

### Diff review

1. Find the branch's base with the repository's default branch, not a guessed
   name, and read the full diff against it.
2. Read every touched file whole, not only the hunks. Structure problems sit in
   how new lines fit the old ones.
3. For each new function, type, flag or module, read its callers and look for
   an existing helper, module or pattern that already does the job.
4. Note each file's length before and after the change.

Done when you can explain, for every touched file, what it owned before the
change and what it owns now.

### Whole-repository or subsystem review

1. Inventory the in-scope packages, modules, entry points and shared code.
   Record generated and vendor code, exclusions and inaccessible areas.
2. Review each area and trace its consumers and cross-module boundaries.
   Read candidate files whole; inspect callers, tests and configuration before
   declaring a layer, branch or helper unnecessary. Search dynamic and string
   references too when proposing deletion.
3. Record each area's assessment, supporting files and remaining gaps. Mark
   an area assessed only after inspecting its implementation and relevant
   consumers; inventory or file counts alone do not establish coverage.

Done when every inventoried area has an assessment or an explicit unreviewed
disposition. Report gaps rather than claiming a complete audit from a sample.

## What to challenge

- **Special cases in shared flows.** An `if` for one caller, one tenant or one
  feature inside a path everyone uses. Ask whether the case belongs at the
  caller, in data, or in a separate path.
- **Files past what a reader can hold.** When a file grows large enough that
  nobody can keep its whole shape in mind, ask whether it should be split
  before this change lands, and where the seam is.
- **Pass-through layers.** Wrappers, adapters and services that forward calls
  with renamed arguments. Indirection must buy clarity, isolation or a real
  second implementation. Test a suspect module by imagining it deleted: if its
  complexity would spread into every caller, it is earning its keep; propose
  removal only when callers could use the underlying behavior directly without
  duplicating or redistributing that complexity.
- **Generic machinery over a simple shape.** Registries, plugin systems,
  builders or configurable pipelines where the data is a fixed list or a plain
  record.
- **Loose types hiding an invariant.** Casts, `any`, broad unions and optional
  fields that cover a rule nobody wrote down. Often the fix is two types, or a
  required field set at construction.
- **Logic in the wrong home.** Code that reaches into another module's
  internals, belongs beside the data it reads, or repeats a helper that already
  exists.
- **Forced ordering.** Independent steps chained one after another, so a slow
  or failing step blocks unrelated ones.
- **Half-applied updates.** A multi-step write that leaves state inconsistent
  if it stops partway. Look for a single transaction, a write-then-swap, or a
  shape where partial state cannot exist.
- **Modes and flags.** A boolean parameter or mode switch that splits one
  function into two behaviors sharing a name.
- **Leftover scaffolding.** Stubs and placeholders still on a live path, fixed
  sample data where real data should flow, functions that report success
  without doing their work, handlers that silently do nothing, "temporary"
  branches that shipped, and comments describing a refactor long finished.
  Propose deleting what no consumer needs. When a consumer depends on one, the
  real behavior is missing: report it under **Other assessments** as a
  correctness concern, without guessing at the contract the code never showed.

## Look for code that disappears

The most valuable finding removes moving parts outright: a branch, mode,
layer or helper that stops being needed once the change is framed differently
or leans on what the architecture already provides. Examples of the move:

- the new flag goes away if the caller passes the value it already has;
- the special case goes away if the shared type carries the field;
- the wrapper goes away if callers use the underlying API directly;
- the retry layer goes away if the operation is made idempotent.

Aim past a tidier copy of the same design. When a different framing would
make a whole branch, mode or layer unnecessary, argue for that framing
rather than for local cleanup.

Propose such a restructure only when you can name the files, the parts that
go, and what replaces them. A vague "this could be simpler" is not a finding.
Moving code between files without removing anything is weaker than deleting
it; renaming is not a remedy for a structural problem.

## Filter

Keep a finding only when all of these hold:

- you can describe the restructure concretely;
- behavior stays the same after it, including errors and edge cases;
- it removes complexity a future maintainer would pay for.

Order findings by structural impact, largest first. Prefer three solid
findings to ten guesses. Drop cosmetic notes (naming, formatting, comment
wording) whenever any structural finding exists. If the change has no
structural problem, say so in one sentence; do not invent one to fill the
report.

## Write each finding

For each finding, give in order:

1. **Where**: file and line range, or the functions involved.
2. **Problem**: what makes this shape costly to read or change, in one or two
   sentences.
3. **Restructure**: the concrete change, with a short sketch when prose is
   ambiguous.
4. **What goes away**: the branches, types, files or lines removed.
5. **Behavior check**: why behavior is unchanged, and which tests would show
   it.

## Verdict

Include the scope and coverage limits with the verdict. Whole-repository and
subsystem reviews use **Priority fixes**, **Optional** and **Overall**: rank current
maintenance costs and state what was assessed, rather than judging whether
existing code is ready to merge. For a diff, use these three parts:

- **Before merge**: findings whose shape will be expensive to undo once other
  code depends on it, each with its restructure.
- **Optional**: improvements worth doing now or later, each with its
  restructure.
- **Overall**: one line stating whether the structure is ready to merge.

If nothing must change, the "Before merge" list says "none".

For diff reviews, working behavior alone does not make the structure ready. Each of these
goes under "Before merge" unless the author gives a clear reason to keep it:

- a visible restructure that would delete much of the change's incidental
  complexity, left untaken;
- new special-case branches that tangle a shared flow;
- feature checks spread across shared code to solve a local problem;
- a new wrapper, cast or loosely typed contract that adds indirection
  without paying for it;
- a near-copy of an existing helper, or logic placed outside the module
  that owns the concept.

## Other assessments

For a request combining several kinds of review, account for each separately:

- **Correctness:** `hr-code-review` assesses a diff against requirements;
  `hr-diagnosing-bugs` investigates a concrete suspected failure. Neither a
  structural verdict nor a diff review establishes whole-codebase correctness.
- **UI:** use the available `hr-better-*` skills for the requested layout,
  typography, colors, accessibility or interface copy; `hr-stock-ui-audit`
  targets template-default styling.
- **Tests:** `hr-test-audit` assesses test value and duplication. Record test
  execution and coverage separately; do not infer coverage from test count.
- **Performance:** `hr-benchmarking` measures an authorized workload; inspect
  build artifacts when bundle size is requested. Label unmeasured claims.
- **Agent guidance:** `hr-agent-guidance-audit` checks rules, skills and their
  references for duplication, contradictions and stale instructions.

Use these workflows only for the requested dimensions and within their
invocation policies. Report unavailable or unassessed dimensions explicitly.

## Tone

Direct and serious. Name the problem plainly and explain the cost. Never mock
the author, and never soften a required change into a suggestion.
