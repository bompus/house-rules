---
name: hr-writing-pr
description: Write or revise pull request titles and bodies from the final diff, with concrete behavior and relevant proof. Use when preparing a PR or improving its description.
---

# Writing pull requests

Give a reviewer who has not seen the conversation enough context to understand the change and assess its evidence. Follow the target repository's PR template and contribution rules. This skill governs writing; existing rules govern commits, publication, and review gates.

## Fix scope

For fixes intended for pull requests in any repository, try the simplest
adequate change first. Keep the diff focused and easy to review, with the fewest
changed lines and files that solve the problem while preserving correctness,
readability and required tests. Leave unrelated refactors and speculative
abstractions out. When performance requires a larger change, show measurements
explaining why the simpler approach is insufficient and what the added
complexity achieves.

## Material changes to an existing PR

When an existing PR needs major or material changes, replace it with a new
PR in any repository. Compare the proposed revision with the published PR.
A revision is major or material if it changes the scope, fix approach or
promised behavior.
Corrections within that scope and approach that preserve the promised behavior
are routine. Carry forward relevant evidence and unresolved review findings,
and link the old and new PRs both ways. Publish and verify the replacement
before closing the old PR as superseded. Recheck its final diff and required
checks; prior PR review approvals and CI results do not cover the new submission.
Routine corrections that leave the PR materially unchanged stay in place.

## Read before writing

Before creating a PR, apply the submission search in your loaded agent guidance's "Repository work" section.
If that section is unavailable, locate the local house-rules checkout and read
`rules/core.md` there. Report an unavailable local source before submitting.

Inspect the actual diff against the intended target branch, the linked issue or request, and available validation results. For an existing PR, confirm its current base and head. Commit messages can provide context; the final diff determines what the PR claims.

Resolve mismatches between the description and the implementation before calling the description complete. If evidence is unavailable, state the specific gap rather than inventing a result.

## Title and body

Write a title naming the resulting behavior or fixed failure. Use the repository's title convention when it has one. Check the title's type and scope against the diff's dominant change, not the author's intent: a `docs:` title on a diff that adds an executable installer misfiles the record the squash message becomes. When no PR template exists, the title convention is the only template; default to Conventional Commits `type(scope):` unless the repository's recent history uses another style. Flag a mixed diff as a possible split into separate PRs (the `hr-split-to-prs` skill, where installed) instead of stretching the title to cover it.

Lead the body with the concrete problem and resulting behavior. A small change may need only a paragraph and a validation sentence. Expand only where the reviewer needs more context:

- **Bug fix:** trigger, previous behavior, corrected behavior, and regression proof.
- **Feature:** observable capability, a small usage example, and supported limits.
- **Refactor:** motivation, the structural change, and evidence that required behavior is preserved.

Explain implementation details only when they clarify a decision or help assess correctness. Include compatibility, dependency, migration, or documentation implications when the diff creates them. When the change has a hard-to-reverse surface (host-level effects such as `sudo install-deps`, migrations, destructive actions), say so in one sentence; never a fixed risk section, and nothing on purely additive changes. Identify a useful review starting point for a complex change, using `path:line` anchors for load-bearing claims.

Describe the final combined change. Leave out intermediate attempts, commit reshuffling, conversational history, and file inventories already visible in the diff. Write for the reviewer in plain language: no unexplained jargon, and no narrative about how the change was produced. Review panels, models consulted, harnesses, and agent process never appear in titles, bodies, or PR comments; that detail lives in plan files and session records. For routine clarifications, update the title and body. Material scope changes follow the replacement rule above.

## Evidence that earns its space

Report relevant checks and their actual outcomes, including material failures and unverified behavior. Name the tests or commands run and their scope; a suite-wide pass count alone is not evidence for the changed behavior. When generated files dominate the diff, give the authored line count alongside the headline number so the size does not mislead review. Distinguish newly introduced failures from established baseline failures only when a comparison supports that claim. Keep detailed logs in a linked artifact when the short result is sufficient.

Use a small code example when it makes behavior concrete. For visual changes, use comparable before/after images when available. When the change replaces an existing procedure, state the prior and new procedure in one line each. For measured performance claims, identify the baseline and candidate, measurement conditions, and variability.

For reproduction examples, apply the direct-command and material-condition
guidance in the installed `hr-diagnosing-bugs` skill's `references/reporting.md`.
When that skill is unavailable, show commands that reproduce the symptom and
omit incidental scheduling, resource-control and observer wrappers. Keep exact
executed commands and material conditions in the measurement record. Disclose
material conditions beside performance results. Retain any control required to
reproduce the defect and explain its purpose.

When the existing shape is familiar, use a focused diff of calls, components
or files to show the change. Use a diagram when it explains relationships more
clearly than prose. Show the whole relevant block when omitted context would
hide ownership, order or a guard. Keep verification and uncertainty beside
the view; brevity does not remove required evidence.

Scale structure to the change. Omit empty optional sections, placeholder text, guessed risk scores or review times, and coverage percentages that were not measured. Complete a required checklist with this PR's specifics rather than omitting it, and mark non-applicable items N/A with a reason. Preserve required template sections and mark unavailable evidence honestly.

## Completion check

Every factual claim must be supported by inspected code, the originating request, or observed results. The opening explains what changes and why; the remaining text helps review it. Deliver the title and body in the form requested. Apply them to a remote PR only within the user's authorized scope. When the user's rules turn attribution off (the `no-attribution` modifier, for example), include no `Made with` or other host attribution, and after `gh pr create` or `gh pr edit`, reread the published body and strip any footer a harness appended.

Relevant validation stays in the description; extensive templates and review automation are outside this skill.
