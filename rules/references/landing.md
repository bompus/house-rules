## Landing

A branch or worktree is an intermediate step. Land a change (merge or push it
into the remote default branch) only when the user has directed it, for this
task or as a standing rule in their rules or the repository's guidance. Until
then, a task finishes committed on its branch with landing offered. Choosing an
offer option that includes landing, or replying with the accept line when the
recommended option includes it, is that direction.

At task completion, unlanded commits or uncommitted task changes get one landing
option, never a bare done or a commit alone; only an explicit user deferral leaves
them out, recorded with the branch, the commits and the reason. Write it as
`Land PR #<n>` or `Commit and land <change>`. Landing is the whole sequence in
this section and § Cleanup; do not list its steps in the option. Name only
what departs from that sequence, such as a direct merge or a step held for the
user. Choosing the option authorizes the whole landing, merge included. Land through the path the
repository requires (pull request or direct push), and never bypass required
checks. Landing is done when a fresh fetch shows the default branch contains
the change.

After integration:

- Fetch, then bring the local default branch current. When it is clean,
  strictly behind and not checked out elsewhere, fast-forward it. When another
  worktree has it checked out and you know no session or running job is using
  that worktree (your own main checkout, for example), run `git pull --ff-only`
  there; unrelated uncommitted files may stay. When you cannot tell, treat it
  as in use. Confirm the local and fetched remote heads match.
- If the default branch is diverged, on another branch, in use, or the pull
  refuses because local edits would be overwritten, leave it and report its
  path and the blocker. Never merge, reset, stash or switch branches to make it
  match, and never update other sessions' worktrees or separate clones.
- Delete the merged remote branch when it is this task's own branch
  (`git push origin --delete <branch>` when the merge did not); § Cleanup
  covers branches others may rely on. Before merging a pull request that another open pull
  request targets, retarget that one to the default branch first.
- When the change landed by squash, verify the pull request's recorded squash
  commit is in the fetched default branch and the intended changes landed; the
  original feature commits need not be ancestors.
