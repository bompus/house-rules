---
description: Pull requests land by squash merge, with the merge commit verified on the default branch.
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
