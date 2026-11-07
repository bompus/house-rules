---
name: hr-multi-model-panel
description: "Get independent opinions on one question from models of different families, check their citations and adjudicate. Use for a consensus or contrarian read, to verify a diagnosis against primary evidence, or to measure whether rule or prompt wording makes each model act as intended. Change reviews belong to hr-code-review."
---

# Multi-model panel

The pattern: models from different families, one identical brief, detached
runs, a deterministic check of every citation, and a person or the caller
adjudicating what remains. Several runs of one model repeat its blind spots;
the different families are what make a panel worth its cost.

This skill covers panels on a question that is not a change review. A review of
a diff, branch or pull request uses `hr-code-review`, which also owns the panel
machinery this skill reuses:

- seats, efforts and limits: `hr-code-review`'s panel setup and panel plan
  references (`scripts/panel-plan.mjs` resolves the seats without calling a
  model);
- running a seat over ACP read-only: its ACP client reference
  (`scripts/acp-panel-client.mjs`);
- combining replies, the citation gate and the receipt header:
  its panel adjudication reference (`scripts/check-receipts.mjs`).

## When a panel earns its cost

- **Consensus or contrarian read** on a decision with real options, where one
  model's framing could carry the answer. Give every seat the same options and
  evidence; ask one seat to argue against the leading option when the others
  agree too quickly.
- **Diagnosis verification**: give the seats the symptom, the hypothesis and
  the primary evidence (logs, a reproduction, the code at a named revision), and
  ask each to confirm or break the hypothesis with citations.
- **Rule or prompt compliance**: see Behavior checks below.

Skip a panel when a test, a reproduction or one more read of the source would
settle the question. A panel judges what it is asked; it never replaces that
evidence.

## Seats

- Exclude the family of the model that wrote what the panel judges, and the
  family of the session running the panel when the question is its own
  reasoning.
- Two models from one vendor count as one family. Do not add a second model of
  a family to raise the count.
- Brief every seat fresh, never as a fork of the conversation: a fork inherits
  the author's reasoning.
- Name a seat that could not run (no route, quota or authentication failure)
  in the report instead of silently dropping it.

## Brief

Each seat gets the same brief: the question, the options if any, the evidence
with paths and revisions, the judging lens, and the reply format (a verdict
line plus findings that each cite `path:line` or a quoted source). Name the
lens: a skill's rules, a specification, or stated acceptance criteria. A panel
without a lens returns opinions, not verdicts.

## Behavior checks

A behavior check measures whether rule or prompt wording makes each model act
as intended. It is a grid, not a panel: one reply per seat and cell, no roles,
graded by code instead of adjudicated.

1. Write one prompt file per case and arm (for example the current wording, the
   proposed wording and no wording): the text under test, a short transcript,
   and an instruction to answer with text only and write
   `TOOL_CALL: <tool> <what>` where the agent would call a tool.
2. Write the grader before the first run: one pass or fail per reply from
   regular expressions or parsing, never a model's judgment.
3. Run the seats you expect to fail first, and widen to every seat only when
   they pass. Run each cell more than once; one run per cell is an anecdote.
4. Done when every cell has a reply and the grader's tally is recorded with the
   runs per cell, the model versions and the date.

A wording change that the check supports still follows `hr-writing-for-agents`.

## Boundaries

- A verdict never substitutes for the execution proof in an `hr-code-review`
  Impact section, a re-run of `hr-maintainability-review`, or `hr-lessons-sweep`
  evidence.
- Feeders, not owners: `hr-diagnosing-bugs` hypotheses and `hr-grilling`
  decision points make good panel briefs; the panel returns a verdict and the
  owning skill decides.
- Keep panel logs in the task's scratch directory, not the repository.
