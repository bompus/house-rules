# Optional GitHub review helpers

Use these helpers only when the repository or user selects their policy.
They require Bun and authenticated `gh`. Run the commands from this skill's
installed directory. They add no authority to reply, resolve or land a PR.
Prefer the host's native PR notifications; `--wait` is a fallback when those
are unavailable.

## Check review feedback

```sh
bun scripts/check-pr-review.ts 123 --repo OWNER/REPO
```

The gate exits 0 when its selected feedback checks pass, 1 for open feedback,
and 2 when coverage cannot be verified. It checks unresolved threads, pending
CodeRabbit or cubic review, skipped review statuses and a missing check when
the head contains `.coderabbit.yaml`. It also checks bot review bodies with
outside-diff, nitpick or duplicate findings. A completed CodeRabbit CheckRun
must conclude SUCCESS; failed, cancelled, skipped or missing conclusions block
the gate. A CodeRabbit status also requires SUCCESS and a description starting
with "Review completed"; that is how the gate tests the general squash rule that an
existing review check must report completion, apart from the no-quota skip below.

Every other check on the head commit must have finished and passed. A check run that is
not COMPLETED, or that concluded anything but SUCCESS, NEUTRAL or SKIPPED, blocks the gate,
and so does a commit status that is not SUCCESS. A head commit with no checks is not blocked,
so a repository without CI passes on this point. A check the base branch requires, from
branch protection or an active ruleset, that has not reported on the head commit also blocks
the gate, so a required check that never started does not pass as green. The gate treats every
check that did report the same way, required or not. It reads only what the API shows the
viewer, and classic branch protection can be hidden from a viewer without write access. It
matches names as written, so a required check restricted to one GitHub App is satisfied by a
same-named check from any source; GitHub's merge check decides the source. A check
that fails for a known unrelated reason blocks the merge until it passes or the owner decides to
land another way. `--wait` also polls while such a check runs, and for a few minutes while a
required check has not yet appeared. The gate does not authorize landing.

The check named exactly "cubic · AI code reviewer" on the head commit is held to the
same rule: while it runs, the gate refuses, and a completed one must conclude
SUCCESS. A NEUTRAL or skipped conclusion means cubic did not review the head
("Incremental review could not start", "Automatic AI review not started after
branch rewrite"), so the gate refuses it too. That pull request stays blocked
until someone comments `@cubic review`, and the refusal says so. A head commit with no cubic check is not blocked,
because cubic's `cubic.yaml` is optional and its absence does not show that cubic is
expected. `--wait` does not wait for a cubic check that has not posted yet.
In a repository that uses cubic, confirm right after a push that its check has appeared
before landing.

A review bot that reports it has no quota or capacity for the pull request is skipped,
with no end date, and the gate prints a `skipped review bot` line naming it and the reason:

- a NEUTRAL cubic check titled "AI review line limit reached", or a NEUTRAL cubic check
  followed, after it completed, by a comment from cubic that the workspace reached its
  monthly review limit (cubic's reply to `@cubic review` when it is out of quota);
- a CodeRabbit success status saying "Review rate limited" or "Review limit reached";
- a completed NEUTRAL CodeRabbit check with a visible, bot-authored quota notice
  saying "Review rate limited" or "Review limit reached". The notice must name the
  full current head and follow that commit, with no later failure superseding it;
- a successful CodeRabbit "Review skipped: N files exceed the limit of M" status accompanied by a visible comment from
  the CodeRabbit bot explicitly reporting insufficient usage credits or metered capacity.
  Its review range must name the full current head, and its creation or bot-authored edit
  must follow that commit, with no later CodeRabbit failure superseding that summary.
  Evidence inside HTML comments does not count. A file-count limit alone does not qualify;
- a CodeRabbit that failed twice without saying why (below).

The gate then judges only the bots that did review. Record in the pull request which bot skipped
and why; findings it posts later become follow-up pull requests. A bot that is still running
is waited for, a missing CodeRabbit check gets its usual grace period under `--wait`, and other
"Review skipped" statuses, failed
or cancelled results, open threads and unanswered review bodies still refuse.

A CodeRabbit reply that says only "Review failed." (no reason) does not change the status, which
stays on a "Review skipped" or other not-reviewed line. The first one refuses with the time it
happened and asks for one re-trigger: comment `@coderabbitai full review` once, then rerun the gate.

The gate counts only visible comments from CodeRabbit posted after the head commit's committer date,
so a commit made locally long before it was pushed can still count older comments. It takes the
person's first `@coderabbitai review` or `@coderabbitai full review` comment after the first failure
as the re-trigger; a re-trigger through CodeRabbit's own checkbox leaves no such comment and is not
seen.

A second bare failure inside an hour of the re-trigger still refuses; the line names the time after
which to comment `@coderabbitai full review` once more, since a bare failure at or after that time
counts. A second bare failure an hour or more after the re-trigger is treated as no capacity:
CodeRabbit is skipped with the times in the `skipped review bot` line. The latest CodeRabbit failure
decides, so a later failure that states a reason keeps the usual refusal.

If a review is missing or incomplete, inspect the integration and the repository's
review policy. The helper does not determine automatic-review enablement or
authorize a manual review request.

To acknowledge a bot review body, post one PR conversation comment using the
authenticated human account with WRITE, MAINTAIN or ADMIN permission:

```text
Review: EXACT_REVIEW_PERMALINK
Head: CURRENT_FULL_HEAD_SHA
Reason: WHY_EACH_FINDING_IS_FIXED_OR_DOES_NOT_APPLY
```

The acknowledgement must follow the review and its latest edit. It is specific
to that review and head. A minimized comment or another account's edit does not
qualify. The helper verifies association and a nonblank reason; the caller
judges whether the explanation answers the findings.

Connections are paginated. Partial responses, malformed fields, repeated
cursors and head changes fail closed. A final head read does not make review
feedback an atomic snapshot. `--wait --timeout 30` polls while CodeRabbit,
cubic or any other check runs, or briefly while CodeRabbit's expected check or a required check
has not appeared.

## Resolve one review thread

Run this helper only after judging that the selected reply answers the finding.
It reads GitHub through `gh`, using that CLI's authenticated account.

```sh
bun scripts/resolve-pr-thread.ts https://github.com/OWNER/REPO/pull/123 \
  --thread THREAD_NODE_ID --expect-head FULL_HEAD_SHA \
  --reply-url https://github.com/OWNER/REPO/pull/123#discussion_r456
```

The default is a dry-run. Add `--apply` to resolve exactly that thread.
The helper never posts replies, dismisses reviews or merges pull requests.
It supports github.com URLs and pins API calls to that host, independent of `GH_HOST`.

The reply must belong to the selected thread and reference another comment in it.
It must be submitted, published, visible, nonblank and authored by the authenticated human.
Pending review replies do not qualify until the review is submitted.
An edited reply must have that same human as its last editor.
Replies from another account do not qualify, even when that account has write permission.
These checks verify association, not the explanation's adequacy.

A new resolution requires an open PR, repository WRITE, MAINTAIN or ADMIN permission,
and GitHub's `viewerCanResolve` permission. An already-resolved thread is a no-op
after the PR, expected head and reply checks. Explicitly selected outdated threads
still require the same reply and permission checks before resolution.

The helper paginates the selected thread's comments and rejects partial responses,
malformed fields, repeating cursors and a head that differs from `--expect-head`.
A final metadata read checks the head and permission before applying.
After the one mutation attempt, it reads again to verify resolution and the head.

GitHub's mutation has no atomic expected-head guard. A push during the mutation
can resolve the thread before the helper detects the changed head and exits 2.
The helper does not undo resolution. Comment and permission reads also are not
an atomic snapshot. Changes between requests may require another inspection.

When the mutation response is lost or malformed, the helper reads current state
without retrying the mutation. A fresh resolved state at the expected head reports
success with an uncertain-response note. An unresolved state, failed verification
or changed head exits 2. Re-read the PR before deciding whether to retry.

The helper shares GraphQL command/envelope validation with `check-pr-review.ts`.
It does not clear that gate's review-body findings or change the landing workflow.

## Landing helpers

Three scripts in `scripts/` implement the landing steps § Landing describes. They never
reset, switch or delete a checkout.

- `merge-pr.sh <owner/repo#n | PR URL | n --repo owner/repo> [--merge] [--remote <name>]` squash-merges
  (or merge-commits) an open pull request. It refuses a bare number, which gh would resolve against the
  current directory's repository, and refuses when the current directory is not a checkout of the named
  repository. It deletes the remote head without `gh pr merge --delete-branch`, which
  removes other sessions' linked worktrees, and with `git push --no-verify`, so a failing
  pre-push hook cannot stop the landing report; a delete that fails anyway leaves the branch
  for `verify-landed.sh` to report (exit 1). It
  refuses while review feedback is open (`check-pr-review.ts`), while another open pull
  request targets the head. A repository listed in `HR_PUSH_LANDED` (space-separated
  `owner/repo`) lands by fast-forward push instead of a merge: after the same checks
  the script pushes the head commit to the base, without force, and refuses when the
  base is not an ancestor of the head. Each refusal tests the failing command's exit
  status itself, because some agent shells do not stop on `set -e`, so run this script
  rather than a hand-written check-then-push sequence. Before merging or pushing, it runs the repository's `check` command
  (package.json `scripts.check`) at the pull request head, in a throwaway detached
  worktree under the repository's Git directory, so a local edit cannot change the result.
  It uses the package manager that `packageManager` or the lockfile names (else npm),
  installs first with a frozen lockfile when the head has a lockfile or declares
  dependencies or workspaces, and runs no package lifecycle scripts during that install
  (a check that needs one runs it itself), and runs
  under `nice -n 10` with `RAYON_NUM_THREADS` and `UV_THREADPOOL_SIZE` at half the
  CPUs unless already set. A failing install or check, an invalid package.json, or a
  head pushed after the review refuses the merge and names the failing command and its
  exit code. A head with no `scripts.check` gets a warning and merges for now. A GitHub
  merge passes `--match-head-commit`. It lists worktrees still on the merged branch so
  their owners clean up. The merge never waits on a local checkout; the local default is
  synchronized afterwards as `verify-landed.sh` describes.
- `verify-landed.sh --commit <sha> [--ff]` fetches, checks that the default branch
  contains the commit, and checks the local default. `--ff` brings the local default
  current: it moves the branch ref when no checkout has it, and runs
  `merge --ff-only <sha>` in the one checkout that has it when that checkout is on the
  default branch, free of uncommitted changes to tracked files and of an unfinished Git
  operation, and strictly behind. Untracked files may stay; Git refuses a fast-forward
  that would overwrite one. Sessions,
  processes and roster entries are never inputs. Any other checkout is left alone and
  reported on one line, `sync skipped at <path>: <reason>`, with a reason of
  `working tree dirty` (tracked changes), `diverged from <remote>/<default>`, `on branch
  <name>, not <default>`, `unfinished Git operation: <name>`, `fast-forward refused: <why>`,
  `cannot inspect Git state` or `cannot inspect working tree`.
  Before updating a checked-out branch, it checks access to Git lock/ref/index destinations,
  reflogs and affected directories. A NUL-separated diff with rename detection disabled covers
  additions, changes and deletions, including both rename paths. Nested additions check the
  nearest existing ancestor. Existing ancestors need search access; directories whose entries
  change need write access too. Deletions conservatively check ancestor write access because Git
  can remove empty directories. Read-only files under writable parents can be replaced.
  An access denial, unreadable change list or unsupported path type skips the update before
  calling Git merge. Symlink/gitlink changes, directory/file transitions and non-files ref storage
  are conservatively skipped. The unheld-branch ref update is unchanged.
  These checks prevent predictable access failures, not partial writes caused by permission races,
  sticky directories, immutable flags, mount changes, full disks, hooks or other unexpected failures.
  They do not repair permissions or roll back a checkout. Fetch bookkeeping is outside the check.
  Exit 0 means landed and current; 1 is a failure; 2 is usage; 3 means landed with a local
  sync pending, which is not a failed landing and needs no question to the user: record
  the path and reason in the task plan. Both scripts use these exit codes. After a
  failure, rerun this script, not `merge-pr.sh`. Neither script accepts the removed
  `--idle-primary` or `--preflight` flags; either one is an unknown argument (exit 2).
- `check-landing.py [--path <checkout>] [--base <ref>]` reports whether a checkout's
  work is in the base branch by content, so squash-merged branches count as landed, and
  lists live processes whose working directory is inside the checkout (Linux only). That
  list is a blocker for removing the worktree only. Landing and syncing the default
  checkout never read it.
