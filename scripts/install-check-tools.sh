#!/usr/bin/env bash
# Installs into DIR the Python and shell check tools that `npm run check` runs:
# ruff, shfmt and ShellCheck. Each is a pinned upstream release binary, checked
# against its published SHA-256 digest. Linux x86_64 only; CI runs it, and
# elsewhere any install of the same versions works.
#
# Usage: scripts/install-check-tools.sh DIR
set -euo pipefail

ruff_version=0.17.1
ruff_sha256=a293ac937715ae6fb6b64da86761598379e6149f40fbc00fde9ba8a2a562ac65
shellcheck_version=0.11.0
shellcheck_sha256=b7af85e41cc99489dcc21d66c6d5f3685138f06d34651e6d34b42ec6d54fe6f6
shfmt_version=3.14.1
shfmt_sha256=76e77641faa025814b77f153b29796b8e6fa2fca03e0c76a691608b86c7ea7bf

dir="${1:?usage: install-check-tools.sh DIR}"
mkdir -p "$dir"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# fetch NAME URL SHA256 MEMBER: downloads URL, checks SHA256 and installs NAME.
# MEMBER is the path inside a .tar.gz, or empty for a bare binary.
fetch() {
  local name="$1" url="$2" sha256="$3" member="$4"
  curl -fsSL -o "$work/$name.download" "$url"
  printf '%s  %s\n' "$sha256" "$work/$name.download" | sha256sum -c --quiet
  if [ -n "$member" ]; then
    tar -xzf "$work/$name.download" -C "$work" "$member"
    install -m 0755 "$work/$member" "$dir/$name"
  else
    install -m 0755 "$work/$name.download" "$dir/$name"
  fi
}

fetch ruff \
  "https://github.com/astral-sh/ruff/releases/download/${ruff_version}/ruff-x86_64-unknown-linux-gnu.tar.gz" \
  "$ruff_sha256" ruff-x86_64-unknown-linux-gnu/ruff
fetch shellcheck \
  "https://github.com/koalaman/shellcheck/releases/download/v${shellcheck_version}/shellcheck-v${shellcheck_version}.linux.x86_64.tar.gz" \
  "$shellcheck_sha256" "shellcheck-v${shellcheck_version}/shellcheck"
fetch shfmt \
  "https://github.com/mvdan/sh/releases/download/v${shfmt_version}/shfmt_v${shfmt_version}_linux_amd64" \
  "$shfmt_sha256" ""

"$dir/ruff" --version
"$dir/shellcheck" --version | grep '^version:'
"$dir/shfmt" --version
