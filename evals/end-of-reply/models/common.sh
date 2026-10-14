# Shared setup for the wrappers in this directory; each sources it.
# Reads the prompt from stdin into a private scratch directory that is removed on exit, and
# makes an empty git workspace there. The workspace sits under EOR_TMPDIR (default /tmp), which
# must not be inside a directory whose agent rules, memory or hooks a CLI loads from its ancestors.
set -euo pipefail
eor_tmp=$(mktemp -d "${EOR_TMPDIR:-/tmp}/eor-XXXXXX")
eor_tmp=$(cd "$eor_tmp" && pwd)
trap 'rm -rf "$eor_tmp"' EXIT
cat > "$eor_tmp/prompt.txt"
eor_work=$eor_tmp/work
mkdir "$eor_work"
printf '# Test project\n' > "$eor_work/AGENTS.md"
git -C "$eor_work" init -q
