---
name: house-rules-setup
description: "Set up or change house rules for this user: pick opt-in modifiers, create the personal layer, compose the rules file and connect it to each agent host. Use when the user asks to install, configure or change their house rules or modifiers."
disable-model-invocation: true
---

# House rules setup

The user's choices live in a personal layer, by default
`~/.config/house-rules/`: `house-rules.json`, plus optional `rules/` and
`skills/` directories. Composition never edits host files; connecting a host
is a separate step the user approves.

1. Find the house-rules checkout (the directory holding `compose.mjs`;
   `install.sh` puts it in `${XDG_DATA_HOME:-~/.local/share}/house-rules`,
   `install.ps1` in `%LOCALAPPDATA%\house-rules`).
   When there is none, ask the user where to clone it. Done when
   `node compose.mjs --list` prints the modifiers. When only Bun is installed,
   run this and the compose step below with `bun` in place of `node`.
2. Read the existing `house-rules.json` if there is one. Show the modifiers
   from `--list` with their descriptions and the ones already enabled, and ask
   which to enable in one question where any combination is allowed. When
   the user enables `swarmail` and the Swarmail MCP tools are not available,
   point them to its install steps (https://github.com/bompus/swarmail) and
   ask before installing anything. Done when the user has answered.
3. Write `house-rules.json` with the chosen `modifiers`. On a later run, keep
   any existing `layers` and `skills.exclude` unchanged. Create `rules/` and `skills/` beside it.
   Explain the file format once: a rules file starts with frontmatter naming
   `replaces:`, `after:`, `before:` or `removes:` and a core heading, then its
   own `## ` heading; without frontmatter it is appended at the end. A skill in
   the personal `skills/` replaces the house-rules skill of the same name.
4. Run `node compose.mjs --config <path> --out <personal dir>/rules.md`. Done
   when it exits 0; on an error, show it and fix the named file.
5. Ask which hosts the user runs, then show what connecting each one changes
   and ask before writing:
   - Claude Code: add `@<personal dir>/rules.md` on its own line in
     `~/.claude/CLAUDE.md`.
   - Hosts without file includes (for example a global `AGENTS.md`): copy the
     composed file there between `<!-- house-rules:start -->` and
     `<!-- house-rules:end -->` lines, replacing only that block on later runs.
   - Hosts with a settings screen for user rules: paste the composed file.
   Keep everything else in those files. Done when every chosen host is
   connected or the user declined it.
6. For skills, compose them with `--skills-out <dir>` into a directory that
   does not exist yet or is empty; when the previous run's directory is in the
   way, ask before removing it. Then point or copy each host's skills
   directory at it, again with approval.
7. Offer to run `evals/end-of-reply/run.mjs` against the user's models.

For a repository, suggest the pointer pattern in `examples/project/AGENTS.md`:
point at § End of every reply and § Offers instead of restating them, and add
only what the project changes.
