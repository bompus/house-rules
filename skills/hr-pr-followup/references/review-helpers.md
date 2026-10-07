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
CodeRabbit review, skipped review statuses and a missing check when the head
contains `.coderabbit.yaml`. It also checks bot review bodies with outside-diff
or nitpick findings. It does not check every CI result or authorize landing.

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
runs, or briefly while its expected check has not appeared.

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

