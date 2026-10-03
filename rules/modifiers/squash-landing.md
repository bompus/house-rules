---
description: Pull requests land by squash merge after review-bot findings are handled, and the session's checkout moves off the landed branch.
after: Landing
---
## Squash landing

Prefer squash merges for pull requests unless the repository requires another
strategy or the user picks one. With the GitHub CLI that is
`gh pr merge <n> --squash`; a bare `gh pr merge` can create a merge commit.
Do not pass `--delete-branch` when other worktrees may hold the head branch;
delete the remote branch with `git push origin --delete <branch>` instead.

When you integrate a task branch locally instead of through a pull request,
land it as standard commits, never as a "Merge branch" commit: `git merge
--squash` then commit with a message in the repository's commit convention,
or a fast-forward when the base has not moved. After a pull request merges,
do not also squash the branch locally.

When a review bot reviews pull requests, merge only after its check finishes
and each finding is fixed or answered with a reason, threads resolved. Read
the review body too: findings outside the diff arrive there, not as threads.

Landing never switches, resets or removes the session's own checkout: no
`checkout` or `switch` to another ref, no `reset` or branch force-move, and no
`worktree remove` on it. Updating the default branch it has checked out
(`merge --squash`, `merge --ff-only`, or `pull --ff-only` after a remote merge)
under the fast-forward conditions in § Landing is expected; report other paths
to their owners.

After the merge, do not leave the session's own checkout on a landed branch.
Fetch first, then:

- When the content is fully in the base (a merged pull request whose remote
  head is deleted, or an empty content diff after a squash) and the tree is
  clean, move the checkout onto the fetched base: `git switch <base>` once the
  local base is current, never merge, reset or stash. When another worktree
  has the base checked out, detach at the fetched base (`git switch --detach
  <remote>/<base>`) and create or switch to a branch before any further
  commits.
- When an app manages the checkout, leave it: the app retires it, and the
  report does not mention it.
- When the tree is dirty or ownership is in doubt, stand down: record the
  merged commit, the checkout path and the owner wherever you track the task.

After each landing, update the task list and any active handoff with the
commit, the verification result and the remaining work, then retire the task
worktree and branch under § Cleanup. Stop earlier only when the user asks or
integration is blocked, and report the exact blocker.
