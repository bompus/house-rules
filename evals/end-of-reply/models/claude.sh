#!/usr/bin/env bash
# Claude Code in print mode: one text turn with no tools, settings, MCP servers, skills or memory.
# Prompt on stdin, reply on stdout. EOR_MODEL (default claude-opus-5-5) picks the model.
# Claude Code's own environment variables are unset so a run started from inside Claude Code
# does not inherit that session; sign-in comes from the CLI's stored login.
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
unsetargs=()
for v in $(env | grep -o '^\(CLAUDE\|ANTHROPIC\)[A-Z0-9_]*'); do unsetargs+=(-u "$v"); done
cd "$eor_work"
env "${unsetargs[@]}" CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 nice -n 10 timeout 900 \
  claude -p --model "${EOR_MODEL:-claude-opus-5-5}" --effort "${EOR_EFFORT:-high}" --tools '' \
  --max-turns 1 --no-session-persistence --setting-sources "" --disable-slash-commands \
  --strict-mcp-config < "$eor_tmp/prompt.txt"
