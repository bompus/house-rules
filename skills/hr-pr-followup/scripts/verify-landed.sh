#!/usr/bin/env bash
# Post-merge landing checks: containment, local-default state, leftover remote branches.
# Fetches and verifies both remote containment and local-default equality. A stale local default
# fails even when the remote contains the commit. Never resets, switches or deletes.
# With --ff it updates a default checked out nowhere or here with a clean tree.
# --idle-primary <path> additionally permits a fast-forward of this repository's primary checkout:
# use existing ownership evidence or the operator's standing idle direction, unless current
# evidence contradicts it. Git preserves
# unrelated local edits and refuses a fast-forward that would overwrite them. It moves the
# primary to the verified remote commit with `merge --ff-only <sha>` rather than `pull`, because
# `pull` re-fetches into the shared FETCH_HEAD, which a concurrent fetch in the same checkout can
# overwrite ("Cannot fast-forward to multiple branches"). Other linked worktrees
# remain their owners' responsibility. After a blocked post-merge check, rerun this script,
# not merge-pr.sh: the PR is already merged.
# --preflight checks synchronization eligibility before landing, without moving local branches.
# It requires --ff and rejects dirty or diverged targets and unconfirmed checkout ownership,
# even when the local default is current. The caller must keep the target idle until landing
# finishes; this check cannot establish session ownership or prevent another process starting.
# Usage:
#   bash scripts/verify-landed.sh --commit <sha> [--default <branch>]
#     [--branch <merged-head>] [--remote <name>] [--ff [--idle-primary <path>]]
#   bash scripts/verify-landed.sh --preflight --ff [--default <branch>]
#     [--remote <name>] [--idle-primary <path>]
set -euo pipefail

REMOTE=origin
DEFAULT=""
COMMIT=""
BRANCH=""
FF=0
IDLE_PRIMARY=""
PREFLIGHT=0

while [ $# -gt 0 ]; do
  case "$1" in
    --commit) COMMIT="${2:?}"; shift 2;;
    --default) DEFAULT="${2:?}"; shift 2;;
    --branch) BRANCH="${2:?}"; shift 2;;
    --remote) REMOTE="${2:?}"; shift 2;;
    --ff) FF=1; shift;;
    --idle-primary) IDLE_PRIMARY="${2:?}"; shift 2;;
    --preflight) PREFLIGHT=1; shift;;
    *) echo "unknown argument: $1" >&2; exit 2;;
  esac
done
if [ "$PREFLIGHT" = 1 ]; then
  [ "$FF" = 1 ] && [ -z "$COMMIT$BRANCH" ] \
    || { echo "--preflight requires --ff and excludes --commit/--branch" >&2; exit 2; }
else
  [ -n "$COMMIT" ] || { echo "missing --commit <sha>" >&2; exit 2; }
fi
if [ -n "$IDLE_PRIMARY" ]; then
  [ "$FF" = 1 ] || { echo "--idle-primary requires --ff" >&2; exit 2; }
  PRIMARY="$(git worktree list --porcelain | sed -n '1s/^worktree //p')"
  IDLE_PRIMARY="$(git -C "$IDLE_PRIMARY" rev-parse --show-toplevel)"
  [ "$IDLE_PRIMARY" = "$PRIMARY" ] \
    || { echo "--idle-primary is not this repository's primary checkout: $IDLE_PRIMARY" >&2; exit 2; }
fi

if [ -z "$DEFAULT" ]; then
  # The remote's own answer wins; the cached origin/HEAD goes stale when the default branch changes.
  DEFAULT="$(git ls-remote --symref "$REMOTE" HEAD 2>/dev/null | sed -n 's#^ref: refs/heads/\([^[:space:]]*\).*#\1#p' || true)"
  if [ -z "$DEFAULT" ]; then
    DEFAULT="$(git symbolic-ref "refs/remotes/$REMOTE/HEAD" 2>/dev/null | sed "s#^refs/remotes/$REMOTE/##" || true)"
  fi
  [ -n "$DEFAULT" ] || { echo "cannot resolve remote default branch; pass --default" >&2; exit 2; }
fi

git fetch "$REMOTE" "+refs/heads/$DEFAULT:refs/remotes/$REMOTE/$DEFAULT" >/dev/null 2>&1 \
  || { echo "fetch failed: $REMOTE $DEFAULT" >&2; exit 1; }

WTLS="$(git worktree list --porcelain)"
HOLDER="$(printf '%s\n' "$WTLS" | awk -v want="branch refs/heads/$DEFAULT" '
  /^worktree / { path = substr($0, 10) }
  $0 == want { print path; exit }
')"
HERE="$(git rev-parse --show-toplevel)"

if [ "$PREFLIGHT" = 1 ]; then
  # A rebase or bisect detaches HEAD while still reserving its original branch.
  if [ -z "$HOLDER" ]; then
    while IFS= read -r RECORD; do
      case "$RECORD" in worktree\ *) CHECKOUT="${RECORD#worktree }";; *) continue;; esac
      [ -d "$CHECKOUT" ] || continue
      for ASSOCIATION in rebase-merge/head-name rebase-apply/head-name BISECT_START; do
        ASSOCIATION_PATH="$(git -C "$CHECKOUT" rev-parse --path-format=absolute --git-path "$ASSOCIATION")"
        if [ -f "$ASSOCIATION_PATH" ]; then
          IFS= read -r ASSOCIATED_BRANCH < "$ASSOCIATION_PATH"
          if [ "$ASSOCIATED_BRANCH" = "refs/heads/$DEFAULT" ] || [ "$ASSOCIATED_BRANCH" = "$DEFAULT" ]; then
            HOLDER="$CHECKOUT"
            break 2
          fi
        fi
      done
    done <<< "$WTLS"
  fi
  if [ -n "$HOLDER" ]; then
    if [ "$HOLDER" != "$HERE" ] && [ "$HOLDER" != "$IDLE_PRIMARY" ]; then
      echo "sync blocked at $HOLDER: that checkout has the default branch. If nothing is using it, rerun with --idle-primary <primary-path>" >&2
      exit 1
    fi
    STATUS="$(git -C "$HOLDER" status --porcelain)" \
      || { echo "sync blocked at $HOLDER: cannot inspect working tree" >&2; exit 1; }
    [ -z "$STATUS" ] \
      || { echo "sync blocked at $HOLDER: working tree dirty; leave it for its owner" >&2; exit 1; }
    for OPERATION in MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD rebase-merge rebase-apply sequencer BISECT_START; do
      OPERATION_PATH="$(git -C "$HOLDER" rev-parse --path-format=absolute --git-path "$OPERATION")"
      [ ! -e "$OPERATION_PATH" ] \
        || { echo "sync blocked at $HOLDER: unfinished Git operation: $OPERATION" >&2; exit 1; }
    done
  fi
  if git show-ref --verify --quiet "refs/heads/$DEFAULT"; then
    git merge-base --is-ancestor "$DEFAULT" "$REMOTE/$DEFAULT" \
      || { echo "sync blocked: $DEFAULT cannot fast-forward to $REMOTE/$DEFAULT" >&2; exit 1; }
  fi
  echo "synchronization preflight passed: $DEFAULT (${HOLDER:-not checked out})"
  exit 0
fi

FAIL=0

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
    if [ -z "${HOLDER:-}" ]; then
      if [ "$FF" = 1 ] && [ "$FAIL" = 0 ]; then
        git update-ref -m "verify-landed: fast-forward $DEFAULT" "refs/heads/$DEFAULT" "$UPSTREAM" "$LOCAL"
        echo "local $DEFAULT: fast-forwarded $BEHIND commit(s) to $UPSTREAM (not checked out anywhere)"
      else
        echo "local $DEFAULT: $BEHIND behind, not checked out anywhere — safe: git fetch $REMOTE $DEFAULT:$DEFAULT"
      fi
    elif [ "$HOLDER" != "$HERE" ]; then
      if [ "$FF" = 1 ] && [ "$FAIL" = 0 ] && [ "$HOLDER" = "$IDLE_PRIMARY" ]; then
        [ "$(git -C "$HOLDER" symbolic-ref --quiet --short HEAD)" = "$DEFAULT" ] \
          || { echo "primary checkout changed branches; refusing update" >&2; exit 1; }
        git -C "$HOLDER" merge --quiet --ff-only "$UPSTREAM"
        echo "local $DEFAULT: fast-forwarded $BEHIND commit(s) in confirmed idle primary $HOLDER"
      else
        echo "local $DEFAULT: $BEHIND behind, checked out at $HOLDER (not here) — leave for its owner; if you know it is idle: git -C $HOLDER merge --ff-only $UPSTREAM"
        echo "If nothing is using that checkout, rerun verify-landed.sh with --ff --idle-primary <primary-path>." >&2
      fi
    elif [ -n "$(git status --porcelain)" ]; then
      echo "local $DEFAULT: $BEHIND behind but working tree dirty — report, do not touch"
    elif [ "$FF" = 1 ] && [ "$FAIL" = 0 ]; then
      git merge --quiet --ff-only "$UPSTREAM"
      echo "local $DEFAULT: fast-forwarded $BEHIND commit(s) to $UPSTREAM (checked out here)"
    else
      echo "local $DEFAULT: $BEHIND behind, clean, checked out here — safe to fast-forward"
    fi
  else
    echo "local $DEFAULT: diverged from $REMOTE/$DEFAULT — report, do not touch"
  fi
  if [ "$(git rev-parse "$DEFAULT")" != "$(git rev-parse "$REMOTE/$DEFAULT")" ]; then
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

exit "$FAIL"
