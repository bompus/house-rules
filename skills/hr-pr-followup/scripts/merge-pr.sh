#!/usr/bin/env bash
# Squash-merge a pull request (or, with --merge, merge-commit it), delete its remote head, and verify the landing, without gh's
# --delete-branch. Since gh 2.98 that flag runs `git worktree remove` on any linked worktree that
# has the head branch checked out, another session's included when it is clean, and switches the
# current checkout to the base when the head is checked out here. This script never removes a
# worktree or local branch: it lists the worktrees still on the head so their owners clean up.
#
# Refuses a PR that is not open, one with open review feedback (check-pr-review.ts: an unresolved
# thread, a review bot still running, unanswered findings in a bot's review body, any other check on
# the head commit that is unfinished or did not pass), or one another
# open PR targets (deleting the head would close that PR; retarget it first with
# `gh pr edit <n> --base <base>`). The merge passes
# --match-head-commit, so a push after the head was read fails the merge instead of landing it.
#
# Then runs the repository's own check at the pull request head, in a throwaway detached worktree
# under the repository's Git directory, so local edits can neither pass nor fail it. The check is
# package.json `scripts.check`, run with the package manager named by `packageManager` or the
# lockfile (bun, pnpm, yarn, else npm), after a frozen install when the head has a lockfile or the
# package declares dependencies or workspaces. The install runs no lifecycle scripts (postinstall
# and the like can be a repository's production setup); a check that needs one runs it itself.
# Each run uses its own directory. It runs under
# `nice -n 10` with RAYON_NUM_THREADS and UV_THREADPOOL_SIZE capped at half the CPUs unless set. A failing install or check refuses the merge and names the
# command and its exit code. A head with no `scripts.check` prints a warning and merges anyway.
#
# A repository listed in HR_PUSH_LANDED (space-separated owner/repo names; empty by default) lands by
# fast-forwarding the base to the head, because a GitHub merge writes the account's profile name into
# public history. After the same checks, this script pushes the head commit to the base itself, and
# refuses when the base is not an ancestor of the head (rebase onto the base first). The push never
# forces the base, so a base that moved meanwhile refuses it too. It deletes the head branch in the
# same atomic push, leased at the reviewed commit, so a head pushed after the review refuses the
# whole landing, as --match-head-commit does for a merge. A fork's head is read again just before.
#
# Every refusal is an explicit exit-status test, not `set -e`: some agent shells run commands so
# that `set -e` does not stop on a failing one, which once let a hand-written gate-then-push
# sequence push past a refusal.
#
# Landing never waits on a local checkout. After the merge it fast-forwards the checkout that holds
# the default branch when that checkout is on the default branch, clean, free of an unfinished Git
# operation and strictly behind (verify-landed.sh), whoever else has it open. Otherwise it leaves the
# checkout alone, prints `sync skipped at <path>: <reason>` and exits 3: landed, local sync pending.
# Record the path and reason in the task plan; nothing needs the user. If verification fails after
# "merged" (exit 1), rerun verify-landed.sh with the printed commit, not this script.
#
# --merge lands with a merge commit instead of a squash. Use it only for a PR whose second parent
# must stay in history, such as an `-s ours` merge that records an upstream reconcile; a squash
# would drop that parent. Every other PR is squashed.
#
# Exit status: 0 landed and every local default current; 1 refused or failed; 2 usage; 3 landed, local sync pending.
#
# Usage: bash scripts/merge-pr.sh <pr> [--merge] [--remote <name>]
set -euo pipefail

PUSH_LANDED=" ${HR_PUSH_LANDED:-} "

PR="${1:?usage: merge-pr.sh <pr> [--merge] [--remote <name>]}"
shift
REMOTE=origin
STRATEGY=--squash
SYNC_ARGS=(--ff)
while [ $# -gt 0 ]; do
  case "$1" in
    --merge)
      STRATEGY=--merge
      shift
      ;;
    --remote)
      REMOTE="${2:?}"
      shift 2
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

IFS=$'\t' read -r HEAD OID BASE STATE FORK < <(gh pr view "$PR" \
  --json headRefName,headRefOid,baseRefName,state,isCrossRepository \
  --jq '[.headRefName, .headRefOid, .baseRefName, .state, .isCrossRepository] | @tsv')
[ "$STATE" = OPEN ] || {
  echo "PR $PR is $STATE, not OPEN" >&2
  exit 1
}

if ! DEPENDENTS="$(gh pr list --state open --base "$HEAD" --json number --jq '.[].number')"; then
  echo "refused: could not list the open PRs that target $HEAD; PR $PR is not merged" >&2
  exit 1
fi
DEPENDENTS="$(echo "$DEPENDENTS" | tr '\n' ' ')"
if [ -n "${DEPENDENTS// /}" ]; then
  echo "open PRs target $HEAD: ${DEPENDENTS% }; retarget them first: gh pr edit <n> --base $BASE" >&2
  exit 1
fi

if ! bun "$(dirname "${BASH_SOURCE[0]}")/check-pr-review.ts" "$PR"; then
  echo "refused: review feedback is open (check-pr-review.ts); PR $PR is not merged" >&2
  exit 1
fi

# The repository's own check, at the reviewed head. refs/pull/<n>/head also covers a fork's head.
# It is fetched into a ref of this run's own, since another fetch in the checkout rewrites FETCH_HEAD.
CHECK_DIR=""
CHECK_REF="refs/hr-merge-check/pr-$PR-$$"
remove_check_dir() {
  [ -z "$CHECK_DIR" ] || git worktree remove --force "$CHECK_DIR" 2>/dev/null || rm -rf "$CHECK_DIR"
  CHECK_DIR=""
  git update-ref -d "$CHECK_REF" 2>/dev/null || true
}
trap remove_check_dir EXIT
if ! git fetch --quiet --no-tags "$REMOTE" "+refs/pull/$PR/head:$CHECK_REF"; then
  echo "refused: could not fetch PR $PR's head; PR $PR is not merged" >&2
  exit 1
fi
FETCHED="$(git rev-parse "$CHECK_REF")" || exit 1
[ "$FETCHED" = "$OID" ] || {
  echo "PR $PR head moved to $FETCHED after it was read as $OID; rerun" >&2
  exit 1
}
# One line from the head's package.json: the named package manager (or -), its major version (or
# -), 1 when scripts.check is a string, and 1 when it declares dependencies or workspaces. An
# unreadable package.json refuses.
read -r NAMED MAJOR HAS_CHECK NEEDS_INSTALL < <(
  if git cat-file -e "$OID:package.json" 2>/dev/null; then
    git show "$OID:package.json" | bun -e '
      const p = JSON.parse(await Bun.stdin.text());
      const deps = Object.keys({ ...p.dependencies, ...p.devDependencies, ...p.optionalDependencies });
      const install = deps.length > 0 || p.workspaces !== undefined;
      const [name, version] = String(p.packageManager ?? "-").split("@");
      const major = /^\d+/.exec(version ?? "")?.[0] ?? "-";
      console.log(name || "-", major, typeof p.scripts?.check === "string" ? 1 : 0, install ? 1 : 0);
    ' || echo "invalid"
  else
    echo "- - 0 0"
  fi
)
if [ "$NAMED" = invalid ]; then
  echo "refused: package.json at ${OID:0:12} is not valid JSON; PR $PR is not merged" >&2
  exit 1
elif [ "$HAS_CHECK" != 1 ]; then
  echo "warning: no check command at ${OID:0:12} (package.json has no scripts.check); merging without one. A later release will refuse this." >&2
else
  in_head() { git cat-file -e "$OID:$1" 2>/dev/null; }
  case "$NAMED" in
    bun | pnpm | yarn | npm) PM="$NAMED" ;;
    *) if in_head bun.lock || in_head bun.lockb; then
      PM=bun
    elif in_head pnpm-lock.yaml; then
      PM=pnpm
    elif in_head yarn.lock; then
      PM=yarn
    else PM=npm; fi ;;
  esac
  # A lockfile also means an install, which covers workspaces declared outside package.json.
  for lock in bun.lock bun.lockb pnpm-lock.yaml yarn.lock package-lock.json npm-shrinkwrap.json; do
    if in_head "$lock"; then NEEDS_INSTALL=1; fi
  done
  # Each run gets its own directory, so a second run for the same PR cannot remove this one's.
  CHECK_ROOT="$(git rev-parse --path-format=absolute --git-common-dir)/hr-merge-check"
  mkdir -p "$CHECK_ROOT"
  CHECK_DIR="$(mktemp -d "$CHECK_ROOT/pr-$PR.XXXXXX")"
  git worktree add --quiet --detach "$CHECK_DIR" "$OID" || exit 1
  # No lifecycle scripts. Yarn 2 and later reject --ignore-scripts and skip them with skip-build.
  case "$PM" in
    bun) INSTALL=(bun install --frozen-lockfile --ignore-scripts) ;;
    pnpm) INSTALL=(pnpm install --frozen-lockfile --ignore-scripts) ;;
    yarn) if [ "$NAMED" = yarn ] && [ "$MAJOR" != - ] && [ "$MAJOR" -ge 2 ] || in_head .yarnrc.yml; then
      INSTALL=(yarn install --immutable --mode=skip-build)
    else
      INSTALL=(yarn install --frozen-lockfile --ignore-scripts)
    fi ;;
    *) if in_head package-lock.json || in_head npm-shrinkwrap.json; then
      INSTALL=(npm ci --ignore-scripts)
    else INSTALL=(npm install --ignore-scripts); fi ;;
  esac
  CPUS="$(nproc --all 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || echo 2)"
  HALF=$((CPUS / 2 > 0 ? CPUS / 2 : 1))
  NICE=()
  command -v nice >/dev/null && NICE=(nice -n 10)
  run_step() {
    local code=0
    (cd "$CHECK_DIR" && RAYON_NUM_THREADS="${RAYON_NUM_THREADS:-$HALF}" \
      UV_THREADPOOL_SIZE="${UV_THREADPOOL_SIZE:-$HALF}" ${NICE[@]+"${NICE[@]}"} "$@") 2>&1 || code=$?
    if [ "$code" != 0 ]; then
      echo "refused: \`$*\` exited $code at ${OID:0:12}; PR $PR is not merged" >&2
      exit 1
    fi
  }
  if [ "$NEEDS_INSTALL" = 1 ]; then run_step "${INSTALL[@]}"; fi
  run_step "$PM" run check
  echo "check passed: $PM run check at ${OID:0:12}"
  remove_check_dir
fi

REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner)" || exit 1
if [[ "$PUSH_LANDED" == *" $REPO "* ]]; then
  # The reviewed and checked commit itself becomes the base: a plain push, which refuses a non-fast-forward.
  if ! git fetch --quiet --no-tags "$REMOTE" "refs/heads/$BASE"; then
    echo "refused: could not fetch $REMOTE/$BASE; PR $PR is not landed" >&2
    exit 1
  fi
  if ! git merge-base --is-ancestor FETCH_HEAD "$OID"; then
    echo "refused: $BASE is not an ancestor of ${OID:0:12}; rebase PR $PR onto $BASE and push it first" >&2
    exit 1
  fi
  if [ "$FORK" = true ]; then
    LATEST="$(git ls-remote "$REMOTE" "refs/pull/$PR/head" | awk '{print $1}')"
    if [ "$LATEST" != "$OID" ]; then
      echo "refused: PR $PR head moved to ${LATEST:-nothing} after it was reviewed as $OID; rerun" >&2
      exit 1
    fi
    PUSH=("$OID:refs/heads/$BASE")
  else
    PUSH=(--atomic --force-with-lease="refs/heads/$HEAD:$OID" "$OID:refs/heads/$BASE" ":refs/heads/$HEAD")
  fi
  if ! git push --quiet "$REMOTE" "${PUSH[@]}"; then
    echo "refused: the fast-forward push of ${OID:0:12} to $BASE failed (a moved base or head refuses it); PR $PR is not landed" >&2
    exit 1
  fi
  [ "$FORK" = true ] || echo "deleted: $REMOTE/$HEAD"
  SHA="$OID"
  echo "landed: PR $PR as $SHA by fast-forward push to $BASE"
else
  if ! gh pr merge "$PR" "$STRATEGY" --match-head-commit "$OID"; then
    echo "refused: gh pr merge failed; PR $PR is not merged" >&2
    exit 1
  fi
  SHA="$(gh pr view "$PR" --json mergeCommit --jq '.mergeCommit.oid // empty')"
  if ! [[ "$SHA" =~ ^([0-9a-f]{40}|[0-9a-f]{64})$ ]]; then
    echo "PR $PR has no merge commit yet (a merge queue may still hold it); leaving its head branch alone" >&2
    exit 1
  fi
  echo "merged: PR $PR as $SHA"
fi

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

# Exit 3 (local sync pending) is not a failure: finish the worktree report, then pass it on.
STATUS=0
bash "$(dirname "${BASH_SOURCE[0]}")/verify-landed.sh" --commit "$SHA" --branch "$HEAD" \
  --default "$BASE" --remote "$REMOTE" "${SYNC_ARGS[@]}" || STATUS=$?

git worktree list --porcelain | awk -v want="branch refs/heads/$HEAD" '
  /^worktree / { path = substr($0, 10) }
  $0 == want { print "still on " substr(want, 19) ": " path " (its owner retires it)" }
'
exit "$STATUS"
