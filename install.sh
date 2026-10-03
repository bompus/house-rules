#!/bin/sh
# Installs or updates house-rules: picks a JavaScript runtime, fetches the
# checkout, creates a starter config when there is none, and composes the rules
# file and skills. It never edits agent host files and never deletes anything.
#
#   curl -fsSL https://raw.githubusercontent.com/bompus/house-rules/main/install.sh | sh
#
# Runtime: the newest Bun 1.4 or later found on PATH or in a version manager's
# directory, otherwise the newest Node.js 22 or later.
#
# Environment:
#   HOUSE_RULES_DIR         checkout (default ${XDG_DATA_HOME:-~/.local/share}/house-rules)
#   HOUSE_RULES_CONFIG_DIR  personal layer (default ${XDG_CONFIG_HOME:-~/.config}/house-rules)
#   HOUSE_RULES_REPO        clone URL (default https://github.com/bompus/house-rules.git)
#   HOUSE_RULES_RUNTIME     path to the bun or node binary to use instead of searching
#
# Option: --print-runtime prints the chosen runtime and exits.

set -eu

say() { printf '%s\n' "$*"; }
die() {
  printf 'house-rules install: %s\n' "$*" >&2
  exit 1
}

# "v22.1.0", "1.4.2" or "1.5.0-canary.1" -> "22.1.0", "1.4.2", "1.5.0".
version_of() {
  "$1" --version 2>/dev/null |
    sed -n '1s/^v\{0,1\}\([0-9][0-9]*\)\.\([0-9][0-9]*\)\.\([0-9][0-9]*\).*/\1.\2.\3/p'
}

# Succeeds when version $1 is at least version $2.
version_ge() {
  awk -v a="$1" -v b="$2" 'BEGIN {
    split(a, x, "."); split(b, y, ".")
    for (i = 1; i <= 3; i++) {
      if (x[i] + 0 > y[i] + 0) exit 0
      if (x[i] + 0 < y[i] + 0) exit 1
    }
    exit 0
  }'
}

# Every executable named $1 on PATH and in common version-manager directories.
candidates() {
  name=$1
  set -f
  old_ifs=$IFS
  IFS=:
  for d in $PATH; do
    if [ -n "$d" ] && [ -x "$d/$name" ]; then printf '%s\n' "$d/$name"; fi
  done
  IFS=$old_ifs
  set +f
  data=${XDG_DATA_HOME:-$HOME/.local/share}
  mise=${MISE_DATA_DIR:-$data/mise}
  asdf=${ASDF_DATA_DIR:-$HOME/.asdf}
  case $name in
    bun)
      set -- "$HOME/.bun/bin/bun" "$mise"/installs/bun/*/bin/bun \
        "$asdf"/installs/bun/*/bin/bun "$HOME"/.proto/tools/bun/*/bin/bun
      ;;
    node)
      set -- "${NVM_DIR:-$HOME/.nvm}"/versions/node/*/bin/node \
        "${FNM_DIR:-$data/fnm}"/node-versions/*/installation/bin/node \
        "$HOME/Library/Application Support/fnm"/node-versions/*/installation/bin/node \
        "$HOME"/.volta/tools/image/node/*/bin/node "$mise"/installs/node/*/bin/node \
        "$asdf"/installs/nodejs/*/bin/node "$HOME"/.proto/tools/node/*/bin/node
      ;;
  esac
  for f in "$@"; do
    if [ -x "$f" ]; then printf '%s\n' "$f"; fi
  done
}

# Prints the newest $1 at version $2 or later, or nothing.
newest() {
  candidates "$1" | {
    best=
    best_v=$2
    while IFS= read -r c; do
      v=$(version_of "$c") || continue
      if [ -n "$v" ] && version_ge "$v" "$best_v"; then
        if [ -z "$best" ] || ! version_ge "$best_v" "$v"; then
          best=$c
          best_v=$v
        fi
      fi
    done
    if [ -n "$best" ]; then printf '%s\n' "$best"; fi
  }
}

pick_runtime() {
  if [ -n "${HOUSE_RULES_RUNTIME:-}" ]; then
    case ${HOUSE_RULES_RUNTIME##*/} in
      bun*) min=1.4.0 ;;
      *) min=22.0.0 ;;
    esac
    v=$(version_of "$HOUSE_RULES_RUNTIME")
    if [ -z "$v" ] || ! version_ge "$v" "$min"; then
      die "HOUSE_RULES_RUNTIME=$HOUSE_RULES_RUNTIME reports '${v:-no version}', below $min"
    fi
    printf '%s\n' "$HOUSE_RULES_RUNTIME"
    return
  fi
  rt=$(newest bun 1.4.0)
  if [ -z "$rt" ]; then rt=$(newest node 22.0.0); fi
  if [ -z "$rt" ]; then
    die "needs Bun 1.4 or newer (https://bun.sh) or Node.js 22 or newer (https://nodejs.org)"
  fi
  printf '%s\n' "$rt"
}

fetch() {
  dir=$1
  if [ -f "$dir/compose.mjs" ]; then
    if [ -d "$dir/.git" ]; then
      command -v git >/dev/null 2>&1 || die "git is required to update $dir"
      git -C "$dir" pull --ff-only --quiet ||
        die "could not fast-forward $dir; update or move it by hand, then run this again"
      say "Updated $dir"
    else
      say "Using $dir as it is (not a git checkout)"
    fi
  elif [ -e "$dir" ] && [ -n "$(find "$dir" -mindepth 1 -maxdepth 1 2>/dev/null | sed -n 1p)" ]; then
    die "$dir exists but holds no compose.mjs; set HOUSE_RULES_DIR to another path"
  else
    command -v git >/dev/null 2>&1 || die "git is required to download house-rules"
    git clone --quiet --depth 1 "${HOUSE_RULES_REPO:-https://github.com/bompus/house-rules.git}" "$dir"
    say "Downloaded house-rules to $dir"
  fi
}

# Shows paths under the home directory as ~/... for the instructions.
tilde() {
  case $1 in
    "$HOME"/*) printf '~/%s\n' "${1#"$HOME"/}" ;;
    *) printf '%s\n' "$1" ;;
  esac
}

main() {
  rt=$(pick_runtime)
  if [ "${1:-}" = "--print-runtime" ]; then
    printf '%s\n' "$rt"
    return
  fi
  say "Using $rt ($(version_of "$rt"))"

  dir=${HOUSE_RULES_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/house-rules}
  cfg=${HOUSE_RULES_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/house-rules}
  fetch "$dir"

  mkdir -p "$cfg"
  if [ ! -f "$cfg/house-rules.json" ]; then
    cp "$dir/examples/person/house-rules.json" "$cfg/house-rules.json"
    say "Created $cfg/house-rules.json from the example"
  fi

  # --skills-out must be new or empty, so compose beside the old directory and
  # keep the old one under another name instead of deleting it.
  skills=$cfg/composed-skills
  next=$skills.new-$$
  "$rt" "$dir/compose.mjs" --config "$cfg/house-rules.json" --out "$cfg/rules.md" \
    --skills-out "$next" || die "compose failed; see the error above ($next may hold a partial result)"
  if [ -e "$skills" ]; then
    old=$skills.previous-$(date +%Y%m%d%H%M%S)
    mv "$skills" "$old"
    say "Kept the previous skills in $old; remove it when you no longer need it"
  fi
  mv "$next" "$skills"

  say ""
  say "Composed $(tilde "$cfg/rules.md") and $(tilde "$skills")."
  say "Connect them to your agent:"
  say "  Claude Code: add this line to ~/.claude/CLAUDE.md"
  say "    @$(tilde "$cfg/rules.md")"
  say "  Other hosts: copy rules.md into the host's user-level rules file, and"
  say "  point the host's skills directory at composed-skills."
  say "To change modifiers, edit $(tilde "$cfg/house-rules.json") (list them with"
  say "  $(tilde "$rt") $(tilde "$dir")/compose.mjs --list) and run this installer again."
}

# Runs only once the whole script has downloaded.
main "$@"
