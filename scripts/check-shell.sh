#!/usr/bin/env bash
# Format check (shfmt) and lint (shellcheck) for the tracked shell scripts: the
# *.sh and *.bash files plus extensionless files whose first line is a sh or bash
# shebang.
#
# shfmt gets its style as flags, so a script is formatted the same whatever its
# name: with flags given, shfmt ignores .editorconfig, whose sections match by
# file name and cannot select extensionless files. shellcheck reads .shellcheckrc.
#
# Usage: scripts/check-shell.sh [file...]  (files given: check only those)
set -euo pipefail
cd "$(dirname "$0")/.."

SHFMT_FLAGS=(-i 2 -bn -ci)

# Reads tracked paths on stdin; prints the shell scripts among them.
shell_files() {
  local f
  while IFS= read -r f; do
    case "${f##*/}" in
      *.sh | *.bash) echo "$f" ;;
      *.*) ;;
      *) [ -f "$f" ] && head -n 1 "$f" | grep -qE '^#!.*[/ ](ba)?sh( |$)' && echo "$f" ;;
    esac
  done
  return 0
}

if [ $# -gt 0 ]; then
  files=("$@")
else
  # Test fixtures stay as they were captured.
  # A read loop rather than mapfile, which Bash 3.2 (the macOS default) lacks.
  files=()
  while IFS= read -r f; do
    files+=("$f")
  done < <(git ls-files -- ':!:skills/*/test/fixtures/**' | shell_files)
fi

shfmt "${SHFMT_FLAGS[@]}" -d "${files[@]}"
shellcheck "${files[@]}"
