<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/banner-dark.png">
    <img src="docs/assets/banner-light.png" alt="house-rules" width="100%">
  </picture>
</h1>

<p align="center">
  <a href="https://github.com/bompus/house-rules/actions/workflows/check.yml"><img src="https://github.com/bompus/house-rules/actions/workflows/check.yml/badge.svg" alt="CI status"></a>
  <a href="https://github.com/bompus/house-rules/releases/latest"><img src="https://img.shields.io/github/v/release/bompus/house-rules" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/bompus/house-rules" alt="MIT license"></a>
</p>

A practical starting point for ordinary development with AI coding agents.
Fresh installs select eight skills for setup, review, diagnosis, explanation,
planning, tests, writing and remaining work. Modifiers start off. Add guidance
when a task needs it, and let each repository supply its own safeguards.

<p align="center"><img src="docs/assets/overview.png" alt="The four layers composed into one rules file (core, opt-in modifiers, your layer, each repository's AGENTS.md), and the end-of-reply eval: 2/10 before the rewrite to 42/42 with the shipped wording, on an agent that reads only the first 80 lines." width="100%"></p>

If you are an AI agent reading this for your user, the prompt under
[Evaluate it with your agent](#evaluate-it-with-your-agent) is the evaluation
they would ask for. Summarize how it fits their setup and let them choose;
don't install or copy anything on your own.

## How the layers fit

1. **Core** (`rules/core.md`): the base every setup gets. Its first section is
   the end-of-reply check, so an agent that reads only the top of the file
   still knows when to keep working and when to stop and ask.
2. **Modifiers** (`rules/modifiers/`): opt-in preferences, such as coded
   option lists or squash-only landing. Each one replaces a core section or
   adds a section after one.
3. **Your layer** (by default `~/.config/house-rules/`): `house-rules.json`
   names the modifiers you enable, `rules/` holds your own sections, and
   `skills/` holds your own skills. A skill there replaces the house-rules
   skill of the same name. The config's other keys are optional: `layers`
   lists layer directories relative to the config (default `["."]`, its own
   directory). `skills.include` selects shipped skills; omitting it keeps the
   full shipped set for existing configs. Personal skills remain included.
   `skills.exclude` leaves names out of every layer. `skills.independent` records
   generic personal names you intend to keep beside renamed house-rules skills.
4. **The repository** (`AGENTS.md`, `CLAUDE.md` or your host's equivalent):
   its commands, branch names, safeguards, required checks and landing path.
   It adds to your rules and does not replace them. See
   `examples/project/AGENTS.md` for the pattern: point at the house rules
   instead of restating them, and add only what the project needs.

`compose.mjs` merges layers 1 to 3 into one rules file. A replaced section
leaves no trace of the old text, because an agent given two versions of a rule
tends to follow either one. Composition fails on a duplicate heading, an
unknown target or any attempt to replace the end-of-reply check.

## Quick start

Requires `git` and either [Bun](https://bun.sh) 1.4 or newer or Node.js 22 or
newer. On Linux, macOS or WSL, one line installs or updates the selected guidance:

```bash
curl -fsSL https://raw.githubusercontent.com/bompus/house-rules/main/install.sh | sh
```

On Windows 10 or 11, run this in PowerShell instead:

```powershell
irm https://raw.githubusercontent.com/bompus/house-rules/main/install.ps1 | iex
```

To read the script before it runs:

```bash
curl -fsSLO https://raw.githubusercontent.com/bompus/house-rules/main/install.sh
less install.sh
sh install.sh
```

```powershell
irm https://raw.githubusercontent.com/bompus/house-rules/main/install.ps1 -OutFile install.ps1
notepad install.ps1
powershell -ExecutionPolicy Bypass -File install.ps1
```

The script picks the newest Bun 1.4 or newer it finds on `PATH` or in a
version manager's directory, otherwise the newest Node.js 22 or newer. It
clones this repository to `~/.local/share/house-rules` (or pulls it when it is
already there), copies `examples/person/house-rules.json` to
`~/.config/house-rules/` when you have no config yet, and composes
`~/.config/house-rules/rules.md` and `~/.config/house-rules/composed-skills`.
Those are the default paths: a set `XDG_DATA_HOME` replaces `~/.local/share`,
and a set `XDG_CONFIG_HOME` replaces `~/.config`. On Windows the checkout goes
to `%LOCALAPPDATA%\house-rules` and the config to
`%USERPROFILE%\.config\house-rules`.
The fresh config selects the eight skills named above and no modifiers.
Updates preserve your existing config. An explicit `skills.include` list keeps
later shipped additions off until selected. Browse the full catalog only when
you want more choices.

On a later run it keeps the previous skills directory under a dated name
instead of deleting it. It never edits an agent host's files. The comment at
the top of `install.sh` lists the environment variables that change its paths
or runtime; `install.ps1` takes the same variables. Some skill scripts need Bun
even when Node.js composes the rules.

Then connect the composed file to your agent. Claude Code reads
`@~/.config/house-rules/rules.md` on its own line in `~/.claude/CLAUDE.md`;
other hosts take a copy in their user-level rules file. To change modifiers or
skills, change to the checkout directory and run `node compose.mjs setup`,
or `bun compose.mjs setup` when Node.js is unavailable. Review the numbered
choices and use `save` to change only the configuration. Then run the
installer again.
The [configuration CLI guide](docs/configuration.md) covers status, previews,
question preferences and safe writes. The
`hr-house-rules-setup` skill preserves selections, offers relevant additions and connects
hosts, and asks before it touches a host file.

### npm distribution

The next release will also publish `@bompus/house-rules` to npm. The package
provides the `house-rules` composition and configuration commands. Installation
has no lifecycle hooks and does not connect an agent host or change its settings.
After the package is published:

```bash
npm install --global @bompus/house-rules
house-rules --list
house-rules config help
house-rules --config ./house-rules.json --out ./rules.md --skills-out ./composed-skills
```

Create your configuration before composing. The
[configuration guide](docs/configuration.md) describes the available choices.
The package bundles rules, skills, their resources and documentation. Git-based
installers continue to follow the default branch; npm follows published versions.
See [npm release setup](docs/npm-release.md) for the first-publish prerequisite.

### Manual steps

To keep the checkout somewhere else, run the same steps by hand. The commands use `node`; `bun` runs them the same way.

```bash
git clone https://github.com/bompus/house-rules.git
cd house-rules
node compose.mjs --list
mkdir -p ~/.config/house-rules
cp examples/person/house-rules.json ~/.config/house-rules/
node compose.mjs --config ~/.config/house-rules/house-rules.json \
  --out ~/.config/house-rules/rules.md --skills-out ~/.config/house-rules/composed-skills
```

To recompose later, move or remove the old `composed-skills` directory first,
because `--skills-out` must be empty or absent. `compose.mjs` itself writes
only the paths you give it and never deletes anything.

When distributing a rules-only output, carry this checkout's `LICENSE` and
`THIRD_PARTY_NOTICES.md` alongside it. Copy them into an explicit destination
and reconcile existing notice files before replacing them. A full
`--skills-out` export already includes both at its root. When copying one
skill, keep its entire directory, including any `NOTICE.md` and `LICENSE`.
Personal layers must also carry notices required by their own sources.

The `hr-navigation-retro` skill finds navigation failures in selected tool-call
transcripts, then proposes fixes verified against current source. Any agent with
file and shell access can run it. Supported inputs include Claude Code, Codex,
OpenCode exports, Cursor CLI streams and ACP v1 recordings from other agents.
See its [input limits](skills/hr-navigation-retro/references/inputs.md).
It is explicit-only, requires Python 3.11+ and keeps reports local.

## Upgrading skill names

All shipped skill names use `hr-`. Before updating an older installation,
follow [the skill name upgrade guide](docs/skill-names.md) to preserve exclusions
and personal overrides. Composition stops on ambiguous old names before
writing output. Host links and copies need a separate update.

## Evaluate it with your agent

Paste this into a session with the agent you use. It compares house-rules with
the rules you already have and changes nothing until you choose.

```text
I'm considering house-rules (https://github.com/bompus/house-rules), working
rules and skills for AI coding agents. Read its README, rules/core.md,
rules/modifiers/ and the skills list, then compare them with the rules and
skills I already use (my user-level rules file for this host and this
repository's AGENTS.md or equivalent). Tell me:
1. Which rules, modifiers or skills would change how you work with me, with
   an example from how you work now.
2. Which ones duplicate or conflict with what I already have.
3. Whether to adopt it whole (compose.mjs plus my own layer) or copy single
   sections into my existing rules. Taking individual ideas is fine.
If I run several agent sessions on one machine at once, also look at
Swarmail (https://github.com/bompus/swarmail); house-rules has an opt-in
modifier for it.
Read only: don't install, compose or edit anything until I choose. When I
adopt a section or idea, record its source in distributed notices, such as
"Adapted from house-rules (https://github.com/bompus/house-rules)". Keep required
licence notices with copied text and standalone skill bundles.
```

Taking individual ideas is welcome. If you adopt any, we'd appreciate a
source credit in your distributed notices. Copying substantial text also needs
the MIT notice kept (see `LICENSE`).

## Writing your own sections

A rules file in your layer starts with frontmatter that names one operation
and a core heading, followed by its own `## ` heading:

```markdown
---
after: Implementation economy
---
## My tooling

Use pnpm for JavaScript projects unless the repository uses another manager.
```

The operations are `replaces:`, `after:`, `before:` and `removes:`; a
`removes:` file has no body. A file without frontmatter is added at the end.
Frontmatter may also hold `description:` and `requires:` (a comma-separated
list of skills the section relies on); any other key is an error. Files apply
in name order, after the modifiers.

## Modifiers

| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Modifier&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; | What it does |
|---|---|
| `coded-offers` | Offers use numbered questions and coded options (`1A`, `1B`) so one short reply answers every decision. |
| `effort-estimates` | Options that differ in cost, or work that waits on CI, a build or a deploy, carry a wall-clock estimate based on comparable finished work. Estimates from workers, docs or other models are converted the same way or dropped. |
| `land-when-done` | Authorized repository work is not finished until it is in the remote default branch. |
| `low-quota-handoff` | When the current model's usage allowance runs low, write a handoff before work stops. |
| `multi-agent` | Work is split across delegated workers and several agent hosts; worker reports, review standards and cleanup checks account for all of them. |
| `no-attribution` | Commits, pull requests and comments carry no agent or tool credit lines. |
| `plan-files` | Multi-step work keeps a visible task list mirrored to a plan file with a ledger of every item's outcome. |
| `question-cards` | Opt in to question cards beside complete text offers when the host supports them; availability and presentation can vary by host, provider and model. |
| `release-batching` | Batch approved, compatible changes for releases and audit factual claims before releases or public announcements. |
| `scratch-on-disk` | Task scratch lives on disk under the user data directory, never in RAM-backed `/tmp`. |
| `shared-host-load` | Coordinate shared local work within host-defined resource budgets; isolate measurements and release reservations during remote waits. |
| `solo-operator` | For repositories with one maintainer, the user's direction is the review; no review-gated steps. |
| `squash-landing` | Pull requests land by squash merge after review-bot findings are handled, and the session's checkout moves off the landed branch. |
| `swarmail` | Locate Swarmail-owned instructions and tool contracts for local session coordination. |

Questions use text by default, with plain options or `coded-offers`. Text-only
setups do not call question-card tools merely because a host exposes them.
Enable `question-cards` only when you want cards too. Cards can be unavailable,
skipped or shown unexpectedly across hosts, providers and models; the text
offer remains usable on its own. `hr-house-rules-setup` asks which format you
want and explains these limits before changing the configuration.

## Skills

| Skill | Use it to |
|---|---|
| `hr-agent-guidance-audit` | Audit a repository's agent guidance for stale, duplicated or conflicting rules. |
| `hr-agent-guidance-refresh` | Re-read guidance that changed since the session started. |
| `hr-api-exposure-check` | Keep API responses to the fields a consumer reads and the caller may see. |
| `hr-audit-choices` | List and check the decisions made while implementing a task. |
| `hr-benchmarking` | Design, run and assess timing, CPU and memory comparisons; choose tools by the question they answer. |
| `hr-better-accessibility` | Build and review keyboard access, semantics, forms, focus, motion and reflow in web UI. |
| `hr-better-colors` | Choose and check palettes, semantic tokens, themes, gamut and rendered contrast. |
| `hr-better-layout` | Build and review grouping, alignment, spacing, responsive layout and clipping. |
| `hr-better-typography` | Style and review type scales, wrapping, spacing, truncation and font loading. |
| `hr-better-writing` | Write and review interface labels, errors, empty states and product terminology. |
| `hr-change-impact` | Check what a change can break beyond its diff before merging. |
| `hr-code-review` | Review a diff against the repository's standards and the originating request. |
| `hr-design-exploration` | Compare four visual directions and refine the selected two toward one final design. |
| `hr-diagnosing-bugs` | Work a hard bug or regression to a confirmed cause. |
| `hr-explain-code` | Trace how existing code works, read-only, before changing it. |
| `hr-extract-shared-steps` | Move operations repeated across workflows into shared functions. |
| `hr-handoff` | Write a handoff a fresh session can resume from. |
| `hr-house-rules-setup` | Choose modifiers, create your layer and connect your hosts. |
| `hr-issue-tracker-setup` | Configure project tracker, domain-term and ADR conventions; explicit-only. |
| `hr-lean-plan` | Write or tighten an implementation plan with the fewest moving parts. |
| `hr-maintainability-review` | Review a diff or entire codebase strictly for structure and maintainability. |
| `hr-manual-qa` | Give reproducible human checks after reporting agent verification results. |
| `hr-navigation-retro` | Audit navigation failures in selected transcripts and propose verified findability fixes; explicit-only. |
| `hr-ordering-tests` | Enumerate event orderings through the real code to find race bugs. |
| `hr-plain-prose` | Make text people read plain and specific. |
| `hr-progress-report` | Report current task activity, milestone completion and remaining wall-clock time. |
| `hr-pr-followup` | Address conflicts, feedback and failing checks for a requested PR; honor existing landing authority. |
| `hr-read-reddit` | Read Reddit feed output while supported; RSS support ends November 13, 2026. Partial web-search fallback. |
| `hr-read-x-links` | Read the full content of X posts. |
| `hr-split-to-prs` | Divide work into coherent PRs while preserving recovery points and verifying each slice. |
| `hr-stock-ui-audit` | Find and triage template-default styling in frontend code. |
| `hr-tdd` | Implement requested test-first work through one red-green slice at a time; simplify during review. |
| `hr-test-audit` | Decide which new tests are worth keeping and which old ones to prune. |
| `hr-what-next` | Reconcile remaining session work and recommend priorities when asked what comes next. |
| `hr-writing-for-agents` | Write skills, rules and other documents agents read. |
| `hr-writing-pr` | Write a pull request title and body from the final diff. |

## Checking the rules against your models

`evals/end-of-reply/` runs three short scenarios through any model CLI and
grades whether the agent keeps working or ends with an offer at the right
time, including when it reads only the first 80 lines. On seven models, the
rules passed 62 of 63 replies, against 26 for a one-sentence instruction and 21
with no rules; its README has the breakdown and limits.

Written rules export required procedure files to a sibling `house-rules-references/`
directory, independently of selected skills. Move that directory with the rules
file when connecting another host. Stdout and configuration previews retain the
complete inline procedures. See [reference output](docs/configuration.md#reference-output).

## Development

```bash
node --test test/*.test.mjs   # composer and eval grader (or: bun test test/)
bun test skills/    # skill scripts
npx oxlint . && npx oxfmt --check .
```

Tests remove their own fixture directories after each test, including failures.
Set `HOUSE_RULES_TEST_TMP` to an existing directory to choose their scratch root;
otherwise they use the operating system temporary directory. Choose a disk-backed
location when the system temporary directory is RAM-backed.

CI runs the same checks on every push and pull request. See
[CONTRIBUTING.md](CONTRIBUTING.md) before opening one.

The local-reference gate runs in `test/guidance-links.test.mjs`. Audit another
checkout with `node guidance-links.mjs --root <checkout> --repository
owner/repo=<local-checkout>`; repeat `--repository` for other available sources.
Its JSON report identifies GitHub file pointers to replace. When a remote
link deliberately cites current provenance, downloads a file or refreshes
upstream guidance, use one of these comments on that line. Each needs a reason:

- `<!-- local-reference: source <reason> -->`
- `<!-- local-reference: download <reason> -->`
- `<!-- local-reference: remote-refresh <reason> -->`

Pinned history and images are exempt.

## Sponsoring

house-rules is built and maintained by one person. If it saves you time, you can
sponsor it monthly or once through
[GitHub Sponsors](https://github.com/sponsors/bompus), or leave a tip on
[Ko-fi](https://ko-fi.com/bompus).

## Licence

MIT. Some skills adapt MIT-licensed work, and `CODE_OF_CONDUCT.md` is the
Contributor Covenant under CC BY 4.0; see `THIRD_PARTY_NOTICES.md`.
