## Implementation economy

- Reuse first: existing code, the standard library and installed dependencies,
  and supported extension points over forks or rewrites. Before adding a
  script, timer, service, hook or skill, search the repository and what is
  already installed for one doing that job; extend or install that one instead.
- In React, avoid unnecessary effects. Derive values during render and handle
  user actions in event handlers. Prefer supported component or library callbacks
  when they satisfy the task. Reserve `useEffect` for necessary synchronization
  with external systems, including subscriptions and DOM APIs. Use
  `useLayoutEffect` only when that synchronization must finish before paint;
  custom hooks wrapping effects need the same justification. Explain why the
  effect is needed and preserve cleanup. Do not use effects to copy derived
  state or sequence application logic that belongs in handlers.
- Before adding a dependency, compare maintained alternatives, existing code and a small direct implementation against the requirements, counting maintenance, transitive dependencies and shipped size. Measure performance only when it could change the choice; otherwise call it unmeasured. Record why you chose.
- Pick the simplest solution that meets the requirements, with no speculative
  abstraction, never at the cost of security, validation or stated
  requirements. When proposing extra defensive machinery, describe the concrete
  failure, the evidence it can occur, and the maintenance cost. Omit speculative
  additions; ask for a decision only when the proposal expands the authorized
  scope.
- Before adding a check, catch or retry for an edge case that callers keep
  handling, see whether the interface can make that case valid and correct
  instead: deleting something already gone is a no-op, an out-of-range slice
  is clamped. Do this only where the new result is what every caller wants.
  It never covers swallowing a real failure: a failure the caller must act on
  stays loud, as the next item requires.
- Replace rather than wrap. When nothing outside the change depends on the
  old shape (no released interface, stored data or outside caller), update
  every caller and keep no compatibility path, shim or migration. Delete the
  code, files and docs the change left unused, and list them in the report.
  Keep no second algorithm, transport or scrape that quietly takes over when
  the first one breaks. It hides the breakage and leaves two paths to maintain.
  Ship and prove the primary, delete the old path in the same change, and fail
  loudly when it misses. Ordinary defaults and a second source the product
  needs on purpose are not fallbacks.
  When you cannot tell whether something still has a user, ask.
- When a change touches more than three places, or an analysis repeats across
  many files or records, write the script that does or proves it. Do
  the first unit by hand and confirm the script reproduces it. A second run of
  the script must change nothing and repeat no external action, such as a
  push or a sent message.
- Check current official documentation when behavior depends on a version, and
  stay compatible with the versions in use; no blind upgrades. Before landing,
  applying or installing an upgrade of a dependency, toolchain, app, provider
  or ACP agent, read the release notes and migration notes for every version in
  between (the upstream source when they are thin), apply their migration steps
  and config changes, and report: what affects this setup, fixes for bugs already hit, useful
  additions, changes the user must make, and new features, rules or options
  worth adopting or researching. Scale the report to the change: a patch bump
  with no behavior change can be one line.
- Write regression tests that would catch a real failure; skip tests that only
  mirror the implementation, redundant tests and release gates without a
  reason.
- The second time the same mistake or instruction comes up, encode it in
  structure before prose: a type, then a lint rule, then a test or check
  script, then a shared helper, then a runtime check. Write a rule only when
  none of these would fail or block the mistake if it happened again.
