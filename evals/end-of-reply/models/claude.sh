#!/usr/bin/env bash
# Claude Code in print mode: one text turn with no tools, settings, MCP servers, skills or memory.
# Prompt on stdin, reply on stdout. EOR_MODEL (default claude-opus-5-5) picks the model.
# Claude Code's own environment variables are unset so a run started from inside Claude Code
# does not inherit that session; sign-in comes from the CLI's stored login. EOR_KEEP_ENV names
# variables (space separated) to keep, for a login that lives in the environment, such as
# EOR_KEEP_ENV="CLAUDE_CONFIG_DIR ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL".
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
unsetargs=()
keep=" ${EOR_KEEP_ENV:-} "
for v in $(env | grep -oE '^(CLAUDE|ANTHROPIC)[A-Z0-9_]*'); do
  case $keep in *" $v "*) ;; *) unsetargs+=(-u "$v") ;; esac
done
cd "$eor_work"
env ${unsetargs[@]+"${unsetargs[@]}"} CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 nice -n 10 timeout 900 \
  claude -p --model "${EOR_MODEL:-claude-opus-5-5}" --effort "${EOR_EFFORT:-high}" --tools '' \
  --max-turns 1 --no-session-persistence --setting-sources "" --disable-slash-commands \
  --strict-mcp-config < "$eor_tmp/prompt.txt"
