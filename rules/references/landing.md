## Landing

A branch or worktree is an intermediate step. Land a change (merge or push it
into the remote default branch) only when the user has directed it, for this
task or as a standing rule in their rules or the repository's guidance. Until
then, a task finishes committed on its branch with landing offered. Choosing an
offer option that includes landing, or replying with the accept line when the
recommended option includes it, is that direction.

At task completion, unlanded or uncommitted task changes get one landing option, `Land PR #<n>` or `Commit and land <change>`, never a bare done; only an explicit user deferral (recorded with branch, commits and reason) leaves it out. The option covers this section and § Cleanup, merge included; name only departures from that. Land through the repository's required path without bypassing checks. Landing is done when a fresh fetch shows the change in the default branch. Where deploying is a separate step from the merge, the change is not done until it is live or the user defers the deploy: keep its ledger line open until the live revision contains the commit. A go to merge covers the deploy only where a standing rule says so.

Never reset, stash, switch or merge-commit a checkout to make it match the default.
A session or job running in it is not a reason to wait or ask. A checkout of the
default branch that is strictly behind, with no uncommitted changes to tracked files, is fast-forwarded
with `git merge --ff-only <sha>`. Leave a dirty, diverged or mid-operation one, report its path and reason,
and do not ask the user.
Landing never waits on a local checkout, and a roster entry in one is not an input either: the
checkout's own state decides whether it can be fast-forwarded (below). Removing a worktree is
different; § Cleanup still waits on use.

After integration:

- Fetch, then bring the local default branch current, whoever else has it open.
  When no checkout has it, fast-forward the branch ref. When one checkout has it
  (your own, the primary or another linked worktree), run `git merge --ff-only <sha>`
  there with the remote head you just fetched and verified, provided that checkout
  is on the default branch, has no uncommitted changes to tracked files and no
  unfinished Git operation (merge, rebase, cherry-pick, revert, bisect), and is
  strictly behind. Read that state right before the merge. Untracked files may
  stay, and Git refuses a merge that would overwrite one. Avoid `git pull` there: a fetch by another process can rewrite the shared
  `FETCH_HEAD` mid-pull and fail it with "Cannot fast-forward to multiple
  branches". Confirm the local and fetched remote heads match.
- If that checkout is dirty, diverged, mid-operation or no longer on the default
  branch, or the merge refuses because local edits would be overwritten, leave it
  and write down its path and the reason as a pending local sync. The landing
  stands, so finish the task and do not ask the user to confirm or wait for the
  checkout to go idle. Never merge, reset, stash or switch branches to make it
  match, and never touch a separate clone or a worktree that does not hold the
  default branch.
- Delete the merged remote branch when it is this task's own branch
  (`git push origin --delete <branch>` when the merge did not); § Cleanup
  covers branches others may rely on. Before merging a pull request that another open pull
  request targets, retarget that one to the default branch first.
- When the change landed by squash, verify the pull request's recorded squash
  commit is in the fetched default branch and the intended changes landed; the
  original feature commits need not be ancestors.

Before the first publish step of a version bump (tag, publish, release, announcement), review unreleased changelog entries and public materials (READMEs, charts, graphics with alt text, listing text, announcement, repository description and social preview) and fix what is stale first; an urgent release may limit only the materials to what it affects.

When a change alters something the project states about itself (its scope, supported platforms, defaults, limits or counts), search every place that states it for the old claim before opening the pull request. Search the old wording and its synonyms; do not rely on remembering where it appears. Cover the README, package and registry metadata, docs, graphics and their sources and alt text, tool and help text, setup output, and the hosted repository's description, topics and social preview. Fix each hit or say why it stays. Where the project can, add a check that fails on the old claim.
