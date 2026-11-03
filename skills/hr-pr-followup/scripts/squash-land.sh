#!/usr/bin/env bash
# Squash-lands <ref> onto the branch this checkout has checked out, without a three-way checkout here.
# `git merge --squash --no-overwrite-ignore` protects an ignored local file only when the squash is a
# fast-forward; on a diverged branch the merge writes over it whatever the option says. So the squash is
# built in a throwaway worktree of HEAD (which holds none of this checkout's ignored files), committed there
# with a normal `git commit` so the repository's commit hooks run, and applied here with
# `git merge --ff-only --no-overwrite-ignore`, which Git itself refuses when it would replace an ignored or
# untracked local file, at the moment it writes. <ref> is resolved once.
#
# Usage: squash-land.sh <ref> <commit message>   (any directory of the checkout)
# Prints the new commit. Exit 0: landed, or nothing to squash; 1: refused (a local file is in the way, or a
# commit hook rejected the squash; the checkout is unchanged); 2: usage error, no commit in HEAD, or the
# merge conflicts.
set -euo pipefail
if [ "$#" -ne 2 ] || [ -z "$1" ] || [ -z "$2" ]; then
  echo "usage: squash-land.sh <ref> <commit message>" >&2
  exit 2
fi
git rev-parse --verify --quiet "HEAD^{commit}" >/dev/null || {
  echo "squash-land: HEAD has no commit" >&2
  exit 2
}
TASK="$(git rev-parse --verify --quiet "$1^{commit}")" || {
  echo "squash-land: $1 is not a commit" >&2
  exit 2
}
BASE="$(git rev-parse HEAD)"
WORK="$(mktemp -d "$(git rev-parse --path-format=absolute --git-common-dir)/hr-squash-land.XXXXXX")"
cleanup() { git worktree remove --force "$WORK" >/dev/null 2>&1 || rm -rf "$WORK"; }
trap cleanup EXIT
git worktree add --quiet --detach "$WORK" "$BASE"
if ! git -C "$WORK" merge --squash --quiet "$TASK" >/dev/null 2>&1; then
  echo "squash-land: merging $1 into HEAD has a conflict; resolve it first" >&2
  exit 2
fi
if git -C "$WORK" diff --cached --quiet; then
  echo "squash-land: $1 adds nothing to HEAD" >&2
  exit 0
fi
if ! ERR="$(git -C "$WORK" commit --quiet -m "$2" 2>&1)"; then
  printf 'squash-land: the commit was refused, nothing changed:\n%s\n' "$ERR" >&2
  exit 1
fi
SQUASH="$(git -C "$WORK" rev-parse HEAD)"
if ! ERR="$(git merge --ff-only --no-overwrite-ignore "$SQUASH" 2>&1 >/dev/null)"; then
  printf 'squash-land: refused, nothing changed:\n%s\n' "$ERR" >&2
  exit 1
fi
printf '%s\n' "$SQUASH"
