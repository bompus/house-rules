#!/usr/bin/env bash
# Cursor Agent: HOME is redirected so ~/.cursor rules, hooks and MCP servers are not loaded;
# its login directory (~/.config/cursor, or EOR_CURSOR_CONFIG) is symlinked in. The workspace
# is created under /tmp, outside the real home, because cursor-agent also loads
# ~/.cursor/rules/*.mdc as rules of every directory below the home. Prompt on stdin, reply on
# stdout. EOR_MODEL (default grok-4.7-high) picks the model. The prompt is an argument (about
# 128 KB at most), and stdin is </dev/null.
EOR_TMPDIR=/tmp
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
real_config=${EOR_CURSOR_CONFIG:-$HOME/.config/cursor}
mkdir -p "$eor_tmp/home/.config"
ln -s "$real_config" "$eor_tmp/home/.config/cursor"
cd "$eor_work"
HOME=$eor_tmp/home nice -n 10 timeout 900 \
  cursor-agent -p --mode ask --trust --model "${EOR_MODEL:-grok-4.7-high}" --workspace "$eor_work" \
  "$(cat "$eor_tmp/prompt.txt")" < /dev/null 2> "$eor_tmp/err.txt" || { cat "$eor_tmp/err.txt" >&2; exit 1; }
