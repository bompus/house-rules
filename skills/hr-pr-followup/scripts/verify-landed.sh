#!/usr/bin/env bash
# Post-merge landing checks: containment, local-default state, leftover remote branches.
# Fetches and verifies both remote containment and local-default equality. A stale local default
# fails even when the remote contains the commit. Never resets, switches or deletes.
#
# With --ff it brings the local default branch current, whoever else has that checkout open. Which
# processes, sessions or roster entries sit in a checkout is never an input. The branch moves when
# it is checked out nowhere (a ref update), or when the one checkout that holds it is on the default
# branch, free of uncommitted changes to tracked files and of an unfinished Git operation, and
# strictly behind: then
# `merge --ff-only <sha>` runs there. It uses the verified remote commit rather than `pull`, because
# `pull` re-fetches into the shared FETCH_HEAD, which a concurrent fetch in the same checkout can
# overwrite ("Cannot fast-forward to multiple branches"). Untracked files may stay: Git keeps them
# and refuses a fast-forward that would overwrite one.
#
# A checkout that fails any of those conditions is left alone and reported on one line:
#   sync skipped at <path>: <reason>
# with a reason of "working tree dirty" (tracked changes), "diverged from <remote>/<default>", "on
# branch <name>, not <default>", "unfinished Git operation: <name>", "fast-forward refused: <why>",
# "cannot inspect Git state" or "cannot inspect working tree". A diverged default that no checkout
# holds is reported at refs/heads/<default>. The landing itself stands; record the path and reason
# where you track the task and do not ask the user.
#
# Exit status: 0 landed and every local default current; 1 a real failure (commit not contained,
# stale default with nothing skipped, leftover remote branch, fetch failure); 2 usage; 3 landed and
# verified, but a local checkout was skipped (local sync pending). After a failure, rerun this
# script, not merge-pr.sh: the PR is already merged.
#
# Usage:
#   bash scripts/verify-landed.sh --commit <sha> [--default <branch>]
#     [--branch <merged-head>] [--remote <name>] [--ff]
set -euo pipefail

REMOTE=origin
DEFAULT=""
COMMIT=""
BRANCH=""
FF=0

while [ $# -gt 0 ]; do
  case "$1" in
    --commit)
      COMMIT="${2:?}"
      shift 2
      ;;
    --default)
      DEFAULT="${2:?}"
      shift 2
      ;;
    --branch)
      BRANCH="${2:?}"
      shift 2
      ;;
    --remote)
      REMOTE="${2:?}"
      shift 2
      ;;
    --ff)
      FF=1
      shift
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 2
      ;;
  esac
done
[ -n "$COMMIT" ] || {
  echo "missing --commit <sha>" >&2
  exit 2
}

if [ -z "$DEFAULT" ]; then
  # The remote's own answer wins; the cached origin/HEAD goes stale when the default branch changes.
  DEFAULT="$(git ls-remote --symref "$REMOTE" HEAD 2>/dev/null | sed -n 's#^ref: refs/heads/\([^[:space:]]*\).*#\1#p' || true)"
  if [ -z "$DEFAULT" ]; then
    DEFAULT="$(git symbolic-ref "refs/remotes/$REMOTE/HEAD" 2>/dev/null | sed "s#^refs/remotes/$REMOTE/##" || true)"
  fi
  [ -n "$DEFAULT" ] || {
    echo "cannot resolve remote default branch; pass --default" >&2
    exit 2
  }
fi

git fetch "$REMOTE" "+refs/heads/$DEFAULT:refs/remotes/$REMOTE/$DEFAULT" >/dev/null 2>&1 \
  || {
    echo "fetch failed: $REMOTE $DEFAULT" >&2
    exit 1
  }

WTLS="$(git worktree list --porcelain)"
HOLDER="$(printf '%s\n' "$WTLS" | awk -v want="branch refs/heads/$DEFAULT" '
  /^worktree / { path = substr($0, 10) }
  $0 == want { print path; exit }
')"
HERE="$(git rev-parse --show-toplevel)"

# A rebase or bisect detaches HEAD while still reserving its original branch.
if [ -z "$HOLDER" ]; then
  while IFS= read -r RECORD; do
    case "$RECORD" in worktree\ *) CHECKOUT="${RECORD#worktree }" ;; *) continue ;; esac
    [ -d "$CHECKOUT" ] || continue
    for ASSOCIATION in rebase-merge/head-name rebase-apply/head-name BISECT_START; do
      # A checkout whose state cannot be read counts as holding the branch: holder_blocker then skips it.
      ASSOCIATION_PATH="$(git -C "$CHECKOUT" rev-parse --path-format=absolute --git-path "$ASSOCIATION" 2>/dev/null)" || {
        HOLDER="$CHECKOUT"
        break 2
      }
      if [ -f "$ASSOCIATION_PATH" ]; then
        ASSOCIATED_BRANCH=""
        if ! { IFS= read -r ASSOCIATED_BRANCH <"$ASSOCIATION_PATH" || [ -n "$ASSOCIATED_BRANCH" ]; } 2>/dev/null; then
          HOLDER="$CHECKOUT"
          break 2
        fi
        if [ "$ASSOCIATED_BRANCH" = "refs/heads/$DEFAULT" ] || [ "$ASSOCIATED_BRANCH" = "$DEFAULT" ]; then
          HOLDER="$CHECKOUT"
          break 2
        fi
      fi
    done
  done <<<"$WTLS"
fi

FAIL=0
SKIPPED=0

skip() {
  echo "sync skipped at $1: $2"
  SKIPPED=1
}

# Prints why a checkout cannot be fast-forwarded now, or nothing when it can.
holder_blocker() {
  local path="$1" operation operation_path branch status
  for operation in MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD rebase-merge rebase-apply sequencer BISECT_START; do
    operation_path="$(git -C "$path" rev-parse --path-format=absolute --git-path "$operation" 2>/dev/null)" \
      || {
        echo "cannot inspect Git state"
        return
      }
    if [ -e "$operation_path" ]; then
      echo "unfinished Git operation: $operation"
      return
    fi
  done
  branch="$(git -C "$path" symbolic-ref --quiet HEAD 2>/dev/null || true)"
  if [ "$branch" != "refs/heads/$DEFAULT" ]; then
    if [ -n "$branch" ]; then
      echo "on branch ${branch#refs/heads/}, not $DEFAULT"
    else
      echo "on branch (detached HEAD), not $DEFAULT"
    fi
    return
  fi
  # Untracked files may stay: Git itself refuses a fast-forward that would overwrite one.
  status="$(git -C "$path" status --porcelain --untracked-files=no 2>/dev/null)" || {
    echo "cannot inspect working tree"
    return
  }
  [ -z "$status" ] || echo "working tree dirty"
}

if git merge-base --is-ancestor "$COMMIT" "$REMOTE/$DEFAULT" 2>/dev/null; then
  echo "contained: $COMMIT in $REMOTE/$DEFAULT"
else
  echo "NOT CONTAINED: $COMMIT missing from $REMOTE/$DEFAULT" >&2
  FAIL=1
fi

if git show-ref --verify --quiet "refs/heads/$DEFAULT"; then
  LOCAL="$(git rev-parse "$DEFAULT")"
  UPSTREAM="$(git rev-parse "$REMOTE/$DEFAULT")"
  if [ "$LOCAL" = "$UPSTREAM" ]; then
    echo "local $DEFAULT: current ($LOCAL)"
  elif git merge-base --is-ancestor "$LOCAL" "$UPSTREAM" 2>/dev/null; then
    BEHIND="$(git rev-list --count "$LOCAL..$UPSTREAM")"
    if [ "$FF" != 1 ] || [ "$FAIL" != 0 ]; then
      WHY="not updated without --ff"
      [ "$FF" != 1 ] || WHY="not updated: the landing check failed"
      if [ -z "$HOLDER" ]; then
        if [ "$FF" != 1 ]; then
          echo "local $DEFAULT: $BEHIND behind, not checked out anywhere. Safe: git fetch $REMOTE $DEFAULT:$DEFAULT"
        else
          echo "local $DEFAULT: $BEHIND behind, not checked out anywhere; $WHY"
        fi
      else
        echo "local $DEFAULT: $BEHIND behind, checked out at $HOLDER; $WHY"
      fi
    elif [ -z "$HOLDER" ]; then
      if REF_ERR="$(git update-ref -m "verify-landed: fast-forward $DEFAULT" "refs/heads/$DEFAULT" "$UPSTREAM" "$LOCAL" 2>&1)"; then
        echo "local $DEFAULT: fast-forwarded $BEHIND commit(s) to $UPSTREAM (not checked out anywhere)"
      else
        skip "refs/heads/$DEFAULT" "fast-forward refused: $(printf '%s' "$REF_ERR" | head -n 1)"
      fi
    else
      # The state is read right before the merge; Git refuses it if edits would be overwritten.
      REASON="$(holder_blocker "$HOLDER")"
      if [ -n "$REASON" ]; then
        skip "$HOLDER" "$REASON"
      elif MERGE_ERR="$(git -C "$HOLDER" merge --quiet --ff-only "$UPSTREAM" 2>&1)"; then
        if [ "$HOLDER" = "$HERE" ]; then
          echo "local $DEFAULT: fast-forwarded $BEHIND commit(s) to $UPSTREAM (checked out here)"
        else
          echo "local $DEFAULT: fast-forwarded $BEHIND commit(s) to $UPSTREAM in $HOLDER"
        fi
      elif printf '%s' "$MERGE_ERR" | grep -q "would be overwritten"; then
        skip "$HOLDER" "fast-forward refused: local edits would be overwritten"
      else
        skip "$HOLDER" "fast-forward refused: $(printf '%s' "$MERGE_ERR" | head -n 1)"
      fi
    fi
  else
    skip "${HOLDER:-refs/heads/$DEFAULT}" "diverged from $REMOTE/$DEFAULT"
  fi
  if [ "$(git rev-parse "$DEFAULT")" != "$(git rev-parse "$REMOTE/$DEFAULT")" ] && [ "$SKIPPED" = 0 ]; then
    echo "LOCAL DEFAULT NOT CURRENT: $DEFAULT differs from $REMOTE/$DEFAULT; landing incomplete" >&2
    FAIL=1
  fi
else
  echo "local $DEFAULT: no local branch (nothing to update)"
fi

if [ -n "$BRANCH" ]; then
  if ! REMOTE_REFS="$(git ls-remote --heads "$REMOTE" "$BRANCH" 2>/dev/null)"; then
    echo "remote branch lookup failed: $REMOTE $BRANCH" >&2
    FAIL=1
  elif [ -n "$REMOTE_REFS" ]; then
    echo "leftover branch: $REMOTE/$BRANCH still exists after merge" >&2
    FAIL=1
  else
    echo "no leftover branch: $REMOTE/$BRANCH gone"
  fi
fi

if [ "$FAIL" != 0 ]; then
  exit 1
fi
if [ "$SKIPPED" = 1 ]; then
  echo "landed; local sync pending (exit 3): record the path and reason above in the task plan"
  exit 3
fi
exit 0
