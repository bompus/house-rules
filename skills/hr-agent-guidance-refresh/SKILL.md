---
name: hr-agent-guidance-refresh
description: "Re-read a repository's agent guidance, meaning its instruction root and the rules, docs and skills it names, and report what changed since this session loaded it. Use for 're-read the rules', 'reload agent guidance', or resuming a session whose injected rules may be stale."
---

# Agent guidance refresh

Injected rules are a boot-time snapshot; commits during or between sessions can
move them. This skill refreshes them on request. It never replaces reading a
named rule at its trigger.

1. Read the repository's instruction root (`AGENTS.md`, `CLAUDE.md`, or the
   configured equivalent) and follow the rule and doc index it declares.
2. `git fetch`, then `git log` the guidance paths since this session started
   or the governing handoff was written. The guidance paths are instruction
   files, rules directories, agent docs, and the skills they name (repo skills
   plus the house-rules skills when they feed this host). Read what
   changed and report skill updates alongside guidance changes.
3. Update the house-rules checkout and your personal layer before comparing
   them. `git fetch`, then `git pull --ff-only` when a checkout is yours (no
   other session is working in it), clean, strictly behind its upstream, and
   the update will not overwrite local edits. Otherwise compare against the
   fetched upstream without pulling. If the pull refuses, leave the tree, report the path and the
   blocker, and compare the fetched upstream. Then re-run `compose.mjs` and
   confirm the rules file your host loads matches its output.
4. Report what changed and which standing boundaries still apply, and re-verify
   worktree state before acting on assumptions the diff invalidated.
