## Landing

A branch or worktree is an intermediate step. Land a change (merge or push it
into the remote default branch) only when the user has directed it, for this
task or as a standing rule in their rules or the repository's guidance. Until
then, a task finishes committed on its branch with landing offered. Choosing an
offer option that includes landing, or replying with the accept line when the
recommended option includes it, is that direction.

At task completion, unlanded or uncommitted task changes get one landing option, `Land PR #<n>` or `Commit and land <change>`, never a bare done; only an explicit user deferral (recorded with branch, commits and reason) leaves it out. The option covers this section and § Cleanup, merge included; name only departures from that. Land through the repository's required path without bypassing checks. Landing is done when a fresh fetch shows the change in the default branch.

Leave alone a checkout another
session or job uses, or whose use you cannot tell. Never merge, reset, stash or
switch it to make it match the default.

After integration:

- Fetch, then bring the local default branch current. When it is clean,
  strictly behind and not checked out elsewhere, fast-forward it. When another
  worktree has it checked out and you know no session or running job is using
  that worktree (your own main checkout, for example), run
  `git merge --ff-only <sha>` there with the remote head you just fetched and
  verified; unrelated uncommitted files may stay. Avoid `git pull` there: a
  fetch by another process can rewrite the shared `FETCH_HEAD` mid-pull and
  fail it with "Cannot fast-forward to multiple branches". When you cannot
  tell, treat it as in use. Confirm the local and fetched remote heads match.
- If the default branch is diverged, on another branch, in use, or the merge
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

Before the first publish step of a version bump (tag, publish, release, announcement), review unreleased changelog entries and public materials (READMEs, charts, graphics with alt text, listing text, announcement) and fix what is stale first; an urgent release may limit only the materials to what it affects.
