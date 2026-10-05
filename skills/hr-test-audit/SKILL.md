---
name: hr-test-audit
description: Gate new or changed tests on the value they add, and sweep an existing suite for low-value, implementation-coupled or duplicate tests to delete. Use when adding or reviewing tests, or when asked to prune, audit or clean up a test suite.
---

# Test audit

Two modes share one value bar: a test earns its upkeep by protecting observable
behavior, a credible regression, or an independent contract. **Authoring mode**
gates each new or changed test before it lands. **Audit mode** finds existing
tests that fail the bar and removes them in small, evidenced batches. For the
red-green loop itself, use a TDD skill where one is installed; this skill decides which tests are worth
keeping.

## Authoring gate

Before adding a test, answer all four. A missing answer means don't add it yet.

1. What observable behavior, invariant or contract does it protect?
2. What credible regression makes it fail? Name the production change that
   turns it red: a wrong constant or argument, a wrong branch, a missing side
   effect, an empty or default return, or a missing check for empty, nil,
   unauthorized or malformed input. If none would, it is a change detector or
   cannot fail.
3. Why doesn't existing coverage already catch that? Each contract has one
   owning test at its strongest boundary. Another layer needs its own risk the
   owner cannot reach. Prefer a new case in an existing table or fixture over a
   near-duplicate test.
4. Does it need a production seam (export, flag, wrapper, injection hook) that
   no production caller uses? Then test at the real boundary instead.

When a unit must be tested in isolation, write down the ways it can fail before
writing the code, and test those failures. A test written after the code tends
to restate the code.

A bug regression test must fail on the pre-fix code for the intended reason,
then pass after the fix. One that never demonstrably failed proves the mock, not
the fix. One regression at the owning boundary covers the bug; don't replay it
at every layer it crosses. For a sequence `hr-ordering-tests` found, that
regression is the named test beside its enumeration.

Changing an existing test so it checks less counts as removing it: deleting or
skipping it, loosening an assertion, or rewriting an expected value to match new
output. It needs the audit-mode evidence from step 2, not only these answers.
To catch these moves in a diff, run
`bun <this skill's directory>/scripts/floor-guard.ts [--base <ref>]` from
the repository. It reports new suppression comments, added skips or
`.only`, deleted test files and assertions removed from surviving tests, and
exits 0 clean, 1 with findings, 2 when it could not run. Each finding still
needs a reason; a 2 is never a pass.

For retry and concurrency failures, exercise the implementation at the boundary
where order matters. Cover the credible lost-response, interrupted-write or
restart sequence with controlled barriers and assert durable state or externally
visible behavior. Do not replace that coverage with a separate model of the code.
Code that merges events from more than one actor also needs an enumeration test
from `hr-ordering-tests`, and a change that adds a kind of event adds it to that
test's event list.

When behavior depends on three or more independent settings, cover every pair
of their values rather than every combination: list each setting's value
classes and edge values, drop combinations the code rejects, and build the
smallest table where each pair appears at least once (Microsoft PICT generates
one). Most interaction bugs need only two settings to line up. Add an explicit
case for each combination of three or more settings already known to interact,
such as one behind a past bug or a documented constraint.

Then check the test against the junk patterns below. A match fails the gate
unless the retention bar names the contract it independently guards.

## Junk patterns

Authoring rejects new tests that match; audits hunt for existing ones that do.

- no assertion, or an assertion that cannot fail
- expected values produced by the code under test, or copied from it
  (fixtures, inventories, export lists, snapshots taken from current output)
- exact source, import or string greps standing in for behavior
- private helpers or call shapes tested again where a real boundary already
  covers them
- the same contract asserted several times, or one shared helper re-tested in
  every caller
- tests that exist only to keep test-only exports, globals or wrappers alive,
  and production code whose only callers are tests
- mocks that implement the asserted behavior, or one mock standing in for
  different APIs
- negative tests that pass for an unrelated reason (a different guard rejects
  the input, or the production path never reaches the check)
- names or fixtures that promise more than the test exercises
- tests that break under a behavior-preserving refactor

## Retention bar

Keep a test that independently enforces a public API, protocol, config,
migration, storage, security, platform, default or release contract. Also keep
call-order tests when order is observable, regressions with a credible failure
mode, and a source check when it is the cheapest guard that fails on a
user-facing change and survives a rename. Slow or static is not a reason to
delete. A kept test that fails on the unchanged baseline may be a real bug:
reproduce and fix it rather than deleting the test.

## Audit mode

1. **Discover, read-only.** Read the repository's testing guidance first. For a
   large suite, split discovery by area and run the slices in parallel if the
   host allows. Prefer a few high-confidence candidates over a long speculative
   list. Before judging one, read the whole test, the production code it covers,
   that code's callers, and any overlapping tests.
2. **Record evidence per candidate** before editing: test name and location;
   the failure it can actually detect; non-test callers of what it covers; the
   stronger test that remains, or why none is needed; why it exists (history);
   what production or test-support code its removal frees; the focused
   validation command. A missing field means the candidate is not ready.
3. **Edit one coherent batch.** Remove the tests along with the test-only
   exports, wrappers and dead paths they kept alive; don't leave aliases. Move a
   retained regression to its owning boundary. Don't add replacement tests that
   restate the implementation, and don't count uncertain deletions as progress.
4. **Validate.** Run the owning and sibling tests, then the repository's
   required checks. Where a removed test grepped source or a plan, run the
   script or dry run that owns the real contract instead.
5. **Report**: categories removed, kept false positives and why, checks run,
   and production versus test lines changed (`git diff --numstat`). Land one
   batch at a time through the repository's normal flow, then rerun discovery on
   the updated base for the next batch.

## Sources

Original synthesis, adapting:

- OpenClaw's
  [`test-audit`](https://github.com/openclaw/openclaw/blob/65f1e4d2279eecd6e40d55d82027d5c97b4b272b/.agents/skills/test-audit/SKILL.md):
  the authoring gate, junk patterns, retention bar and evidence fields.
- [Ansh Nanda via Ray Fernando](https://x.com/RayFernando1337/status/2102927565778522610):
  the failure-list-first rule. Their "E2E tests only" rule is not adopted.
- no_human's [tamper guard](https://github.com/no-human-ai/no_human): weakening
  a test counts as removing it.
- addyosmani/agent-skills'
  [floor guard](https://github.com/addyosmani/agent-skills/blob/main/skills/constraint-driven-development/references/floor-guard.md)
  (MIT): the diff checker.
- obra/superpowers `writing-good-tests.md`: the mutation check behind
  authoring-gate question 2.
- omkamal's [pypict skill](https://github.com/omkamal/pypict-claude-skill):
  pairwise coverage.

For recorded proof that a UI change works, see michaelshimeles'
[`evidence-driven-testing`](https://github.com/michaelshimeles/skills/tree/main/evidence-driven-testing).
