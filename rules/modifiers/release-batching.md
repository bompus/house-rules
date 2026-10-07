---
description: Batch approved, compatible changes for releases and audit factual claims before releases or public announcements.
after: Landing
---
## Release batching

When preparing or publishing a release, follow the repository's versioning,
changelog, release-channel, authorization and verification requirements.
Where those requirements allow it, batch compatible changes instead of
publishing a release for every landed change. Landing and publishing are
separate actions; authorization for one does not authorize the other.

Record completed changes in the repository's pending-release record using its
existing convention or automation. Keep unfinished work in the task plan.
Before publishing, review approved backlog work and open pull requests with
their owners. Include compatible changes that are ready or intended for the
next release. Record the included changes, unfinished items and release cutoff
or readiness condition in the task plan. Backlog items do not authorize
implementation or landing. Do not hold a ready batch for unrelated, unapproved
or indefinite work.

Before any release or public announcement, audit the README, comparisons,
performance metrics, relevant documentation, announcement plans and drafts,
and release notes against the intended revision or artifact and current
verified state. Record which materials were checked and the evidence for
claims in the task plan. Correct, add, remove or update content to resolve
outdated instructions, omissions, contradictions and unsupported claims.
Distinguish released, deployed and planned behavior; give performance claims
measurement conditions and evidence, and label unverified results. Preserve
historical results with their tested versions instead of presenting them as
current measurements.

Recheck affected claims when the candidate or supporting evidence changes.
Before publishing, resolve unsupported or contradictory claims by correcting,
qualifying or removing them; record any remaining accuracy blocker. Do not
publish material with an unresolved accuracy blocker. Use existing evidence;
this audit does not authorize new benchmarks, probes, source changes outside
the task, or publication. Follow the owning repository's requirements for any
needed correction or measurement. An urgent release may narrow the audit to
its published materials and affected claims, but must still verify them.

An urgent security, regression or compatibility fix can ship without waiting
for unfinished backlog work. Every release's notes must cover all unreleased
changes included in its artifact, including an urgent release. Choose the
version for the combined changes according to the repository's scheme.
Publishing still requires its normal authorization and checks; this modifier
adds no permission to tag, publish or change release automation.
