# Assess review evidence

Apply this method to the pinned review scope, locally or in a read-only review.
The repository owns required checks, gates and waivers; this method adds no
permission to run commands, edit files or expand the review scope.

## Read the scope and its evidence

Start from the requested intent, diff, changed paths and verification evidence.
Use an existing review packet when supplied; do not require a particular
artifact path or release workflow. Read applicable repository guidance not
already in context. Report missing scope or required evidence.

Inspect changed regions first. When a supplied diff or shell is unavailable,
locate those regions with available read-only search and file tools. Trace
source, tests and consumers where needed to assess a concrete risk. Respect
scope limits; name dependencies needing assessment outside them rather than
asserting they are safe.

Check behavior against requirements, invariants and testing standards. Treat a
completion claim as a hypothesis to refute from the diff and evidence. For a
bug fix, look for evidence that its regression test failed on the pre-fix code
for the intended reason and passed after the fix. Missing evidence is a
verification limit; whether it blocks follows the project's gate rules.

## Account for weakened tests

Before judging the change, list each existing test the diff deletes, skips,
marks as expected to fail or weakens. Include narrowed assertions, widened
tolerances and expected values rewritten to match new output. Require a stated
reason tied to the changed requirement or supported test-audit evidence.
An unexplained change is missing verification; classify it under the project's
verification requirements rather than accepting the new output as its reason.

When test auditing is in scope, use the installed `hr-test-audit` bundle's
method and floor guard if available and command execution is authorized.
The guard detects some weakening patterns; a clean result does not replace
reading changed assertions. Report unavailable coverage without installing or
running tools outside the selected scope.

## Trace emitted results

For input-to-output code such as resolvers, parsers or extractors, trace every
path in scope to its emitted result before reporting performance or structure
findings. Start from the nearest test fixture and construct the smallest input
change that would emit a wrong result or drop a correct one. Report a confirmed
counterexample with the fixture, changed input, expected and emitted results,
and `path:line` for the steps. When no counterexample is found, record the paths
and cases assessed; do not invent a failing result to fill the report.

## Ground the result

Do not repeat verified lint, type or format checks or invent release gates.
Confirm each finding with its file and line, violated requirement and evidence.
Distinguish confirmed defects from unresolved questions and omit speculative
findings. Report missing evidence and unassessed requirements separately.
A review pass does not establish that unrun checks passed.
