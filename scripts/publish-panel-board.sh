#!/usr/bin/env bash
# Puts the regenerated snapshot and catalog on the refresh branch, without ever rewriting work that is not the job's
# own and without a new commit when the branch already holds this board. The branch is overwritten only when every
# commit on it that main lacks was made by the workflow bot and touches only the two generated files; it is then
# replaced with a lease on the SHA that was read. Run from a full clone of main with the regenerated files in place.
#
# Usage: BRANCH=panel-board-refresh scripts/publish-panel-board.sh
# Prints ready=true (the branch holds this board) or ready=false (the branch holds other work and was left alone;
# the script then exits 1, so the run is red) to $GITHUB_OUTPUT when set. REMOTE (default origin) names the remote.
set -euo pipefail
cd "$(dirname "$0")/.."

branch="${BRANCH:?set BRANCH to the refresh branch}"
remote="${REMOTE:-origin}"
refs=skills/hr-code-review/references
files=("$refs/panel-board-snapshot.json" "$refs/panel-recommendations.json")
bot_email="41898282+github-actions[bot]@users.noreply.github.com"
out="${GITHUB_OUTPUT:-/dev/stdout}"

# A JSON file from stdin without the dates every fetch rewrites.
shape() {
  jq -S 'del(.fetched, .reviewed) | if .entries then .entries |= map(del(.checked)) else . end'
}

# The branch holds work that is not the job's: leave it alone and fail the run, so a stuck refresh is seen.
refuse() {
  echo "::error::$1; left alone. Delete or merge the branch so the weekly refresh can continue."
  echo "ready=false" >>"$out"
  exit 1
}

lease=()
if git ls-remote --exit-code --heads "$remote" "$branch" >/dev/null 2>&1; then
  git fetch --no-tags "$remote" "$branch"
  tip="$(git rev-parse FETCH_HEAD)"
  # Every commit the branch has that main lacks must be the bot's and touch only the generated files.
  while read -r commit; do
    [ -n "$commit" ] || continue
    # A merge commit (GitHub's "Update branch" makes one) lists no files of its own, so it is never the job's.
    if [ "$(git log -1 --format=%ae "$commit")" != "$bot_email" ] \
      || [ "$(git rev-list --parents -n 1 "$commit" | wc -w)" -ne 2 ]; then
      refuse "$branch has a commit that is not the workflow's, or is a merge ($commit)"
    fi
    while read -r name; do
      [ -n "$name" ] || continue
      if [ "$name" != "${files[0]}" ] && [ "$name" != "${files[1]}" ]; then
        refuse "$branch has a commit that touches $name ($commit)"
      fi
    done < <(git diff-tree --no-commit-id --name-only -r "$commit")
  done < <(git rev-list "$tip" "^HEAD")
  same=true
  for file in "${files[@]}"; do
    if [ "$(shape <"$file")" != "$(git show "$tip:$file" | shape)" ]; then
      same=false
    fi
  done
  if [ "$same" = true ]; then
    echo "$branch already holds this board; nothing pushed"
    echo "ready=true" >>"$out"
    exit 0
  fi
  lease=("--force-with-lease=refs/heads/$branch:$tip")
fi

git config user.name "github-actions[bot]"
git config user.email "$bot_email"
git checkout -B "$branch"
git add -- "${files[@]}"
git commit -m "Panel recommendations: refresh the board snapshot and catalog"
git push ${lease[@]+"${lease[@]}"} "$remote" "$branch"
echo "ready=true" >>"$out"
