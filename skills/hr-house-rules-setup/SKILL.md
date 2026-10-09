---
name: hr-house-rules-setup
description: "Set up or change house rules for this user: pick opt-in modifiers, create the personal layer, compose the rules file and connect it to each agent host. Use when the user asks to install, configure or change their house rules or modifiers."
disable-model-invocation: true
---

# House rules setup

The user's choices live in a personal layer, by default
`~/.config/house-rules/`: `house-rules.json`, plus optional `rules/` and
`skills/` directories. Composition never edits host files; connecting a host
is a separate step the user approves.

The commands below use `node`. If only Bun is installed, replace `node` with
`bun` in every `compose.mjs` command.

For a user working directly in a terminal, use `node compose.mjs setup` for
numbered selection, review and explicit save. Read `docs/configuration.md`
for commands and safeguards. Saving completes only configuration selection;
composition and approved host connection remain separate steps below.
For an agent running without a terminal, use the preview/apply workflow below.

1. Find the house-rules checkout (the directory holding `compose.mjs`;
   `install.sh` puts it in `${XDG_DATA_HOME:-~/.local/share}/house-rules`,
   `install.ps1` in `%LOCALAPPDATA%\house-rules`).
   When there is none, ask the user where to clone it.
   Done when the checkout and the user's config path are known.
2. Inspect `node compose.mjs config status --config <path>`.
   If status reports legacy skill names, stop inspection. Read the config and follow
   `docs/skill-names.md` before continuing. If catalog or status reports
   `unknown modifier` or `question-cards requires coded-offers`, read the config
   for current choices. Follow `docs/configuration.md` and preview the user's
   selection in step 3
   with `--disable-modifier <name>` or `--questions`.
   For any other status failure, show the error and preserve the existing file
   or filesystem object. Show skill choices from the README's Skills table and
   known personal skill directories. Stop before `config set`, composition or
   host writes. Ask the user how to repair the configuration or select a usable
   path. For `config must be a regular file, not a symlink or directory`, ask
   them to select or create a regular config file. Resume this step after the
   agreed repair or selected path passes `config validate`.
   Preserve existing selections. Fresh installers use the sample config's small
   skill set with no modifiers. When initializing a missing config manually,
   show `examples/person/house-rules.json` and get the user's selection before
   creating it; the CLI treats a missing config as the legacy full skill set.
   Explain the current selection briefly. Ask about additions only when the
   user's stated workflow needs them, or they ask to customize it. Use
   `config catalog` to find those choices; show the full catalog only on request.
   Personal skills override shipped ones. Keep independent names, layers,
   unrelated settings and exclusions.

   If the user wants Swarmail, offer its modifier. When its MCP tools are absent,
   point to https://github.com/bompus/swarmail and ask before installing it.
   If they want different question presentation, offer plain text, coded text,
   or coded text with cards using `--questions plain|coded|cards`. Cards still
   require a complete text offer. Explain that host, provider and model behavior
   varies; card availability and presentation are unverified until checked.
   Both text-only choices prohibit card tools. If personal rules still request
   cards, resolve that conflict before changing those rules or composing.
   Done when the user selects relevant changes or keeps the current setup.

3. Use `node compose.mjs config set --config <path>` with the selected
   modifier and skill toggles or question preset. It previews
   without saving. Read every change and personal rule override; resolve any
   conflict before writing. Repeat those flags with `--apply --expect <revision>`
   using the preview's revision. Done when it exits 0 and status confirms the
   selection. A stale revision requires a fresh preview, not a blind retry.
   The CLI preserves layers, custom settings and unrelated exclusions; it
   does not edit personal rule prose or connect hosts. Read
   `docs/configuration.md` for flags, write safeguards and lock recovery.
   Create `rules/` and `skills/` beside the config when the user needs them.
   Explain the file format once. A rules file starts with frontmatter naming
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
     Place the `house-rules-references/` directory beside that file, because
     the written rules link to it.
   - Hosts with a settings screen for user rules: paste the stdout output of
     `node compose.mjs --config <path>`, which keeps the procedures inline.
     Keep everything else in those files. Done when every chosen host is
     connected or the user declined it.
6. For skills, compose them with `--skills-out <dir>` into a directory that
   does not exist yet or is empty; when the previous run's directory is in the
   way, ask before removing it. Then point or copy each host's skills
   directory at it, again with approval.
7. When the user asks to evaluate reply behavior, use `evals/end-of-reply/run.mjs`
   against their selected models.

For a repository, suggest the pointer pattern in `examples/project/AGENTS.md`:
point at § End of every reply and § Offers instead of restating them, and add
only what the project changes.
