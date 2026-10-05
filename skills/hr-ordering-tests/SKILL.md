---
name: hr-ordering-tests
description: "Enumerate event orderings in ordinary unit tests. Use when a bug or change depends on the order of events between actors (tabs, workers, polling loops, storage writers, retries), or when code merges writes from more than one source. Not for pure functions of a single input."
---

# Ordering tests

A hand-written test covers an ordering someone thought of. This technique
generates every ordering of a small set of events up to a fixed length and runs
each one through the real code, so it also finds the orderings nobody listed.
That is a model checker's job, done in the project's own test runner against
the implementation instead of a separate model that can drift from it.

## Steps

1. **Name the invariants.** State what must hold after any sequence, such as
   "a completed record never reopens" or "the stored timestamp never goes
   back". Done when each one is a yes/no check on observable state.
2. **List the events.** Include each distinct write, message, restart or reset
   an actor can produce, with the variants that take different code paths:
   an older, equal and newer timestamp; a field left out; another identity
   (session, tenant, league); two events delivered in one batch. Aim for 6 to
   10 events, and merge variants that exercise the same path.
3. **Enumerate.** Walk every sequence up to length N depth-first. At each node,
   restore the state its prefix left, apply one event through the real entry
   point (listener, handler, reducer), then check every invariant. The cost is
   events^N applications. N of 3 or 4 is usually enough, since ordering bugs
   rarely need more than three events, and the test should finish within a
   few seconds under full-suite load.
4. **Report sequences.** Record each violation as the invariant plus the
   sequence, such as `a completed record reopened after A → B → C`, and
   assert the list is empty, so one run shows several failures.
5. **Prove it discriminates.** Break one guard an invariant depends on,
   confirm the test fails and names a sequence, then revert.
6. **Act on what it finds.** Pin each sequence the search finds as one named
   regression test next to the enumeration, its owning boundary, and fix it. When the bug is out
   of the change's scope, record it as a follow-up and exclude that invariant
   with the reason until the fix lands.

## Keeping it deterministic

Drive asynchronous boundaries with fake timers, barriers or a synchronous
flush; never sleep or use real time. Clone event payloads per application so
one sequence cannot leak state into the next. For sequences too long to
enumerate, a seeded random walk over the same events is the fallback; print
the seed with the failing sequence.

## Maintenance

When the code gains a new kind of event, add it to the list in the same
change. Reviewers check for this.
