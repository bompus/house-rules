#!/usr/bin/env bash
# OpenCode: XDG_CONFIG_HOME points at an empty config so ~/.config/opencode/AGENTS.md is not
# loaded; its login in the data directory still applies. Prompt on stdin, reply on stdout.
# EOR_MODEL (default opencode-go/muse-spark-1.3-contributor) picks the model.
# `opencode run` hangs while stdin is an open pipe, so it gets </dev/null and the prompt as an
# argument (about 128 KB at most). Its header goes to stderr.
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
mkdir -p "$eor_tmp/config/opencode"
printf '{"$schema":"https://opencode.ai/config.json","autoupdate":false}\n' > "$eor_tmp/config/opencode/opencode.json"
cd "$eor_work"
XDG_CONFIG_HOME=$eor_tmp/config nice -n 10 timeout 600 \
  opencode run --standalone -m "${EOR_MODEL:-opencode-go/muse-spark-1.3-contributor}" \
  "$(cat "$eor_tmp/prompt.txt")" < /dev/null 2> "$eor_tmp/err.txt" || { cat "$eor_tmp/err.txt" >&2; exit 1; }
