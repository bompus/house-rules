#!/usr/bin/env bash
# Squash-lands <ref> onto the branch this checkout has checked out, without a three-way checkout here.
# `git merge --squash --no-overwrite-ignore` protects an ignored local file only when the squash is a
# fast-forward; on a diverged branch the merge writes over it whatever the option says. So the squash is
# built in a throwaway worktree of HEAD (which holds none of this checkout's ignored files), committed there
# with a normal `git commit` so the repository's commit hooks run, and applied here with
# `git merge --ff-only --no-overwrite-ignore`, which Git itself refuses when it would replace an ignored or
# untracked local file, at the moment it writes. <ref> is resolved once.
# Out of scope: a repository with a submodule (a gitlink in the index, in HEAD or in the squash) is refused
# with exit 1 and the branch untouched (a gitlink the task or a commit hook adds is caught after the squash is
# staged or committed, before the final merge; a scan that fails refuses too); land it through a pull request.
# Limits: the commit runs in a clean checkout of HEAD with the squash staged, so a hook that needs this
# checkout's ignored or generated files (installed dependencies, a virtualenv, a hook helper) fails there and
# the landing is refused; a hooks directory the squash tracks is used from the throwaway worktree and hides
# untracked hooks in the same directory. A hook sees a
# detached HEAD (a check that applies only on a named branch does not fire here, so run that check
# separately). A process that creates a file in the very instant Git is writing is outside what any Git
# checkout guards. These refuse a landing and touch nothing: branch.<name>.mergeOptions is read for the
# signature options only and not every Git spelling is understood (an attached short-option argument such
# as -mX, an abbreviated long option that takes an argument, a carriage return as a separator), which can
# refuse a branch that Git would merge; and when both gpg.program and gpg.openpgp.program are set the
# commit may pick a different signer than a plain commit would and fail.
#
# Usage: squash-land.sh <ref> <commit message>   (any directory of the checkout)
# Prints the new commit. The checkout must be on a branch, have no uncommitted changes to tracked files and
# not verify signatures. Exit 0: landed, or nothing to squash; 1: refused (a local file is in the way, a
# commit hook rejected the squash, or Git failed; the message carries Git's own text; check `git status`
# if the final step failed after Git began writing, for example on a held ref lock or an unwritable
# directory); 2: usage error, detached HEAD, no commit in HEAD, a branch that verifies signatures, or the
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
# The branch this checkout is on now; the final merge must still find it there.
DEST="$(git symbolic-ref -q HEAD || true)"
if [ -z "$DEST" ]; then
  echo "squash-land: HEAD is detached; check out the branch to land on" >&2
  exit 2
fi
# The landing rule leaves a checkout with uncommitted changes to tracked files alone.
tracked_dirty() { [ -n "$(git status --porcelain --untracked-files=no)" ]; }
if tracked_dirty; then
  echo "squash-land: the checkout has uncommitted changes to tracked files; commit or set them aside" >&2
  exit 1
fi
# Repositories with submodules are out of scope. Replacing, moving or removing a submodule deletes its
# working files, ignored ones included, which neither `git status` nor --no-overwrite-ignore sees inside a
# submodule, and a commit hook can change what is staged; instead of chasing each case, any gitlink in the
# index, in HEAD or in the squash (checked again on the committed tree) refuses the landing.
# The scans run in the caller's own directory and environment (a relative GIT_DIR means something only
# there), and a scan that fails refuses the landing: an unreadable repository is not one without submodules.
scan_gitlinks() {
  local out
  if ! out="$("$@")"; then
    echo "squash-land: could not inspect the repository for submodules; nothing changed" >&2
    exit 1
  fi
  printf '%s\n' "$out" | awk '$1 == "160000" { found = 1 } END { exit !found }'
}
submodule_refusal() {
  echo "squash-land: this repository has a submodule, which this helper does not support; land through a pull request instead" >&2
  exit 1
}
if scan_gitlinks git ls-tree -r --full-tree HEAD || scan_gitlinks git ls-files --stage -- ':/'; then
  submodule_refusal
fi
WORK="$(mktemp -d "$(git rev-parse --path-format=absolute --git-common-dir)/hr-squash-land.XXXXXX")"
# Git inside the throwaway worktree. An exported GIT_DIR, GIT_WORK_TREE or GIT_INDEX_FILE would override -C
# and send the squash to this checkout, so the caller's repository environment is cleared.
cleargit() {
  env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE -u GIT_COMMON_DIR -u GIT_PREFIX \
    -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_NAMESPACE git "$@"
}
wgit() { cleargit -C "$WORK" "$@"; }
cleanup() { git worktree remove --force "$WORK" >/dev/null 2>&1 || rm -rf "$WORK"; }
trap cleanup EXIT
if ! ERR="$(cleargit worktree add --quiet --detach "$WORK" "$BASE" 2>&1)"; then
  printf 'squash-land: could not check out HEAD in a throwaway worktree, nothing changed:\n%s\n' "$ERR" >&2
  exit 1
fi
# The detached worktree does not match branch-conditional config (includeIf onbranch), so the identity and
# signing settings this checkout would use for a commit are passed along.
CFG=()
for key in user.name user.email user.signingkey commit.gpgSign gpg.format gpg.program gpg.openpgp.program \
  gpg.x509.program gpg.ssh.program; do
  if value="$(git config --get "$key")"; then
    CFG+=(-c "$key=$value")
  fi
done
# A branch that verifies signatures (merge.verifySignatures, possibly from an includeIf onbranch file, or
# branch.<name>.mergeOptions, last word wins) cannot be squashed here: the policy would have to be
# reproduced in the detached worktree, and the final merge would verify the new squash, not the task. A
# branch that turns it off (mergeOptions --no-verify-signatures over a config value) is merged unverified.
VERIFY="$(git config --type=bool --get merge.verifySignatures || true)"
# Git uses the last mergeOptions value and splits it like a command line: quotes group, a backslash escapes
# the next character. Options that take an argument (-m, -F, -s, -X, --message, ...) swallow the next word,
# so a word that only looks like --verify-signatures there is not the option. An option may be abbreviated;
# --verify and --no-verify are different options (hooks), so an abbreviation has to reach past the hyphen.
split_cmdline() {
  TOKENS=()
  local s="$1" c q="" cur="" has=0 i
  for ((i = 0; i < ${#s}; i++)); do
    c="${s:i:1}"
    if [ -n "$q" ]; then
      if [ "$c" = "$q" ]; then
        q=""
      elif [ "$c" = "\\" ] && [ "$q" = '"' ]; then
        i=$((i + 1))
        cur+="${s:i:1}"
      else
        cur+="$c"
      fi
    else
      case "$c" in
        "'" | '"') q="$c" has=1 ;;
        "\\") i=$((i + 1)) cur+="${s:i:1}" has=1 ;;
        " " | $'\t' | $'\n')
          if [ "$has" = 1 ]; then
            TOKENS+=("$cur")
            cur="" has=0
          fi
          ;;
        *) cur+="$c" has=1 ;;
      esac
    fi
  done
  if [ "$has" = 1 ]; then TOKENS+=("$cur"); fi
}
split_cmdline "$(git config --get "branch.${DEST#refs/heads/}.mergeOptions" || true)"
skip=0
for opt in ${TOKENS[@]+"${TOKENS[@]}"}; do
  if [ "$skip" = 1 ]; then
    skip=0
    continue
  fi
  case "$opt" in
    --message | --file | --strategy | --strategy-option | --into-name | --cleanup) skip=1 ;;
    -[mFsX] | -[!-]*[mFsX]) skip=1 ;;
    --verify-* | --no-verify-*)
      if [[ "--verify-signatures" == "$opt"* ]] && [ "${opt#--verify-}" != "$opt" ]; then
        VERIFY=true
      elif [[ "--no-verify-signatures" == "$opt"* ]] && [ "${opt#--no-verify-}" != "$opt" ]; then
        VERIFY=false
      fi
      ;;
  esac
done
if [ "$VERIFY" = true ]; then
  echo "squash-land: this branch verifies signatures; land through a pull request instead" >&2
  exit 2
fi
# merge.ff=false or only would reject --squash, so it is overridden for this one merge.
if ! ERR="$(wgit -c merge.ff=true ${CFG[@]+"${CFG[@]}"} merge --squash --quiet --no-verify-signatures "$TASK" 2>&1)"; then
  if [ -n "$(wgit diff --name-only --diff-filter=U)" ]; then
    echo "squash-land: merging $1 into HEAD has a conflict; resolve it first" >&2
    exit 2
  fi
  printf 'squash-land: merging %s failed, nothing changed:\n%s\n' "$1" "$ERR" >&2
  exit 1
fi
if wgit diff --cached --quiet; then
  echo "squash-land: $1 adds nothing to HEAD" >&2
  exit 0
fi
# A task that adds a submodule is out of scope as well.
if scan_gitlinks wgit ls-files --stage -- ':/'; then submodule_refusal; fi
# A relative core.hooksPath may name a directory that is not tracked, so it is absent from the throwaway
# worktree; it is resolved to an absolute path of this checkout. A directory the squash itself tracks,
# including one the task adds, is used from the throwaway worktree instead (checked once the squash is
# staged), so a task that adds or changes a tracked hook is checked by it.
HOOKS="$(git rev-parse --path-format=absolute --git-path hooks)"
TOP="$(git rev-parse --show-toplevel)"
case "$HOOKS" in
  "$TOP")
    HOOKS="$WORK"
    ;;
  "$TOP"/*)
    if [ -d "$WORK/${HOOKS#"$TOP"/}" ]; then
      HOOKS="$WORK/${HOOKS#"$TOP"/}"
    fi
    ;;
esac
if ! ERR="$(wgit -c core.hooksPath="$HOOKS" ${CFG[@]+"${CFG[@]}"} commit --quiet -m "$2" 2>&1)"; then
  printf 'squash-land: the commit was refused, nothing changed:\n%s\n' "$ERR" >&2
  exit 1
fi
SQUASH="$(wgit rev-parse HEAD)"
if scan_gitlinks wgit ls-tree -r --full-tree "$SQUASH"; then submodule_refusal; fi
if [ "$(git symbolic-ref -q HEAD || true)" != "$DEST" ]; then
  printf 'squash-land: the checkout moved to another branch meanwhile; the branch did not move\n' >&2
  exit 1
fi
if tracked_dirty; then
  echo "squash-land: tracked files changed meanwhile; the branch did not move" >&2
  exit 1
fi
if ! ERR="$(git merge --ff-only --no-squash --no-autostash --no-overwrite-ignore "$SQUASH" 2>&1 >/dev/null)"; then
  printf 'squash-land: refused; the branch did not move:\n%s\n' "$ERR" >&2
  exit 1
fi
if [ "$(git rev-parse HEAD)" != "$SQUASH" ] || [ "$(git rev-parse --verify --quiet "$DEST")" != "$SQUASH" ]; then
  echo "squash-land: the merge did not advance $DEST to the squash commit; check git status" >&2
  exit 1
fi
printf '%s\n' "$SQUASH"
