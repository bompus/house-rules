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
# lockfile (bun, pnpm, yarn, else npm) after a frozen install when the package declares
# dependencies. It runs under `nice -n 10` with RAYON_NUM_THREADS and UV_THREADPOOL_SIZE capped at
# half the CPUs unless already set. A failing install or check refuses the merge and names the
# command and its exit code. A head with no `scripts.check` prints a warning and merges anyway.
#
# Refuses, after those checks, a repository listed in HR_PUSH_LANDED (space-separated owner/repo names;
# empty by default): its own guidance lands by fast-forwarding the base to the head, because a GitHub
# merge writes the account's profile name into public history. It prints that push instead.
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
    --merge) STRATEGY=--merge; shift;;
    --remote) REMOTE="${2:?}"; shift 2;;
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

# The repository's own check, at the reviewed head. refs/pull/<n>/head also covers a fork's head.
git fetch --quiet --no-tags "$REMOTE" "refs/pull/$PR/head"
FETCHED="$(git rev-parse FETCH_HEAD)"
[ "$FETCHED" = "$OID" ] || { echo "PR $PR head moved to $FETCHED after it was read as $OID; rerun" >&2; exit 1; }
CHECK_DIR=""
remove_check_dir() { [ -z "$CHECK_DIR" ] || git worktree remove --force "$CHECK_DIR" 2>/dev/null || true; CHECK_DIR=""; }
trap remove_check_dir EXIT
# One line from the head's package.json: the named package manager (or -), 1 when scripts.check is
# a string, and 1 when it declares dependencies. An unreadable package.json refuses the merge.
read -r NAMED HAS_CHECK NEEDS_INSTALL < <(
  if git cat-file -e "$OID:package.json" 2>/dev/null; then
    git show "$OID:package.json" | bun -e '
      const p = JSON.parse(await Bun.stdin.text());
      const deps = Object.keys({ ...p.dependencies, ...p.devDependencies, ...p.optionalDependencies });
      console.log((p.packageManager ?? "-").split("@")[0] || "-", typeof p.scripts?.check === "string" ? 1 : 0, deps.length ? 1 : 0);
    ' || echo "invalid"
  else
    echo "- 0 0"
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
    bun | pnpm | yarn | npm) PM="$NAMED";;
    *) if in_head bun.lock || in_head bun.lockb; then PM=bun
      elif in_head pnpm-lock.yaml; then PM=pnpm
      elif in_head yarn.lock; then PM=yarn
      else PM=npm; fi;;
  esac
  CHECK_DIR="$(git rev-parse --path-format=absolute --git-common-dir)/hr-merge-check/pr-$PR"
  git worktree remove --force "$CHECK_DIR" 2>/dev/null || rm -rf "$CHECK_DIR"
  git worktree prune
  git worktree add --quiet --detach "$CHECK_DIR" "$OID"
  case "$PM" in
    bun) INSTALL=(bun install --frozen-lockfile);;
    pnpm) INSTALL=(pnpm install --frozen-lockfile);;
    yarn) INSTALL=(yarn install --frozen-lockfile);;
    *) if in_head package-lock.json; then INSTALL=(npm ci); else INSTALL=(npm install); fi;;
  esac
  CPUS="$(nproc --all 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || echo 2)"
  HALF=$(( CPUS / 2 > 0 ? CPUS / 2 : 1 ))
  NICE=(); command -v nice >/dev/null && NICE=(nice -n 10)
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

REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
if [[ "$PUSH_LANDED" == *" $REPO "* ]]; then
  echo "$REPO lands by fast-forward push, not a GitHub merge (see its AGENTS.md). Run:" >&2
  echo "  git push $REMOTE $HEAD:$BASE && git push $REMOTE --delete $HEAD" >&2
  exit 1
fi

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

# Exit 3 (local sync pending) is not a failure: finish the worktree report, then pass it on.
STATUS=0
bash "$(dirname "${BASH_SOURCE[0]}")/verify-landed.sh" --commit "$SHA" --branch "$HEAD" \
  --default "$BASE" --remote "$REMOTE" "${SYNC_ARGS[@]}" || STATUS=$?

git worktree list --porcelain | awk -v want="branch refs/heads/$HEAD" '
  /^worktree / { path = substr($0, 10) }
  $0 == want { print "still on " substr(want, 19) ": " path " (its owner retires it)" }
'
exit "$STATUS"
