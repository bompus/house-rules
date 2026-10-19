#!/usr/bin/env bash
# OpenCode: XDG_CONFIG_HOME points at an empty config so ~/.config/opencode/AGENTS.md is not
# loaded, and its fallback to ~/.claude/CLAUDE.md is off; its login in the data directory still
# applies. Prompt on stdin, reply on stdout.
# EOR_MODEL (default opencode-go/muse-spark-1.3-contributor) picks the model.
# `opencode run` hangs while stdin is an open pipe, so the prompt goes in on stdin from a file
# (which also keeps it out of the process list). Its header goes to stderr.
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
mkdir -p "$eor_tmp/config/opencode"
cat >"$eor_tmp/config/opencode/opencode.json" <<'JSON'
{"$schema":"https://opencode.ai/config.json","autoupdate":false}
JSON
cd "$eor_work"
XDG_CONFIG_HOME=$eor_tmp/config OPENCODE_DISABLE_CLAUDE_CODE_PROMPT=1 nice -n 10 timeout 600 \
  opencode run --standalone -m "${EOR_MODEL:-opencode-go/muse-spark-1.3-contributor}" \
  <"$eor_tmp/prompt.txt" 2>"$eor_tmp/err.txt" || {
  cat "$eor_tmp/err.txt" >&2
  exit 1
}
