#!/usr/bin/env bash
# Codex CLI: an isolated CODEX_HOME holding only a symlink to the login file, so the user's
# AGENTS.md, config, skills and rules are not loaded. Prompt on stdin, reply on stdout.
# EOR_MODEL (default gpt-6.1-sol) picks the model; EOR_CODEX_AUTH names the login file
# (default ~/.codex/auth.json).
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
mkdir "$eor_tmp/codex-home"
auth=${EOR_CODEX_AUTH:-$HOME/.codex/auth.json}
case $auth in /*) ;; *) auth=$PWD/$auth ;; esac
ln -s "$auth" "$eor_tmp/codex-home/auth.json"
CODEX_HOME=$eor_tmp/codex-home nice -n 10 timeout 900 \
  codex exec -m "${EOR_MODEL:-gpt-6.1-sol}" -c model_reasoning_effort="${EOR_EFFORT:-high}" \
  -s read-only --skip-git-repo-check --ephemeral --ignore-rules -C "$eor_work" \
  -o "$eor_tmp/reply.txt" - < "$eor_tmp/prompt.txt" > "$eor_tmp/log.txt" 2>&1 \
  || { cat "$eor_tmp/log.txt" >&2; exit 1; }
cat "$eor_tmp/reply.txt"
