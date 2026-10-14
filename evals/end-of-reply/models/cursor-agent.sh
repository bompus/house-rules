#!/usr/bin/env bash
# Cursor Agent: HOME is redirected so ~/.cursor rules, hooks and MCP servers are not loaded;
# its login directory (~/.config/cursor, or EOR_CURSOR_CONFIG) is symlinked in. The workspace
# is created under /tmp, outside the real home, because cursor-agent also loads
# ~/.cursor/rules/*.mdc as rules of every directory below the home. Prompt on stdin, reply on
# stdout. EOR_MODEL (default grok-4.7-high) picks the model. The prompt goes in on stdin from a
# file, so it is not visible in the process list.
EOR_TMPDIR=/tmp
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
real_config=${EOR_CURSOR_CONFIG:-$HOME/.config/cursor}
case $real_config in /*) ;; *) real_config=$PWD/$real_config ;; esac
mkdir -p "$eor_tmp/home/.config"
ln -s "$real_config" "$eor_tmp/home/.config/cursor"
cd "$eor_work"
HOME=$eor_tmp/home nice -n 10 timeout 900 \
  cursor-agent -p --output-format text --mode ask --trust --model "${EOR_MODEL:-grok-4.7-high}" --workspace "$eor_work" \
  < "$eor_tmp/prompt.txt" 2> "$eor_tmp/err.txt" || { cat "$eor_tmp/err.txt" >&2; exit 1; }
