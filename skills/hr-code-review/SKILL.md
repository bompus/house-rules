---
name: hr-code-review
description: Review a branch, PR, working-tree changes or changes since a revision for repository standards, spec conformance and what the change can break beyond its diff. Use only when the user requests a change review or asks what a change might break before merging. Do not use for simplification-only or strictest maintainability audits.
---

Two-axis review of the changes the user requested: working-tree changes, a committed branch, or changes since a named revision.

- **Standards**: does the code conform to this repo's documented coding standards?
- **Spec**: does the code implement the originating issue / spec?

Keep both axes distinct. Add an **Impact** section when the user asks what the
change might break, or when the diff changes something read outside its own
lines: a stored or serialized shape, output another process consumes, timing,
configuration, or reliance on pinned dependency behavior. Follow
[the change-impact method](references/impact.md) for it. Review small scopes locally; use separate read-only
subagents when the scope benefits from independent review and the host permits
it. Missing spec material limits the Spec assessment, not all useful review.

When a selected review uses an ACP stdio agent, read [the bundled client contract](references/acp-client.md) before launching it. Host orchestration and authorization still determine the route.

## Process

### 1. Pin the review scope

Use the scope stated by the user or established in the task:

- **Working-tree changes:** use `git diff HEAD` for tracked changes and `git ls-files --others --exclude-standard` to identify untracked files to inspect.
- **Committed branch comparison:** resolve the base and use `git diff <base>...HEAD`.
- **Since an exact commit or tag:** use `git diff <revision> HEAD`; include working-tree changes only when requested, using `git diff <revision>` and inspecting in-scope untracked files.
- **Merge-base comparison including local changes:** resolve `git merge-base <base> HEAD`, compare the working tree with that revision, and inspect in-scope untracked files.

Record the resolved base, comparison command, and whether staged, unstaged, and untracked files are included. Validate supplied refs before dispatching reviewers. Ask only when scope remains ambiguous. Report an empty scope only after checking every included category. Record the commit list when reviewing committed changes.

### 2. Identify the spec source

Look for the originating spec in this order:

1. A path the user passed as an argument.
2. The linked issue or pull request, or an approved plan or specification in the repository.
3. The user's request as recorded in the session.
4. If nothing is found, report "Spec conformance not assessed: no source found" and complete the review supported by available evidence. Ask for a source only when its absence prevents the judgment the user requested; continue independent review while awaiting it. Do not infer requirements from the implementation itself.

### 3. Identify the standards sources

Anything in the repo that documents how code should be written, such as `CODING_STANDARDS.md` or `CONTRIBUTING.md`.

When the diff adds or changes what an API returns (a handler, serializer, DTO,
response schema or webhook payload), load `hr-api-exposure-check` and give its
Two answers per field test to the Standards reviewer, or apply it in a local
review. If that skill is missing or excluded, report the limit on response-field
assessment and use the available project standards. Do not claim the skill was
applied or install it without authorization.

Use the design heuristics below when relevant to the changed code. They are prompts to investigate maintenance problems, not a checklist that must produce findings or automatic refactoring prescriptions.

- **The repo overrides.** A documented repo standard always wins; where it endorses something the baseline would flag, suppress the smell.
- **Always a judgement call.** Each smell is a labelled heuristic ("possible Feature Envy"), never a hard violation. Like any standard here, skip anything tooling already enforces.

Recommend a transformation only when inspected evidence shows a concrete current
maintenance problem and the remedy reduces it without weakening required behavior.
State the consequence and any equivalence assumptions; otherwise omit the finding.

- **Naming:** does ambiguity cause a concrete misunderstanding at a call site?
- **Duplication and repeated branches:** must these sites evolve together, or do they express independent policies? Extraction or polymorphism must earn its coupling and indirection.
- **Grouped data and domain primitives:** are invalid combinations or repeated invariant checks causing problems that a type would actually prevent?
- **Module boundaries and data access:** does current coupling force scattered edits, expose internals or mix unrelated responsibilities? Moving code must improve the boundary rather than merely rearrange it.
- **Delegation and inheritance:** does a wrapper or interface provide a useful contract, isolation or adaptation? One caller or implementation is not itself a defect.
- **Speculative flexibility:** does configuration or abstraction serve a current requirement? Remove unsupported complexity only after checking its consumers and behavior.

### 4. Review each axis

Use the same pinned scope for both axes, whether reviewing locally or delegating.
Read [the evidence-assessment method](references/evidence.md) and include it in
each delegated brief. It covers completion claims, weakened tests, emitted
results and verification limits.
When delegating and both sources are available, the reviews may run in parallel.
If a source arrives later or scope changes, update only the affected assessment.

**Hosts.** Both sub-agents are read-only. Use the current host's native agent mechanism and follow the repository's model-selection rules. A sub-agent never runs the model that wrote the code; when the author is its vendor's strongest model, use another vendor's model where one is available, through the host or that vendor's command-line agent run read-only with the same brief. When no other model is available, use a fresh context and say in the report that the reviewer shares the author's model.

**Correctness of input-to-output code** goes in the Spec brief, using the
evidence method above. Split a large scope into groups of about three files,
one reviewer per group. Do not assign this work to a reviewer focused on
structure or maintainability.

**Standards sub-agent prompt** should include:

- The full diff command and commit list.
- The applicable standards sources and relevant design heuristics, including their evidence requirement.
- The brief: "Report documented-standard violations with citations, and design findings only when inspected code shows a concrete current maintenance problem. For each finding give the location, consequence and proportionate remedy that preserves required behavior. Distinguish hard violations from heuristic judgments; repository standards override heuristics. Do not prescribe abstraction from a pattern alone. Skip tooling-enforced issues. Keep findings concise, with enough evidence to assess them."

**Spec sub-agent prompt** should include:

- The diff command and commit list.
- The path or fetched contents of the spec.
- The brief: "Report missing or partial requirements, behavior outside the requested scope, and incorrectly implemented requirements. Cite the requirement and code location for each finding. Keep findings concise, with enough evidence to assess their consequence. Where the spec is silent, what a reasonable user of this software would expect is still a requirement; grade it by its effect on that user. Before your verdict, list under `Declined to judge` every behavior you considered and set aside as out of scope, one line each with the reason, or write `none`."

Ground findings in inspected code and cite their locations and applicable
standards or requirements. Report concrete consequences; smells alone do not
justify a new abstraction. Mark missing evidence and unassessed requirements
explicitly rather than claiming a pass.

### 5. Aggregate

Present Standards and Spec separately. Verify delegated findings, remove
unsupported or duplicate claims, and prioritize within each axis. Preserve the
distinction between documented violations and heuristic suggestions.

Report Impact after the two axes: what the change relies on, its real risks and
what was ruled out, as the change-impact method describes. It never reranks
Standards or Spec findings.

Report a one-line summary: total findings per axis, and the worst issue _within each axis_ (if any). Don't pick a single winner across axes; the separation exists to prevent that reranking.

Tag each surviving finding HIGH (corroborated by a second source or a directly cited requirement), MEDIUM (single inspected source), or LOW (inferred; name the check that would confirm it). Nothing is dropped on confidence alone: the operator adjudicates.

Tag each finding with one actionability label, independent of the confidence tag:

- `blocking` must be fixed before merge.
- `important` should be fixed and may block, depending on context.
- `nit` is a minor style or preference issue.
- `suggestion` is an optional improvement worth considering.
- `learning` is an educational note that needs no action.
- `praise` marks good work; report it so review is not only defects.

Within each axis, order findings by actionability (`blocking` first, in the list order above), then by confidence (HIGH first).

Grade actionability by the finding's effect on users, not by whether the spec
mentions the trigger or by the implementer's stated rationale. Rule on each
line of the Spec reviewer's `Declined to judge` list: promote it to a finding
or confirm it out of scope, and show both in the report.

### 6. Remediation options

When a finding has more than one viable remedy, or the remedy you would
recommend differs from the ideal fix, present them as an offer in the house rules' § Offers format
for the user to choose from. Give each option a rough relative effort and its
tradeoffs, mark the recommendation, and separately name the right fix, meaning
the remedy that best serves the codebase absent current constraints. When the
recommendation is not the right fix, say why: scope, risk, blast radius or
existing debt. Skip this step for findings with a single obvious remedy; do not
produce an options list per nit.

When the user rejects, narrows or edits a finding or remedy, record the reason
in the task's plan or notes. Record why it was wrong or
unwanted, not merely that it was declined. For each accepted finding, record
the verifying command or one-line reason with it, so a later session can
re-check the fix without re-deriving the finding.

## Why two axes

A change can pass one axis and fail the other:

- Code that follows every standard but implements the wrong thing is a **Standards pass, Spec fail.**
- Code that does exactly what the issue asked but breaks the project's conventions is a **Spec pass, Standards fail.**

Reporting them separately stops one axis from masking the other.
