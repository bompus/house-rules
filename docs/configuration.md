# Configure house rules

Use `node compose.mjs config help` to see the commands. Bun supports the same
interface. The CLI manages the existing `house-rules.json`; it keeps personal
layers, independent skill names and unrelated settings.

## Guided selection

Run `node compose.mjs setup --config <config-path>` in a terminal. Bun supports
the same command. The numbered flow uses ordinary line input; `--plain` selects
the same flow. Both input and output must be terminals. Redirected input or
output prints scripting instructions and exits 2 without saving. Use
`setup --json` for the existing read-only `config status --json` report.

Modifiers and skills have stable row numbers while searching. Use `toggle N`
or `toggle NAME`, with several choices separated by spaces. `search TEXT`,
`clear search`, `show selected` and `show all` change visibility only.
`help N` shows the full description, source and invocation policy.
Excluding a skill name excludes its personal override as well as the shipped
copy. Exclusions without a current source remain in the configuration.

Use `questions plain|coded|cards` for question preferences; these modifiers
are handled together rather than as individual toggles. `next` moves from
modifiers to skills, then review. `back` keeps the draft. Only `save` on review
writes configuration. Before a save attempt, `cancel`, end of input or Ctrl-C
leaves it unchanged.
A new config with no selection changes is not created.

Review includes personal rule origins and an equivalent `config set` command.
The command uses POSIX quoting on Unix and PowerShell quoting on Windows.
Personal prose can override the selected preferences; setup does not interpret
or edit it. Existing composition errors still block saving. Unknown stored
modifiers can be removed, and a question preset can repair its prerequisite.
Malformed configuration, legacy skill names and invalid layers require repair
outside setup.

If another writer changes configuration before save, setup preserves the
draft intent and refuses the stale write. Use `refresh` to compare that intent
with the fresh configuration, then explicitly save again. It never saves a
fresh comparison automatically. Saving preserves custom keys and their meaning;
the writer formats JSON, so existing whitespace is not preserved.

If verification fails after saving, configuration may already have changed.
Inspect `config status` or use `refresh` before another save. Cancelling ends
the session without undoing an earlier save attempt.

Setup saves selections only. Recompose output separately, then connect the
chosen hosts. It does not install, update, repair or remove managed output.

## Browse and inspect

```bash
node compose.mjs config catalog --config <config-path>
node compose.mjs config status --config <config-path>
node compose.mjs config validate --config <config-path>
```

`catalog` shows modifiers, skills and rule sections. `status` shows enabled
selections and effective personal sources. Both use aligned tables, with color
in a terminal and stacked rows on narrow screens. `NO_COLOR` disables color.
Use `--json` for structured output without terminal styling.

A missing config is treated as an empty selection without creating files.
Modifiers are opt-in; shipped skills are included unless excluded. The default
config path is the same as the composer uses. Pass `--config` to choose another.

Status distinguishes configured question preferences from effective rule
sources. Personal rules can override those preferences. Neither status nor
validation proves what a running agent has loaded.

## Preview and save

```bash
node compose.mjs config set --config <config-path> \
  --enable-modifier swarmail --disable-skill hr-read-reddit --questions coded
```

`set` previews by default. It shows the selection changes, composition summary,
personal rule overrides and current revision. Repeat the exact command with
`--apply --expect <revision>` to save the reviewed change. Read the new revision
from the result before another write.

Toggle flags can repeat. Enable or disable modifiers with `--enable-modifier`
and `--disable-modifier`; skills use `--enable-skill` and `--disable-skill`.
Enabling a skill removes its exclusion. Disabling one adds an exclusion, while
retaining unrelated exclusions and custom skill settings.

| Question preset | Enabled offer modifiers |
|---|---|
| `--questions plain` | Neither offer modifier |
| `--questions coded` | `coded-offers` |
| `--questions cards` | `coded-offers` and `question-cards` |

Question presets preserve other modifiers. Choose a preset or explicit offer
modifier toggles, rather than combining both in one command. Cards still depend
on the agent host, provider and model. Review any personal Offers override
before saving; the CLI does not rewrite personal prose.

To repair invalid modifier selections, preview changes that produce a valid
selection. `--questions` can repair the offer dependency; `--disable-modifier`
can remove an unknown modifier already stored in the config. Malformed config
structure, unknown enables and unknown disables absent from the config remain
errors.

`preview` accepts the same selection flags without saving. Add `--rules` to
print the composed rules, or `--json` for the full report. Unknown choices,
contradictory flags, malformed config and composition errors stop the command
before it writes configuration. Older skill names need the
[skill name upgrade](skill-names.md) before composition.

## Write safeguards

Saving requires the revision reported by status or preview. A stale revision
fails without overwriting a newer config. Cooperating CLI writers share an
exclusive `<config-path>.lock` file; a competing writer fails immediately.
The CLI writes a sibling temporary file, then replaces the config atomically.
Repeated requests leave an unchanged config's bytes and modification time alone.
A missing config is created only by explicit apply.

Manual editors do not share the lock. Avoid editing the config while a CLI
write runs. The CLI checks again before replacement, but cannot exclude a
manual write racing that final replacement. It refuses symlink config files.
If an interrupted writer leaves a lock, inspect its recorded process ID and
confirm that writer has ended before removing the lock. The CLI never removes
another writer's lock automatically.

## Compose and connect

Saving changes only configuration. Recompose with the existing composer or run
the installer again. The installer retains previous composed skill directories;
manual `--skills-out` still requires an empty or absent directory.

```bash
node compose.mjs --config <config-path> --out <rules-path> \
  --skills-out <new-skills-directory>
```

Connecting or copying that output to agent hosts remains a separate setup
step. Use `hr-house-rules-setup` for the guided workflow. Custom rule prose
still belongs in layer fragments; the protected completion sections stay
required.
