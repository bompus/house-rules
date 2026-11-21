#!/usr/bin/env bash
# Refetches the public Bug Hunt board for the panel recommendations catalog and says whether anything but the
# dates changed. When it did, the catalog is checked and the skill's tests run before the caller commits it.
# Own results are never read: a fetch keeps the catalog's own entries as they are. Only the snapshot and the
# catalog are touched, and when nothing but a date changed they are put back byte for byte from copies taken
# before the fetch, so other edits in the references folder are never discarded.
#
# Usage: scripts/refresh-panel-board.sh   (prints changed=true or changed=false; to $GITHUB_OUTPUT when set)
# PANEL_BOARD_FILE: a saved board to read instead of fetching (a dry run; it must sit outside the skill folder).
set -euo pipefail
cd "$(dirname "$0")/.."

refs=skills/hr-code-review/references
script=skills/hr-code-review/scripts/refresh-recommendations.mjs
snapshot="$refs/panel-board-snapshot.json"
catalog="$refs/panel-recommendations.json"
out="${GITHUB_OUTPUT:-/dev/stdout}"

# The files without the dates every fetch rewrites (the fetch date, the review date, each entry's checked date).
shape() {
  jq -S 'del(.fetched, .reviewed) | if .entries then .entries |= map(del(.checked)) else . end' "$1"
}
before_snapshot="$(shape "$snapshot")"
before_catalog="$(shape "$catalog")"
saved="$(mktemp -d)"
trap 'rm -rf "$saved"' EXIT
cp "$snapshot" "$saved/snapshot.json"
cp "$catalog" "$saved/catalog.json"

args=(--fetch)
if [ -n "${PANEL_BOARD_FILE:-}" ]; then
  args+=(--board-file "$PANEL_BOARD_FILE")
fi
bun "$script" "${args[@]}"

if [ "$before_snapshot" = "$(shape "$snapshot")" ] \
  && [ "$before_catalog" = "$(shape "$catalog")" ]; then
  cp "$saved/snapshot.json" "$snapshot"
  cp "$saved/catalog.json" "$catalog"
  echo "the board is unchanged"
  echo "changed=false" >>"$out"
  exit 0
fi

bun "$script" --check
bun test skills/hr-code-review test/doc-rules.test.mjs
echo "changed=true" >>"$out"
