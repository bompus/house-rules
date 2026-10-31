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
# Another open PR that has the same branch as its head, in any repository (a fork's mirror of an
# upstream PR shares one branch), also closes when the branch is deleted. The landing still goes
# ahead, but the branch is kept and the PRs that use it are named.
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
# The pull request names its repository: `owner/repo#<n>`, its URL, or `<n> --repo owner/repo`. A
# bare number is refused, because gh would resolve it against whatever repository the current
# directory belongs to and could merge another repository's pull request of the same number. Every
# gh call carries that name, and the repository is never asked of the current directory: a
# checkout of a fork also has the upstream remote, so `gh repo view` names the upstream there. The
# check and the push run in this checkout, so it needs a remote whose URL (https or ssh, any case)
# is that repository's; the script uses that remote, `origin` first, unless --remote names one.
# With no such remote it refuses.
#
# --explain runs the same conditions read-only, lands nothing and prints one line per condition,
# `met` or `UNMET`: the pull request is open, no open PR targets its head branch, review threads
# and review-body findings are resolved, the private reviewer has reviewed the current head, the
# bot review rounds so far against HR_REVIEW_ROUND_CAP (default 6; advisory, a landing never
# refuses on it), the other checks on the head, the head equals the fetched commit, the
# repository's own check passes, and, where the repository lands by push, the base is an ancestor
# of the head and the head branch is still at the reviewed commit (the lease the push holds). It
# runs the repository's check as a landing does. Exit 0 when every condition is met, 1 otherwise.
#
# Exit status: 0 landed and every local default current; 1 refused or failed; 2 usage; 3 landed, local sync pending.
#
# Usage: bash scripts/merge-pr.sh <owner/repo#n | PR URL | n --repo owner/repo> [--merge] [--remote <name>] [--explain]
set -euo pipefail

PUSH_LANDED=" ${HR_PUSH_LANDED:-} "
USAGE="usage: merge-pr.sh <owner/repo#n | PR URL | n --repo owner/repo> [--merge] [--remote <name>] [--explain]"

TARGET="${1:?$USAGE}"
shift
NAMED_REPO=""
REMOTE=""
EXPLAIN=0
UNMET=0
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
    --explain)
      EXPLAIN=1
      shift
      ;;
    --repo)
      NAMED_REPO="${2:?}"
      shift 2
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [[ "$TARGET" =~ ^https://github\.com/([^/]+/[^/]+)/pull/([0-9]+)/?$ ]] \
  || [[ "$TARGET" =~ ^([^/#[:space:]]+/[^/#[:space:]]+)#([0-9]+)$ ]]; then
  if [ -n "$NAMED_REPO" ] && [ "${NAMED_REPO,,}" != "${BASH_REMATCH[1],,}" ]; then
    echo "$TARGET and --repo $NAMED_REPO name different repositories" >&2
    exit 2
  fi
  NAMED_REPO="${BASH_REMATCH[1]}"
  PR="${BASH_REMATCH[2]}"
elif [[ "$TARGET" =~ ^[0-9]+$ ]] && [ -n "$NAMED_REPO" ]; then
  PR="$TARGET"
else
  echo "name the pull request's repository, as owner/repo#$TARGET or with --repo; a bare number resolves against the current directory's repository" >&2
  echo "$USAGE" >&2
  exit 2
fi
REPO="$NAMED_REPO"
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "refused: the current directory is not a git checkout; PR $REPO#$PR is not merged" >&2
  exit 1
fi

# host/owner/repo of a git remote URL (https or ssh form), lower case.
remote_slug() {
  local url="${1,,}"
  url="${url#https://}"
  url="${url#http://}"
  url="${url#ssh://}"
  url="${url#git://}"
  url="${url#*@}"
  url="${url/://}"
  url="${url%/}"
  printf '%s' "${url%.git}"
}
if [ -z "$REMOTE" ]; then
  WANT="github.com/${REPO,,}"
  while read -r KEY URL; do
    NAME="${KEY#remote.}"
    NAME="${NAME%.url}"
    if [ "$(remote_slug "$URL")" = "$WANT" ] && { [ -z "$REMOTE" ] || [ "$NAME" = origin ]; }; then
      REMOTE="$NAME"
    fi
  done < <(git config --get-regexp '^remote\..+\.url$' 2>/dev/null || true)
  if [ -z "$REMOTE" ]; then
    echo "refused: this checkout has no remote for $REPO; PR $PR is not merged" >&2
    exit 1
  fi
fi

# One landing condition. Refused, it prints the reason and exits; under --explain it prints UNMET and goes on.
unmet() {
  if [ "$EXPLAIN" = 1 ]; then
    echo "UNMET  $1: $2"
    UNMET=1
    return 0
  fi
  echo "$2" >&2
  exit 1
}
met() {
  if [ "$EXPLAIN" = 1 ]; then echo "met    $1${2:+: $2}"; fi
  return 0
}

IFS=$'\t' read -r HEAD OID BASE STATE FORK < <(gh pr view "$PR" --repo "$REPO" \
  --json headRefName,headRefOid,baseRefName,state,isCrossRepository \
  --jq '[.headRefName, .headRefOid, .baseRefName, .state, .isCrossRepository] | @tsv')
if [ "$STATE" = OPEN ]; then
  met "PR is open"
else
  unmet "PR is open" "PR $PR is $STATE, not OPEN"
fi

if ! DEPENDENTS="$(gh pr list --repo "$REPO" --state open --base "$HEAD" --json number --jq '.[].number')"; then
  unmet "no open PR targets the head branch" "refused: could not list the open PRs that target $HEAD; PR $PR is not merged"
else
  DEPENDENTS="$(echo "$DEPENDENTS" | tr '\n' ' ')"
  if [ -n "${DEPENDENTS// /}" ]; then
    unmet "no open PR targets the head branch" "open PRs target $HEAD: ${DEPENDENTS% }; retarget them first: gh pr edit <n> --base $BASE"
  else
    met "no open PR targets the head branch"
  fi
fi

CHECKER="$(dirname "${BASH_SOURCE[0]}")/check-pr-review.ts"
if [ "$EXPLAIN" != 1 ]; then
  if ! bun "$CHECKER" "$PR" --repo "$REPO"; then
    echo "refused: review feedback is open (check-pr-review.ts); PR $PR is not merged" >&2
    exit 1
  fi
else
  # The checker prints each open item as an indented line on stderr. Sort them into the conditions they break.
  REVIEW_CODE=0
  REVIEW_ERR="$(bun "$CHECKER" "$PR" --repo "$REPO" 2>&1 >/dev/null)" || REVIEW_CODE=$?
  THREADS="" BOT="" CHECKS="" OTHER=""
  if [ "$REVIEW_CODE" = 1 ]; then
    while IFS= read -r LINE; do
      case "$LINE" in
        "  unresolved thread:"* | "  unanswered findings in a review body:"*) THREADS="$THREADS${THREADS:+; }${LINE#  }" ;;
        "  app review pending:"* | "  review still running:"* | *" did not review the head commit"* | *" review concluded "* | "  no CodeRabbit check"*) BOT="$BOT${BOT:+; }${LINE#  }" ;;
        "  check "* | "  required check has not reported:"*) CHECKS="$CHECKS${CHECKS:+; }${LINE#  }" ;;
        "  "*) OTHER="$OTHER${OTHER:+; }${LINE#  }" ;;
      esac
    done <<<"$REVIEW_ERR"
  elif [ "$REVIEW_CODE" != 0 ]; then
    OTHER="check-pr-review.ts could not read the PR: ${REVIEW_ERR%%$'\n'*}"
  fi
  for ROW in "THREADS|review threads and review-body findings are resolved" \
    "BOT|bot review of the current head is in place or not required" \
    "CHECKS|other checks on the head commit have passed" \
    "OTHER|no other review feedback is open"; do
    VAR="${ROW%%|*}"
    if [ -n "${!VAR}" ]; then unmet "${ROW#*|}" "${!VAR}"; else met "${ROW#*|}"; fi
  done
  CAP="${HR_REVIEW_ROUND_CAP:-6}"
  if ROUNDS="$(gh api "repos/$REPO/pulls/$PR/reviews" --paginate --jq '[.[] | select(.user.type == "Bot")] | length' 2>/dev/null)"; then
    ROUNDS="$(echo "$ROUNDS" | awk '{ n += $1 } END { print n + 0 }')"
    if [ "$ROUNDS" -le "$CAP" ]; then
      met "bot review rounds" "$ROUNDS of $CAP"
    else
      unmet "bot review rounds" "$ROUNDS of $CAP, past the cap; show the user the open findings before pushing again (advisory: a landing does not refuse on it)"
    fi
  else
    unmet "bot review rounds" "could not count the bot reviews on PR $PR"
  fi
  if [ -z "${ROUNDS:-}" ]; then
    :
  elif [ "$ROUNDS" -le "$CAP" ]; then
    met "bot review rounds: $ROUNDS of $CAP"
  else
    unmet "bot review rounds: $ROUNDS of $CAP" "past the cap; show the user the open findings before pushing again (advisory: a landing does not refuse on it)"
  fi
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
FETCHED_OK=0
if ! git fetch --quiet --no-tags "$REMOTE" "+refs/pull/$PR/head:$CHECK_REF"; then
  unmet "PR head equals the fetched commit" "refused: could not fetch PR $PR's head; PR $PR is not merged"
else
  FETCHED="$(git rev-parse "$CHECK_REF")" || exit 1
  if [ "$FETCHED" = "$OID" ]; then
    FETCHED_OK=1
    met "PR head equals the fetched commit" "${OID:0:12}"
  else
    unmet "PR head equals the fetched commit" "PR $PR head moved to $FETCHED after it was read as $OID; rerun"
  fi
fi

# The repository's own check at the head, in a throwaway worktree. Fails by setting CHECK_FAILED to the
# refusal text; prints its progress either way.
CHECK_FAILED=""
run_repo_check() {
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
    CHECK_FAILED="refused: package.json at ${OID:0:12} is not valid JSON; PR $PR is not merged"
    return 1
  elif [ "$HAS_CHECK" != 1 ]; then
    echo "warning: no check command at ${OID:0:12} (package.json has no scripts.check); merging without one. A later release will refuse this." >&2
    return 0
  fi
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
      CHECK_FAILED="refused: \`$*\` exited $code at ${OID:0:12}; PR $PR is not merged"
      return 1
    fi
  }
  if [ "$NEEDS_INSTALL" = 1 ]; then run_step "${INSTALL[@]}" || return 1; fi
  run_step "$PM" run check || return 1
  echo "check passed: $PM run check at ${OID:0:12}"
  remove_check_dir
}
if [ "$FETCHED_OK" = 1 ]; then
  if ! run_repo_check; then
    unmet "repository check passed" "$CHECK_FAILED"
  elif [ "$HAS_CHECK" = 1 ]; then
    met "repository check passed" "$PM run check at ${OID:0:12}"
  else
    met "repository check passed" "no check command defined; the merge goes ahead without one"
  fi
fi

# Deleting the head closes every other open PR that has it as its head, in any repository, so such a
# PR keeps the branch. A fork's head is never deleted here; only a head in $REPO can be shared. The
# lookup runs after the checks, which can take minutes, so a PR opened meanwhile is still seen. A
# missing ref or an empty answer is an error, not "nobody shares it": the head exists in $REPO.
KEEP_HEAD=""
if [ "$FORK" != true ]; then
  SELF="https://github.com/$REPO/pull/$PR"
  # shellcheck disable=SC2016  # $owner, $name and $ref are GraphQL variables, not shell
  if ! SHARING="$(gh api graphql -f owner="${REPO%%/*}" -f name="${REPO#*/}" -f ref="refs/heads/$HEAD" \
    -f query='query($owner: String!, $name: String!, $ref: String!) {
      repository(owner: $owner, name: $name) {
        ref(qualifiedName: $ref) { associatedPullRequests(states: OPEN, first: 50) { nodes { url } } }
      }
    }' --jq '.data.repository.ref.associatedPullRequests.nodes[].url')"; then
    unmet "head branch is not used by another open PR" "refused: could not list the open PRs that use $HEAD as their head; PR $PR is not merged"
    SHARING=""
  fi
  while IFS= read -r URL; do
    if [ -n "$URL" ] && [ "${URL,,}" != "${SELF,,}" ]; then
      KEEP_HEAD="${KEEP_HEAD:+$KEEP_HEAD }$URL"
    fi
  done <<<"$SHARING"
fi
KEPT_MESSAGE="kept: $REMOTE/$HEAD is the head of open PRs ($KEEP_HEAD), and deleting it would close them"

if [[ "${PUSH_LANDED,,}" == *" ${REPO,,} "* ]]; then
  # The reviewed and checked commit itself becomes the base: a plain push, which refuses a non-fast-forward.
  if ! git fetch --quiet --no-tags "$REMOTE" "refs/heads/$BASE"; then
    unmet "base is an ancestor of the head" "refused: could not fetch $REMOTE/$BASE; PR $PR is not landed"
  elif ! git merge-base --is-ancestor FETCH_HEAD "$OID"; then
    unmet "base is an ancestor of the head" "refused: $BASE is not an ancestor of ${OID:0:12}; rebase PR $PR onto $BASE and push it first"
  else
    met "base is an ancestor of the head" "a fast-forward to ${OID:0:12} is possible"
  fi
  if [ "$FORK" = true ]; then
    LATEST="$(git ls-remote "$REMOTE" "refs/pull/$PR/head" | awk '{print $1}')"
    if [ "$LATEST" != "$OID" ]; then
      unmet "head branch is still at the reviewed commit" "refused: PR $PR head moved to ${LATEST:-nothing} after it was reviewed as $OID; rerun"
    else
      met "head branch is still at the reviewed commit" "the PR head is ${OID:0:12}"
    fi
    PUSH=("$OID:refs/heads/$BASE")
  else
    # --explain reads what the push lease below compares: the head branch on the remote.
    if [ "$EXPLAIN" = 1 ]; then
      LEASED="$(git ls-remote --heads "$REMOTE" "refs/heads/$HEAD" | awk '{print $1}')"
      if [ "$LEASED" = "$OID" ]; then
        met "head branch is still at the reviewed commit" "$REMOTE/$HEAD is ${OID:0:12}, so the push lease holds"
      else
        unmet "head branch is still at the reviewed commit" "$REMOTE/$HEAD is ${LEASED:-missing}, not ${OID:0:12}; the push lease would refuse"
      fi
    fi
    # The lease on the head refuses a head pushed after the review, as long as it was pushed before
    # Git read the remote refs. A kept head is pushed at its own value, so Git leaves it out of the
    # server's transaction: a push in the moments between that read and the base update is not
    # refused. The commit that lands is still the reviewed one; the newer commit stays on the open PR.
    PUSH=(--atomic --force-with-lease="refs/heads/$HEAD:$OID" "$OID:refs/heads/$BASE")
    if [ -n "$KEEP_HEAD" ]; then
      PUSH+=("$OID:refs/heads/$HEAD")
    else
      PUSH+=(":refs/heads/$HEAD")
    fi
  fi
  if [ "$EXPLAIN" != 1 ]; then
    if ! git push --quiet "$REMOTE" "${PUSH[@]}"; then
      echo "refused: the fast-forward push of ${OID:0:12} to $BASE failed (a moved base or head refuses it); PR $PR is not landed" >&2
      exit 1
    fi
    if [ "$FORK" != true ] && [ -z "$KEEP_HEAD" ]; then
      echo "deleted: $REMOTE/$HEAD"
    fi
    SHA="$OID"
    echo "landed: PR $PR as $SHA by fast-forward push to $BASE"
  fi
elif [ "$EXPLAIN" = 1 ]; then
  met "landing is a GitHub merge pinned to the head commit" "gh pr merge --match-head-commit ${OID:0:12}"
else
  if ! gh pr merge "$PR" "$STRATEGY" --match-head-commit "$OID" --repo "$REPO"; then
    echo "refused: gh pr merge failed; PR $PR is not merged" >&2
    exit 1
  fi
  SHA="$(gh pr view "$PR" --repo "$REPO" --json mergeCommit --jq '.mergeCommit.oid // empty')"
  if ! [[ "$SHA" =~ ^([0-9a-f]{40}|[0-9a-f]{64})$ ]]; then
    echo "PR $PR has no merge commit yet (a merge queue may still hold it); leaving its head branch alone" >&2
    exit 1
  fi
  echo "merged: PR $PR as $SHA"
fi

if [ "$EXPLAIN" = 1 ]; then
  if [ "$FORK" = true ]; then
    met "head branch after landing" "a fork's head is left alone"
  elif [ -n "$KEEP_HEAD" ]; then
    met "head branch after landing" "kept, used by other open PRs: $KEEP_HEAD"
  else
    met "head branch after landing" "$REMOTE/$HEAD is deleted"
  fi
  if [ "$UNMET" = 0 ]; then
    echo "all conditions met: PR $PR would land; nothing was changed"
    exit 0
  fi
  echo "UNMET conditions above refuse PR $PR; nothing was changed" >&2
  exit 1
fi

# A fork's head lives in another repository; a repository may also delete merged heads itself.
# Delete only a branch that still sits at the pull request's head commit, so a same-named branch on
# an unrelated remote survives.
if [ -n "$KEEP_HEAD" ]; then
  echo "$KEPT_MESSAGE" >&2
elif [ "$FORK" != true ]; then
  REMOTE_HEAD="$(git ls-remote --heads "$REMOTE" "refs/heads/$HEAD" | awk '{print $1}')"
  if [ "$REMOTE_HEAD" = "$OID" ]; then
    # --no-verify: pre-push hooks guard what a push adds, and a deletion adds nothing. The head was
    # already checked above, so a hook failing here (say a stale node_modules in this checkout) must
    # not cut the landing report short. A delete that still fails does not either: verify-landed.sh
    # below reports the leftover branch and exits 1.
    if git push --quiet --no-verify --force-with-lease="refs/heads/$HEAD:$OID" "$REMOTE" --delete "$HEAD"; then
      echo "deleted: $REMOTE/$HEAD"
    else
      echo "delete failed: $REMOTE/$HEAD; PR $PR is merged, so the landing checks still run" >&2
    fi
  elif [ -n "$REMOTE_HEAD" ]; then
    echo "kept: $REMOTE/$HEAD is at $REMOTE_HEAD, not the pull request head $OID" >&2
  fi
fi

# Exit 3 (local sync pending) is not a failure: finish the worktree report, then pass it on.
STATUS=0
BRANCH_ARGS=(--branch "$HEAD")
[ -z "$KEEP_HEAD" ] || BRANCH_ARGS=()
bash "$(dirname "${BASH_SOURCE[0]}")/verify-landed.sh" --commit "$SHA" ${BRANCH_ARGS[@]+"${BRANCH_ARGS[@]}"} \
  --default "$BASE" --remote "$REMOTE" "${SYNC_ARGS[@]}" || STATUS=$?

git worktree list --porcelain | awk -v want="branch refs/heads/$HEAD" '
  /^worktree / { path = substr($0, 10) }
  $0 == want { print "still on " substr(want, 19) ": " path " (its owner retires it)" }
'
exit "$STATUS"
