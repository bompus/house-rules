---
description: Pull requests land by squash merge after review-bot findings are handled, and the session's checkout moves off the landed branch.
after: Landing
reference: ../references/squash-landing.md
---

## Squash landing

Prefer squash merges unless the repository requires another strategy or the user
picks one. Before integration, handling review feedback, or moving off a landed
branch, read [the squash procedure](../references/squash-landing.md).
When a review bot reviews pull requests, merge only after it finishes; fix or
answer all findings, resolve threads, and read the full review body.

During integration, never switch, reset, force-move or remove the session's
checkout. Default-branch updates must meet the fast-forward and ownership
conditions in § Landing. After the merge, fetch first; move off a landed branch
only when its content is in the base and the tree is clean. When the base is
checked out elsewhere, detach at the fetched base. Never merge, reset or stash
to move the checkout. Leave app-managed checkouts for the app to retire.
If the tree is dirty or ownership is uncertain, stop and record its owner.
Update the task record and follow § Cleanup after each landing.
