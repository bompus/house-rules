#!/usr/bin/env bash
# Refetches the public Bug Hunt board for the panel recommendations catalog and says whether anything but the
# dates changed. When it did, the catalog is checked and the skill's tests run before the caller commits it.
# Own results are never read: a fetch keeps the catalog's own entries as they are.
#
# Usage: scripts/refresh-panel-board.sh   (prints changed=true or changed=false; to $GITHUB_OUTPUT when set)
set -euo pipefail
cd "$(dirname "$0")/.."

refs=skills/hr-code-review/references
script=skills/hr-code-review/scripts/refresh-recommendations.mjs
out="${GITHUB_OUTPUT:-/dev/stdout}"

# The files without the dates every fetch rewrites (the fetch date, the review date, each entry's checked date).
shape() {
  jq -S 'del(.fetched, .reviewed) | if .entries then .entries |= map(del(.checked)) else . end' "$1"
}
before_snapshot="$(shape "$refs/panel-board-snapshot.json")"
before_catalog="$(shape "$refs/panel-recommendations.json")"

bun "$script" --fetch

if [ "$before_snapshot" = "$(shape "$refs/panel-board-snapshot.json")" ] \
  && [ "$before_catalog" = "$(shape "$refs/panel-recommendations.json")" ]; then
  git checkout -- "$refs"
  echo "the board is unchanged"
  echo "changed=false" >>"$out"
  exit 0
fi

bun "$script" --check
bun test skills/hr-code-review test/doc-rules.test.mjs
echo "changed=true" >>"$out"
