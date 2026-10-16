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
with "Review completed". It does not check every CI result or authorize landing.

The check named exactly "cubic · AI code reviewer" on the head commit is held to the
same rule: while it runs, the gate refuses, and a completed one must conclude
SUCCESS. A NEUTRAL or skipped conclusion means cubic did not review the head
("Incremental review could not start", "Automatic AI review not started after
branch rewrite", "AI review line limit reached"), so the gate refuses it too.
That pull request stays blocked until someone comments `@cubic review` or the
limit clears, and the refusal says so. A head commit with no cubic check is not blocked,
because cubic's `cubic.yaml` is optional and its absence does not show that cubic is
expected. `--wait` does not wait for a cubic check that has not posted yet.
In a repository that uses cubic, confirm right after a push that its check has appeared
before landing.

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
feedback an atomic snapshot. `--wait --timeout 30` polls only while CodeRabbit
or cubic runs, or briefly while CodeRabbit's expected check has not appeared.

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

- `merge-pr.sh <pr> [--merge] [--remote <name>] [--idle-primary <path>]` squash-merges
  (or merge-commits) an open pull request and deletes its remote head without
  `gh pr merge --delete-branch`, which removes other sessions' linked worktrees. It
  refuses while review feedback is open (`check-pr-review.ts`), while another open pull
  request targets the head, and for a repository listed in `HR_PUSH_LANDED`
  (space-separated `owner/repo`; those land by fast-forward push, which it prints). The
  merge passes `--match-head-commit`. It lists worktrees still on the merged branch so
  their owners clean up.
- `verify-landed.sh --commit <sha> [--ff [--idle-primary <path>]]` fetches, checks that
  the default branch contains the commit, and checks the local default; `--ff`
  fast-forwards a clean default checkout. `--preflight --ff` checks eligibility before
  landing. After a blocked check, rerun this script, not `merge-pr.sh`.
- `check-landing.py [--path <checkout>] [--base <ref>]` reports whether a checkout's
  work is in the base branch by content, so squash-merged branches count as landed, and
  lists live processes whose working directory is inside the checkout (Linux only).
