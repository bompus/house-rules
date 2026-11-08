---
name: hr-ponytail-review
description: "Review a diff for unnecessary complexity and behavior-preserving simplifications. Use only for over-engineering or simplify reviews (/hr-ponytail-review). Not for standards or spec conformance (hr-code-review) or a whole-codebase audit."
license: MIT
metadata:
  upstream: https://github.com/DietrichGebert/ponytail
  upstream_ref: 2961b52fc1fe6a5a87c7a959a79512e5c2f3ffe5
  upstream_path: skills/ponytail-review/SKILL.md
  house_rules_patches: "Portable provenance; hr- skill names"
---

# Ponytail review

Review the requested diff for concrete opportunities to reduce complexity and
maintenance burden. Keep the review read-only. Fewer lines are not a goal when
they hide intent, weaken safeguards or change required behavior.

## Evaluate a candidate

Inspect relevant consumers and requirements before proposing a deletion or
replacement. Before proposing a deletion, search the whole tree for the symbol,
including tests, fixtures and string or dynamic references. Explain the current maintenance cost, how the remedy reduces it,
and which behavior must remain equivalent. If equivalence is uncertain, identify
the needed evidence and keep the suggestion conditional rather than declaring
the code removable.

Evaluate documented simplifications against current requirements and expected
load. A stated limit alone is not a complexity finding; explain which current
requirement or workload exceeds it before proposing a replacement. Required
safeguards still apply.

- Reuse stdlib or platform functionality when its semantics cover the requirements.
- Reuse an equivalent helper, util or pattern that already lives in this repository instead of keeping a duplicate; name its path.
- Remove dead code or speculative flexibility when consumers and current contracts do not need it.
- Simplify indirection when it serves no current boundary, isolation or adaptation need. One caller or implementation is not itself evidence of waste.
- Retain validation, retries, tests and other safeguards that serve required behavior. Idempotence alone does not make retries unnecessary.
- Prefer clear control flow over compressed expressions. Do not add abstractions merely to remove textual duplication.

Examples of evidence-based findings:

- A date-formatting dependency is used only for one display format; consider `Intl.DateTimeFormat` after checking required locales, time zones and output compatibility.
- A retry wrapper calls an in-memory lookup that cannot encounter the transient errors the wrapper handles; remove it if all inspected callers share that behavior.
- A new `slugify` helper duplicates `src/lib/slug.ts`; import the existing one after checking that both handle the same inputs.
- A forwarding wrapper has no policy, instrumentation, contract or isolation role in the reviewed scope; inline it when doing so reduces navigation without exposing unwanted coupling.

## Findings

Number findings across the report so the user can select them by number.
For each finding, give the location, concrete maintenance consequence, proposed
simplification and relevant equivalence evidence or limits. Keep it concise;
use more than one line when needed to make the recommendation assessable.
Optional tags: `delete`, `stdlib`, `native`, `reuse`, `yagni`, `simplify`.

Prioritize by reduced complexity, maintenance benefit and confidence. Report
estimated line savings only when useful, never as a mandatory score or success
criterion. Do not manufacture findings to achieve a reduction.

When a finding's remedy is a real choice, such as several viable simplifications
or a pragmatic fix that falls short of the ideal, present coded options (shared option-offer format) with
rough relative effort, mark the recommendation, and name the right fix when it
differs, with the reason. Skip options when the remedy is singular.

When there are no actionable findings, say so for the reviewed scope. A clean
complexity review does not establish correctness or authorize shipping.

## Boundaries

This is not a full correctness, security or performance audit. Nevertheless,
every proposed simplification must preserve required behavior and safeguards.
Report an incidental concern separately for the appropriate review rather than
ignoring a reason your own recommendation would be unsafe. Follow project
review gates and output contracts without expanding the review scope.
