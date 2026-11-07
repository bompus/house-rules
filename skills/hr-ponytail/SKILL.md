---
name: hr-ponytail
description: "Prefer the simplest adequate implementation: reuse, standard library and platform features before custom complexity. Use for coding tasks or explicit requests to apply Ponytail, YAGNI or reduce over-engineering; do not extend the coding workflow to unrelated tasks."
argument-hint: "[lite|full|ultra|off]"
license: MIT
metadata:
  upstream: https://github.com/DietrichGebert/ponytail
  upstream_ref: 6f1c2bfff0c837d268929a7c4e490918eb4fab29
  upstream_path: skills/ponytail/SKILL.md
  house_rules_patches: "Portable provenance; hr- skill names"
---

# Ponytail

Choose the least complexity that meets the requested behavior while preserving
clarity, correctness and maintainability. Fewer lines or files are useful only
when they improve that outcome.

## Scope and intensity

Apply to coding work at **full** by default. Retain the user's chosen
`/hr-ponytail lite|full|ultra` intensity for later coding work in this session,
without carrying coding procedures into unrelated tasks. "stop ponytail" or
"normal mode" turns it off.

| Level     | Behavior                                                                                                                        |
| --------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **lite**  | Build what's asked; mention a simpler alternative when useful. Ask only when a meaningful unresolved decision affects the work. |
| **full**  | Prefer reuse, stdlib and native capabilities; minimize unnecessary complexity. Default.                                         |
| **ultra** | Scrutinize each added layer and speculative feature; require a concrete reason while still fulfilling explicit requirements.    |

## Choose the implementation

Prefer an existing adequate solution before introducing custom machinery:

1. Omit speculative additions; fulfill explicit requirements.
2. Reuse suitable helpers, types and patterns already in the codebase.
3. Prefer standard library and platform capabilities when they meet the need.
4. Use an installed dependency when it fits. Add a dependency only when its benefit justifies its cost and scope permits it.
5. Write custom code when needed, choosing the smallest clear implementation that satisfies the requirements and relevant edge cases.

Read enough of the relevant implementation to explain the change and its
consequences. Inspect affected callers and trace across boundaries when shared
behavior, contract changes or uncertain impact warrant it. Expand the search
when evidence reveals uncertainty; exhaustive caller searches or full-file
reads are not prerequisites for every edit. Follow the project's discovery tools.

For bugs, fix the supported cause at the appropriate boundary. Check related
callers when the cause is shared; do not patch only one symptom or assume that
moving a guard into a shared function is always correct.

Avoid boilerplate and abstractions for hypothetical needs. A single implementation
can justify a boundary when it serves a concrete current requirement. Prefer
focused changes at the right boundary over minimizing file or line count.

For a requested cache, choose an existing mechanism if it meets the required
freshness, bounds, concurrency and failure behavior. Ultra intensity removes
unneeded layers; it does not make profiling a prerequisite for an explicitly
requested cache. Ask when an unresolved cache requirement affects correctness.

Document material limits of deliberate simplifications when maintainers need
them, using the project's comment conventions. Avoid speculative upgrade plans.

## Verify without weakening safeguards

Preserve input validation at trust boundaries, error handling that prevents data
loss, security, accessibility and explicitly requested behavior. Simplicity does
not override these requirements.

For UI changes, handle applicable loading, empty, error and success states,
and verify the affected flow at relevant viewport sizes using the project's
supported tools. Report any states or sizes that could not be checked.

Choose verification by changed behavior and risk, following project standards.
A one-line authorization or money change can need substantial testing; a spelling
correction usually needs only a focused check. Use meaningful regression evidence
for non-trivial behavior, and avoid tests that merely mirror implementation.
Run required checks and report any verification limits. Repeat or broaden checks
only when new edits, failures or unresolved concerns justify it.

Ponytail governs implementation choices, not response format. Project safeguards,
explicit requirements and authorized completion boundaries still apply.
