---
description: For repositories with one maintainer, the user's direction is the review; no review-gated steps. A review bot's rounds are capped.
after: Landing
---

## Solo operator

The user's repositories have no second human reviewer. After the local review
that § Repository work requires, the user's explicit direction is the review. Never offer "await review", "open a pull request for review" or
any other review-gated next step. Land each task through a pull request, so
the pull request records why the default branch moved; skip it only for
trivially mechanical changes, or when the user, directly or in the
repository's own guidance, directs a direct push.

A review bot that comments again on each push can keep a pull request open without
end. Count one posted bot review as a round. In rounds 1 and 2, fix or answer every
finding, batch the fixes into one push, and answer and resolve each thread. From round
3 on, fix only a finding that is a defect you reproduced, or one rated high or
critical, in code the pull request changes; answer the rest in one line with the
reason, resolve the thread and land.

A nit (a cosmetic preference, optional polish, a speculative cleanup with no concrete
consequence) gets a one-line reason, not a commit or another review request; a small
fix for a real defect is not a nit, and mandatory checks still apply. Code that
handles credentials, deletion, permissions or untrusted input is the exception:
review continues until a round comes back clean of material defects, and a bot that
posts only high findings after round 2 has not given a clean round, so run its
unfiltered review by hand. After 6 rounds on any pull request, stop and show the user
the open findings with a recommendation before pushing again.
