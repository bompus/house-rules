# Changelog

Notable changes to house-rules. Versions follow [semantic versioning](https://semver.org).

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
