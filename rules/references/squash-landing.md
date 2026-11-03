## Squash landing

Prefer squash merges for pull requests unless the repository requires another
strategy or the user picks one. With the GitHub CLI that is
`gh pr merge <n> --squash`; a bare `gh pr merge` can create a merge commit.
Do not pass `--delete-branch` when other worktrees may hold the head branch;
delete the remote branch with `git push origin --delete <branch>` instead.

When you integrate a task branch locally instead of through a pull request,
land it as standard commits, never as a "Merge branch" commit: squash it with
`scripts/squash-land.sh <branch> "<message>"` from the `hr-pr-followup` skill (the
message in the repository's commit convention). It builds the squash in a throwaway worktree
with a normal commit (the repository's commit hooks run) and applies it with `merge --ff-only
--no-overwrite-ignore`, which Git refuses when it would replace an ignored or untracked
local file; `merge --squash --no-overwrite-ignore` protects such a file only when the
squash is a fast-forward, not on a diverged branch. On exit 1 the branch did not move and Git's message is
printed; a local file in the way is left untouched, so move it aside or stop and report it.
If the message names a lock or a directory Git could not write, check `git status` first:
Git may have updated some files before it failed.
Commit hooks run in a clean checkout of `HEAD` with the squash staged. A hook that checks only on a
named branch does not fire there (run that check separately), and a hook that needs this checkout's
ignored or generated files (installed dependencies, a virtualenv) fails, so the landing is refused: land
through a pull request instead. A hooks directory the squash tracks is used from that checkout and hides
untracked hooks in the same directory. Repositories with submodules are out of scope: the script exits 1 when the index, `HEAD` or the squash
contains a submodule (or a scan for one fails), with the branch untouched, and the branch lands through a pull request. The checkout must be on a branch with no uncommitted changes to tracked files, and the branch must not verify
signatures (`merge.verifySignatures`, `--verify-signatures` in its `mergeOptions`): the script then exits 2, and the
branch lands through a pull request. Known limits that refuse a landing and touch nothing: `mergeOptions` is read for the signature options only
and not every Git spelling is understood (an attached short-option argument such as `-mX`, an abbreviated
long option that takes an argument, a carriage return as a separator), so a branch Git would merge can be
refused; and when both `gpg.program` and `gpg.openpgp.program` are set, the commit may choose a different
signer than a plain commit and fail. Land those through a pull request. The script is Bash: on Windows use the Bash that ships with Git for Windows. A fast-forward is enough when the base has not moved.
After a pull request merges, do not also squash the branch locally.

When a review bot reviews pull requests, merge only after its check finishes
and each finding is fixed or answered with a reason, threads resolved. Read
the review body too: findings outside the diff arrive there, not as threads.

Let an enabled automatic review start; do not comment to request one. When none
starts, check the integration's status instead of tagging the bot again. A bot's
config file in the repository does not show that it is enabled, and an existing
check on the head must report completion before you merge. A skipped or
cancelled review is not a completed one. The exception is a bot that reports it
has no quota or capacity for the pull request (a used allowance, a rate limit):
proceed on the bots that did review, and record which bot skipped and why.

During integration, never switch, reset or remove the session's own checkout: no
`checkout` or `switch` to another ref, no `reset` or branch force-move, and no
`worktree remove` on it. Updating the default branch it has checked out
(`squash-land.sh` as above, or `merge --ff-only --no-overwrite-ignore` to the fetched remote head after a remote merge)
under the fast-forward conditions in § Landing is expected, and so is fast-forwarding
the one other checkout that holds the default branch. Report a checkout that cannot be
fast-forwarded with its path and reason.

After the merge, do not leave the session's own checkout on a landed branch.
Fetch first, then:

- When the content is fully in the base (a merged pull request whose remote
  head is deleted, or an empty content diff after a squash) and the tree is
  clean, move the checkout onto the fetched base: `git switch <base>` once the
  local base is current, never merge, reset or stash. When another worktree
  has the base checked out, detach at the fetched base (`git switch --detach
  <remote>/<base>`) and create or switch to a branch before any further
  commits.
- When an app manages the checkout, leave it for the app to retire. Report it;
  it is not a blocker.
- When the tree is dirty, leave the checkout where it is and record the merged
  commit, the checkout path and the blocker. The landing stands.

After each landing, update the task list and any active handoff with the
commit, the verification result and the remaining work, then retire the task
worktree and branch under § Cleanup. Stop earlier only when the user asks or
integration is blocked, and report the exact blocker.
