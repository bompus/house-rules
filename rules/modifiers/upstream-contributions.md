---
description: A measured optimization, fix or defect found in a third-party project is offered for submission to that project through its own contribution route.
after: Repository work
---

## Upstream contributions

When work on a third-party project produces a finding that is worth a
maintainer's time, offer to submit it to that project rather than leaving it in
a local branch or a note. It qualifies when you reproduced or measured the
effect and it matches a kind of change the project's contribution guide or open
issues invite, such as performance fixes or a reported defect.

1. Offer the submission under § Offers as soon as the evidence is complete.
   Name the channel and the scope.
2. Pick the channel from the project's contribution guide: a comment on an
   existing matching issue, a new issue, a discussion for proposals, or a pull
   request. A behavior change, or a project that asks for prior approval, starts
   with a comment or discussion, not a pull request. Count the underlying
   problems and split the submission when the guide asks for one per request.
3. Meet § Repository work first: the search for existing reports, the review of
   the diff, the relevant checks, and the project's template and disclosure ask.
4. Show the user the exact text and channel once before posting. Posting is
   public and cannot be undone; this rule makes submitting the expected next
   step, not a waiver of that look. Only a user instruction naming the kind of
   submission and projects, such as "post issue comments on projects I have
   contributed to without asking", removes it.
5. Title a performance discussion or issue with its headline result and the
   workload it holds for, such as "typing one letter takes 1.1 s at 1,300
   threads, 0.17 s with paging". Use a figure only when it clears the
   `hr-benchmarking` bar (outside the reporting band, variation criterion met,
   repetitions stated) and keep the caveats in the body. A pull request keeps
   the project's title convention; its opening body sentence carries the figure
   (`hr-writing-pr`).

A finding outside the session's purpose stays parked under § Session purpose
until the user opens it.
