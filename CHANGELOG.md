# Changelog

Notable changes to house-rules. Versions follow [semantic versioning](https://semver.org).

## 0.5.13 - 2026-10-04

- Swarmail modifier: a session whose register hook already named it at
  session start uses that name and does not call `macro_start_session` or
  `register_agent` for another. Elsewhere it registers with
  `macro_start_session`, passing its name as `agent_name` when it has one.
  Before this change the rule told every agent to call
  `macro_start_session` before its first edit, and agents that did so
  without the session tag got a second name.

## 0.5.12 - 2026-10-04

- plain-prose: `scripts/check.mjs` lists the spots in a draft the skill asks
  you to reread: em dashes and other dash stand-ins, colons between two
  clauses, curly quotes, filler phrases, and the words in the skill's two
  word tables, which it reads from SKILL.md. It skips code, URLs, text in
  straight double quotes, block quotations and kept passages, and exits 1
  when it finds anything. "Check the result" tells the agent to run it first.

## 0.5.11 - 2026-10-04

- Core § Writing: before a public name is settled (project, repository,
  package, command or MCP server), search the package registries it could
  publish to and GitHub, and for an MCP server the official MCP registry,
  Glama and awesome-mcp-servers. Exact and near matches are reported beside
  the candidate; the user picks. A near match, ignoring case and separators,
  differs by one letter or contains the candidate whole.

## 0.5.10 - 2026-10-04

- `writing-for-agents` § Pruning: a rule a check can enforce lives in the
  check. The document keeps the reason, the deliberate exceptions and the
  check's name. A new mechanical rule gets a check in the same change or is
  marked unchecked.
- `read-x-links`: a fourth step keeps a post's claims apart from what its
  linked source shows, reports what the tool actually does, and names claims
  with no evidence behind them.

## 0.5.9 - 2026-10-04

- LICENSE names the copyright holder as Aaron Queen instead of the GitHub
  handle bompus. The license terms are unchanged.

## 0.5.8 - 2026-10-04

- End-of-reply eval README: results of the first `--baseline` run on seven
  models, three runs each. The rules passed 62 of 63 replies, a one-sentence
  instruction 26 and no rules 21. The main README links the result.

## 0.5.7 - 2026-10-04

- End-of-reply eval: `--baseline` also runs every scenario with a
  one-sentence instruction in place of the rules and with no rules, prints
  each arm's passes, and warns about a scenario that passes in every arm.
  The rules arm alone sets the exit status. The idea of a no-skill arm comes
  from QingYunA/agent-html's eval runner; no code was copied.

## 0.5.6 - 2026-10-04

- Core § Implementation economy: the second time the same mistake or
  instruction comes up, it is encoded in structure before prose, in this
  order: a type, a lint rule, a test or check script, a shared helper, a
  runtime check. A written rule is the fallback when none of these would fail
  or block the mistake if it happened again.

## 0.5.5 - 2026-10-04

- Core § Reporting: the answer and anything the user must read or act on go
  in the reply's text after its last tool call. When a question card ends the
  reply, that text comes after every other tool call, right before the card.
  In one reply the requested links were written before a status
  check and never reached the user: the transcript held only a reasoning
  summary of them.

## 0.5.4 - 2026-10-04

- `question-cards`: no card when the choice depends on content only the text
  carries, such as images, tables, code, links or a long comparison. That
  offer goes as text alone. Each card option's description must stand on its
  own. On one host the card showed before the text written ahead of it, and
  the user had to answer without the screenshots the text held.

## 0.5.3 - 2026-10-04

- `question-cards`: asking the user to choose between options is an offer,
  even when the user asked to be asked, so it gets the full text offer on
  every host, with or without a card. A one-line question, a line saying the agent will ask, or no text
  does not count. Card labels keep the offer's codes, with an example. In a
  check where the user asked to be asked, three of five models sent little or
  no text before the card, and three used labels without codes.

## 0.5.2 - 2026-10-04

- `effort-estimates`: the first paragraph is split in two, so each stays
  under the 900-character paragraph limit some downstream configuration
  checks enforce. The wording is unchanged.

## 0.5.1 - 2026-10-04

- `effort-estimates`: a reply that moves an earlier quote shows the earlier
  figure beside the new one and names the evidence that moved it. The number
  of review and fix rounds comes from the comparable run, or from the task's
  own rounds so far, instead of assuming one. Asked how much time remains
  without a named scope, the agent answers for the whole task and gives any
  running benchmark, build, test suite or CI run its own labeled finish time.

## 0.5.0 - 2026-10-04

- New `question-cards` modifier. On hosts with a multiple-choice question
  tool, every offer is also sent as a question card, in the same reply right
  after the complete text offer. Without such a tool the text offer goes
  alone, and the agent does not look for a substitute. It also covers how an
  agent that delegates work answers a worker's card.
- `coded-offers`: a question card goes in the same reply, right after the
  text offer, instead of in its own later reply. In a check across agent
  hosts, a model given the old wording ended its reply after the text and
  never sent the card. Another section of the rules can now ask for a card,
  as well as a skill or plugin.
- `house-rules-setup` asks whether you run Swarmail and how offers should
  appear (plain, coded, or coded with a question card) before the remaining
  modifiers.

## 0.4.2 - 2026-10-03

- `effort-estimates`: the rule covers every estimate of work the session or its
  workers would do, in prose as well as in options. It never quotes human
  developer time (days, focused days, sprints) for that work. An estimate from
  a worker, doc or other model is converted to the session's wall-clock time
  with a comparable run, or dropped, never relayed as given. Workers are asked
  for scope (pieces, files, unknowns) rather than effort.

## 0.4.1 - 2026-10-03

- Core: before installing or enabling a third-party plugin, hook, skill that
  ships scripts or MCP server, check on a local copy what it can reach
  (commands, file writes, network hosts, skipped permission prompts, text added
  to the model's context). It uses the host's static listing where one exists,
  such as `claude plugin validate` for Claude Code mods from 2.1.287, and
  reads the scripts and server code the listing leaves out. Anything beyond
  the extension's stated purpose goes to the user before it is installed.

## 0.4.0 - 2026-10-03

- `install.ps1`: the installer for Windows 10 and 11
  (`irm .../install.ps1 | iex`), with the same runtime choice, environment
  variables and kept skills directory as `install.sh`. It runs under Windows
  PowerShell 5.1 and PowerShell 7. The checkout goes to
  `%LOCALAPPDATA%\house-rules`.
- `install.sh` and `install.ps1`: a run in the same second as the previous one
  keeps its own backup of the skills directory instead of nesting it inside the
  earlier backup.
- `.gitattributes` checks text files out with LF line endings on every
  platform.
- `stock-ui-audit`: findings name files with forward slashes on Windows too.
- CI also runs the tests on Windows.

## 0.3.0 - 2026-10-03

- `install.sh`: a one-line installer for Linux and macOS. It picks the newest
  Bun 1.4 or newer, otherwise the newest Node.js 22 or newer, clones or
  updates the checkout, creates a starter config when there is none and
  composes the rules file and skills. A previous skills directory is kept
  under a dated name, never deleted. The README quick start leads with it and
  keeps the manual steps for Windows and custom checkouts.

## 0.2.10 - 2026-10-03

- `effort-estimates`: the same rule in fewer words, so the paragraph stays
  under the 900-character ceiling a composing layer checks.

## 0.2.9 - 2026-10-03

- `effort-estimates`: before calling an estimate unmeasured, search for a
  comparable finished run (the same kind of work with the same waits) in logs,
  plan entries, pull request timestamps and earlier session transcripts, and
  say where you looked. An estimate is unmeasured only when no such run has
  both start and end times. A quote stays the same in later replies unless new
  evidence moves it.

## 0.2.8 - 2026-10-03

- Core: the end-of-task checkout check reads only your own branches
  (`git log <yours> --not --remotes`), since checkouts
  share branches and `--branches` or a bare `HEAD` can list another session's. The report covers
  your own leftovers; other sessions' work stays out of it unless it blocks
  yours.
- `squash-landing`: an app-managed checkout left on a landed branch is the
  app's to retire and goes unmentioned; a dirty or doubtful one is recorded
  where the task is tracked.

## 0.2.7 - 2026-10-03

- `plain-prose`: the description says it applies even to a short message or
  reply, so the skill loads when an agent drafts a Slack reply, an email or an
  issue comment for a person. In Claude Code routing tests it loaded for 14 of
  18 such prompts across two skill catalogs, up from 0 of 9 on one catalog
  before the change. It kept loading for closing reports and stayed off
  agent-instruction edits, quick answers and code.

## 0.2.6 - 2026-10-03

- `plain-prose`: the description names the final report on a task, so the
  skill loads when an agent writes it. In Claude Code routing tests on two
  skill catalogs, it loaded for 5 of 6 closing-report prompts, up from 0 of 6,
  and still stayed off agent-instruction edits, quick answers and code.

## 0.2.5 - 2026-10-03

- Core: keep a list of every checkout you touch, outside ones included, and
  check each before ending a task; name the owner of work you leave, or say it
  is unknown. When asked to send text through a channel you cannot reach, hand
  over the exact text instead of posting it another way.
- `coded-offers`: what calls for a closing offer, where its candidates come
  from, and that a candidate held by a "don't start until asked" safeguard
  stays listed as "(Not Recommended)".
- `plan-files`: check every `blocked-on-user` plan at session start, point at
  the plan or handoff that owns an item, and sweep other sessions' plans only
  when the user asks what is waiting on them.
- `scratch-on-disk`: a harness's pre-approved temp path does not override it;
  write in-progress receipts straight to their final location.
- `writing-for-agents`: how Claude Code's eval runner selects several cases and
  where its replies land.

## 0.2.4 - 2026-10-03

- New `multi-agent` modifier for work split across delegated workers and
  several agent hosts. A worker report with open items and no named blocker
  goes back as a checkpoint; implementers get only load-bearing constraints
  while style and judgment stay with the reviewer and anything checkable moves
  into tooling; cleanup checks every installed host's sessions, including idle
  and resumable ones, before deleting a branch, directory or worktree.

## 0.2.3 - 2026-10-03

- `squash-landing`: merge only after a review bot's check finishes and each
  finding is fixed or answered, including findings outside the diff that it
  posts in the review body instead of as threads. Landing never switches,
  resets or removes the session's own checkout; after the merge the checkout
  moves onto the fetched base (or detaches there when another worktree holds
  the base), and each landing updates the task list and any handoff before the
  task worktree is retired.

## 0.2.2 - 2026-10-03

- `plain-prose` covers more habits: no em dashes and no stand-in marks for
  them, colons only before a list or example, straight quotes, a list of
  overused words and abstract stand-in nouns with plain replacements,
  figurative prose, unnamed authorities, fake ranges, weak adverbs and
  judgment words without a baseline. It also checks for new uniform habits
  left by heavy editing, recurring replacement phrases and paragraph openers
  that read like a summary, allows an uneven quiet sentence, and leaves
  passages the author marks to keep.

## 0.2.1 - 2026-10-03

- `stock-ui-audit`'s scanner: a `)` inside a comment no longer ends a gradient
  early; an unclosed `gradient(` reads only its own line instead of borrowing
  colors from the rest of the file; a violet color after a gradient on its
  closing line is still reported; large files scan in linear time; and large
  `--json` output is no longer cut off when piped.

## 0.2.0 - 2026-10-03

- Eight new skills: `api-exposure-check`, `change-impact`, `explain-code`,
  `extract-shared-steps`, `lean-plan`, `maintainability-review`,
  `plain-prose` and `stock-ui-audit`. `stock-ui-audit` ships a
  dependency-free scanner (`scripts/scan.mjs`, Node.js 22+ or Bun) with its
  tests.

## 0.1.7 - 2026-10-03

- § Finishing work: the end-of-task checkout check is one command per
  checkout, run once. In a measured run, sessions spent two to six tool calls
  per small task on separate status and log checks.

## 0.1.6 - 2026-10-03

- The composer and eval runner need Node.js 22 or newer, or Bun 1.4 or newer;
  the README, setup skill and eval README now say so. CI also runs the tests
  and the example composition under Bun.

## 0.1.5 - 2026-10-02

- `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1). Reports go through the
  repository's private reporting form, so no address is published.

## 0.1.4 - 2026-10-02

- Issue forms for a rule an agent misread and for a script bug, and a pull
  request checklist.

## 0.1.3 - 2026-10-02

- `CONTRIBUTING.md`, and CI that runs the composer, grader and skill tests,
  oxlint and oxfmt on every push and pull request.
- Every version from 0.1.0 on is tagged `v<version>` with a GitHub release.
- README: the composer test command now lists its files, so it runs on
  Node 22 (`node --test test/` needs a newer Node).

## 0.1.2 - 2026-10-02

- `swarmail` modifier: when you won't act on a request, or can't yet, reply
  to the sender with the reason. Pausing your own work for another session
  is allowed when you can resume it; pause between steps instead of
  suspending a process, and tell the sender and the user.

## 0.1.1 - 2026-10-02

- `test-audit`: authoring-gate question 2 lists more production changes a
  test should catch: a wrong argument, an empty or default return, and a
  missing check for empty, nil, unauthorized or malformed input.

## 0.1.0 - 2026-10-02

First public release.

- Core rules (`rules/core.md`), led by the end-of-reply check that tells an
  agent when to keep working and when to stop and ask.
- Eleven opt-in modifiers: coded-offers, effort-estimates, land-when-done,
  low-quota-handoff, no-attribution, plan-files, scratch-on-disk,
  shared-host-load, solo-operator, squash-landing and swarmail.
- `compose.mjs` (Node 22 or later) builds one rules file and one skills
  directory from core, the enabled modifiers and your own layers.
- Thirteen skills, including `house-rules-setup`, which walks a user through
  choosing modifiers and installing the result for their agent hosts.
- An end-of-reply eval with its scenarios and grader, and example person and
  project layers.
