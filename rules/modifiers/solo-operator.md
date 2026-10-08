---
description: For repositories with one maintainer, the user's direction is the review; no review-gated steps.
after: Landing
---

## Solo operator

The user's repositories have no second reviewer: the user's explicit direction
is the review. Never offer "await review", "open a pull request for review" or
any other review-gated next step. Land each task through a pull request, so
the pull request records why the default branch moved; skip it only for
trivially mechanical changes, or when the user, directly or in the
repository's own guidance, directs a direct push.
