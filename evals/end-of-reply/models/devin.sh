#!/usr/bin/env bash
# Devin CLI: a generated config that stops it reading Claude, Cursor, OpenCode, Windsurf and
# Codex configuration. Prompt on stdin, reply on stdout. EOR_MODEL (default swe-2-high) picks
# the model; set EOR_DEVIN_ORG_ID if your login needs an organization in the config.
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
org=
if [ -n "${EOR_DEVIN_ORG_ID:-}" ]; then org=",\"devin\":{\"org_id\":\"$EOR_DEVIN_ORG_ID\"}"; fi
printf '{"version":1,"attribution":false,"read_config_from":{"opencode":false,"cursor":false,"claude":false,"windsurf":false,"codex":false},"shell":{"setup_complete":true}%s}\n' "$org" > "$eor_tmp/config.json"
# A config Devin cannot parse is ignored silently and its defaults load your own rules.
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$eor_tmp/config.json"
cd "$eor_work"
nice -n 10 timeout 900 devin --config "$eor_tmp/config.json" --model "${EOR_MODEL:-swe-2-high}" \
  --respect-workspace-trust false --prompt-file "$eor_tmp/prompt.txt" -p 2> "$eor_tmp/err.txt" \
  | grep -v 'Welcome to Devin CLI' || { cat "$eor_tmp/err.txt" >&2; exit 1; }
