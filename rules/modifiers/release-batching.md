---
description: Batch approved, compatible changes before publishing releases, with a defined cutoff and an urgent-fix path.
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

An urgent security, regression or compatibility fix can ship without waiting
for unfinished backlog work. Every release's notes must cover all unreleased
changes included in its artifact, including an urgent release. Choose the
version for the combined changes according to the repository's scheme.
Publishing still requires its normal authorization and checks; this modifier
adds no permission to tag, publish or change release automation.
