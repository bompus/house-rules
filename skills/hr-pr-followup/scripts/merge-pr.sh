#!/usr/bin/env bash
# Squash-merge a pull request (or, with --merge, merge-commit it), delete its remote head, and verify the landing, without gh's
# --delete-branch. Since gh 2.98 that flag runs `git worktree remove` on any linked worktree that
# has the head branch checked out, another session's included when it is clean, and switches the
# current checkout to the base when the head is checked out here. This script never removes a
# worktree or local branch: it lists the worktrees still on the head so their owners clean up.
#
# Refuses a PR that is not open, one with open review feedback (check-pr-review.ts: an unresolved
# thread, a review bot still running, unanswered findings in a bot's review body), or one another
# open PR targets (deleting the head would close that PR; retarget it first with
# `gh pr edit <n> --base <base>`). The merge passes
# --match-head-commit, so a push after the head was read fails the merge instead of landing it.
#
# Refuses, after those checks, a repository listed in HR_PUSH_LANDED (space-separated owner/repo names;
# empty by default): its own guidance lands by fast-forwarding the base to the head, because a GitHub
# merge writes the account's profile name into public history. It prints that push instead.
#
# Before merging, verifies that the local default can be synchronized, even if it is current.
# Refuses a dirty/diverged target or a default held in another checkout without --idle-primary.
# After merging, fast-forwards the confirmed local default and fails if it is still stale.
# To update the primary checkout from a task worktree, pass --idle-primary <path>
# using existing ownership evidence or the operator's standing idle direction, unless current
# evidence contradicts it; keep it idle through landing.
# If verification
# fails after "merged", rerun verify-landed.sh with the printed commit, not this script.
#
# --merge lands with a merge commit instead of a squash. Use it only for a PR whose second parent
# must stay in history, such as an `-s ours` merge that records an upstream reconcile; a squash
# would drop that parent. Every other PR is squashed.
#
# Usage: bash scripts/merge-pr.sh <pr> [--merge] [--remote <name>] [--idle-primary <path>]
set -euo pipefail

PUSH_LANDED=" ${HR_PUSH_LANDED:-} "

PR="${1:?usage: merge-pr.sh <pr> [--merge] [--remote <name>] [--idle-primary <path>]}"
shift
REMOTE=origin
STRATEGY=--squash
SYNC_ARGS=(--ff)
while [ $# -gt 0 ]; do
  case "$1" in
    --merge) STRATEGY=--merge; shift;;
    --remote) REMOTE="${2:?}"; shift 2;;
    --idle-primary) SYNC_ARGS+=(--idle-primary "${2:?}"); shift 2;;
    *) echo "unknown argument: $1" >&2; exit 2;;
  esac
done

IFS=$'\t' read -r HEAD OID BASE STATE FORK < <(gh pr view "$PR" \
  --json headRefName,headRefOid,baseRefName,state,isCrossRepository \
  --jq '[.headRefName, .headRefOid, .baseRefName, .state, .isCrossRepository] | @tsv')
[ "$STATE" = OPEN ] || { echo "PR $PR is $STATE, not OPEN" >&2; exit 1; }

DEPENDENTS="$(gh pr list --state open --base "$HEAD" --json number --jq '.[].number' | tr '\n' ' ')"
if [ -n "${DEPENDENTS// /}" ]; then
  echo "open PRs target $HEAD: ${DEPENDENTS% }; retarget them first: gh pr edit <n> --base $BASE" >&2
  exit 1
fi

bun "$(dirname "${BASH_SOURCE[0]}")/check-pr-review.ts" "$PR"

REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
if [[ "$PUSH_LANDED" == *" $REPO "* ]]; then
  echo "$REPO lands by fast-forward push, not a GitHub merge (see its AGENTS.md). Run:" >&2
  echo "  git push $REMOTE $HEAD:$BASE && git push $REMOTE --delete $HEAD" >&2
  exit 1
fi

bash "$(dirname "${BASH_SOURCE[0]}")/verify-landed.sh" --preflight \
  --default "$BASE" --remote "$REMOTE" "${SYNC_ARGS[@]}"

gh pr merge "$PR" "$STRATEGY" --match-head-commit "$OID"
SHA="$(gh pr view "$PR" --json mergeCommit --jq '.mergeCommit.oid // empty')"
if ! [[ "$SHA" =~ ^([0-9a-f]{40}|[0-9a-f]{64})$ ]]; then
  echo "PR $PR has no merge commit yet (a merge queue may still hold it); leaving its head branch alone" >&2
  exit 1
fi
echo "merged: PR $PR as $SHA"

# A fork's head lives in another repository; a repository may also delete merged heads itself.
# Delete only a branch that still sits at the pull request's head commit, so a same-named branch on
# an unrelated remote survives.
if [ "$FORK" != true ]; then
  REMOTE_HEAD="$(git ls-remote --heads "$REMOTE" "refs/heads/$HEAD" | awk '{print $1}')"
  if [ "$REMOTE_HEAD" = "$OID" ]; then
    git push --quiet --force-with-lease="refs/heads/$HEAD:$OID" "$REMOTE" --delete "$HEAD"
    echo "deleted: $REMOTE/$HEAD"
  elif [ -n "$REMOTE_HEAD" ]; then
    echo "kept: $REMOTE/$HEAD is at $REMOTE_HEAD, not the pull request head $OID" >&2
  fi
fi

bash "$(dirname "${BASH_SOURCE[0]}")/verify-landed.sh" --commit "$SHA" --branch "$HEAD" \
  --default "$BASE" --remote "$REMOTE" "${SYNC_ARGS[@]}"

git worktree list --porcelain | awk -v want="branch refs/heads/$HEAD" '
  /^worktree / { path = substr($0, 10) }
  $0 == want { print "still on " substr(want, 19) ": " path " (its owner retires it)" }
'
