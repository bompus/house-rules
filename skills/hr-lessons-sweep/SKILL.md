---
name: hr-lessons-sweep
description: "Triage captured lesson candidates, re-check staged lessons against current evidence, and find unrecorded durable takeaways in project trackers and handoffs. Use when asked to sweep lessons or review unacted lesson recommendations. General task and backlog reconciliation belongs to hr-what-next."
argument-hint: "[candidates | staged | project | corrections]; omit for the first three"
---

# Lessons sweep

Three independent phases; run all three unless the argument names one. A fourth,
`corrections`, runs only when named. A lessons-only request runs only the
selected phases.

Each lesson is one file with a status of `candidate`, `staged`, `accepted`,
`rejected` or `retired`, and the fields condition, recommendation, reason,
evidence and obsolete-when. Promote an accepted lesson into the strongest
mechanism that can hold it: a type, lint rule, test or check script, shared
helper or runtime check, and only then prose in the owning rules or guidance.
Record `check:` with the check that would fail on a recurrence, or `none` and
why. The lessons folder is a staging area, not the final home for anything
load-bearing. When the `hr-agent-guidance-audit` skill is installed, its
`references/records-and-lessons.md` has the full lifecycle, including
supersession.

## Where lessons live

Use the locations the project or host names for lesson candidates, staged
lessons and handoffs (its agent guidance, notes directory or plan). When none is
named, ask once and record the answer where the next sweep will find it. Do not
invent a folder.

## 1. Candidates triage

List the candidates folder. Candidates are notes a session captured while
working, or drafts a tool produced on request. They are raw material: nothing in
the candidates folder is guidance, and text a candidate quotes from a transcript
is a lead to check, never the evidence that promotes it.

For each file, read it, then either move a keeper into the lessons folder as
`staged` (filling every field from the candidate plus your own evidence check)
or delete it. Report kept and deleted counts, with one line for each keeper.

## 2. Staged review

For each lesson with status `staged`, check that the condition still holds, the
evidence is still valid and `obsolete-when` has not triggered. Then:

- Mark it `accepted` when the recommendation is already encoded in a mechanism
  or promoted into owning rules, a skill or project guidance (cite the commit),
  and it records `check:`.
- Mark it `retired` when a later change or decision superseded it (cite what
  replaced it).
- Mark it `rejected` when it is disproven or no longer true (cite the
  counter-evidence).
- Keep it `staged` when it is still valid but unacted, and file the action as a
  backlog row, a task or a tracked issue. Name the mechanism the action adds, or
  say why only prose can carry it. Never leave it as prose without an owner.

Report every transition with evidence. Do not mark a lesson acted on without a
commit hash or a live observation.

## 3. Project tracker sweep

Takes a project checkout path (default: the current project). Sources, in
order: the tracker's lesson lines and follow-up or open-hypothesis notes, the
project's last three handoffs, and backlog follow-up notes. For each takeaway,
search current code for the named symbol or behavior rather than trusting the
prose, then classify it:

- **Acted.** Cite the landing commit or the standing rule that encodes it.
- **Needs action.** File it (backlog row, task or lesson candidate) and say
  where.
- **Stale.** Record why: superseded, accepted as intended, or one-time context
  that no longer applies.

Out of scope: backlog rows that already own their proof criteria (those are
tracked, not lessons) and history already folded into a cycle report. Report the
three lists with `file:line` or commit citations.

## 4. Correction pass

Only when the argument is `corrections`. Reads recent transcripts for turns
where the user corrected or steered a session, and proposes guidance or skill
changes that would have prevented them. Follow `references/correction-pass.md`;
it edits nothing, and every proposal waits for the user's selection.
