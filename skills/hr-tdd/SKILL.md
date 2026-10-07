---
name: hr-tdd
description: Test-driven development (red-green; refactoring is deferred to review). Use when the user wants to build features or fix bugs test-first or mentions TDD or "red-green-refactor".
---

# Test-driven development

TDD is the red-green loop. This skill is the reference that makes that loop produce tests worth keeping: what a good test is, where tests go, the anti-patterns, and the rules of the loop. Every section applies on every cycle: consult them before and during the loop, not after.

When exploring the codebase, read `CONTEXT.md` (if it exists) so test names and interface vocabulary match the project's domain language, and respect ADRs in the area you're touching.

## What a good test is

Tests verify behavior through public interfaces, not implementation details. Code can change entirely; tests shouldn't. A good test reads like a specification: "user can checkout with valid cart" tells you exactly what capability exists, and it survives refactors because it doesn't care about internal structure.

See [tests.md](tests.md) for examples and [mocking.md](mocking.md) for mocking guidelines.

## Seams: where tests go

A **seam** is the public boundary you test at: the interface where you observe behavior without reaching inside. Tests live at seams, never against internals.

Use the existing or already approved public boundary. Ask only when choosing a different boundary materially changes scope. Focus testing effort on the critical paths and complex logic.

When boundary limits affect a coverage decision, give each proposed boundary a one-line note on what it catches and misses.

When the interface is itself in question, follow the repository's design guidance before choosing a different boundary.

## Anti-patterns

- **The repository's bar.** Apply its documented testing standards. Litmus: would `return input` / `return stub` still pass?
- **Implementation-coupled**: mocks internal collaborators, tests private methods, or inspects private state rather than observable behavior. Database assertions are appropriate when persisted state is part of the public contract. The tell: the test breaks when you refactor but behavior hasn't changed.
- **Tautological**: the assertion recomputes the expected value the way the code does (`expect(add(a, b)).toBe(a + b)`, a snapshot derived by hand the same way, a constant asserted equal to itself), so it passes by construction and can never disagree with the code. Expected values must come from an independent source of truth: a known-good literal, a worked example, the spec.
- **Horizontal slicing**: writing all tests first, then all implementation. Bulk tests verify _imagined_ behavior: you test the _shape_ of things rather than user-facing behavior, the tests go insensitive to real changes, and you commit to test structure before understanding the implementation. Work in **vertical slices** instead: write one test, then one implementation, and repeat, each test a **tracer bullet** that responds to what the last cycle taught you.

## Rules of the loop

- **Red before green.** Write the failing test first, then only enough code to pass it. Don't anticipate future tests or add speculative features.
- **One slice at a time.** One seam, one test, one minimal implementation per cycle.
- **Refactoring is not part of the loop.** Do behavior-preserving simplification in the repository's review stage, after the red-green implementation cycles.
- **Keep only tests that earn it.** Before a test lands, apply the repository's testing standards and the `hr-test-audit` authoring gate when that skill is available.
