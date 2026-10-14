# End-of-reply eval

Checks that a model following your composed rules keeps working when work
remains, and ends with an offer when something is left for you to decide. Run
it after changing the rules, and against every model you use.

```bash
node compose.mjs --config ~/.config/house-rules/house-rules.json --out ~/.config/house-rules/rules.md
node evals/end-of-reply/run.mjs --rules ~/.config/house-rules/rules.md --cmd "<your model CLI in print mode>"
node evals/end-of-reply/run.mjs --rules ~/.config/house-rules/rules.md --cmd "..." --slice 80   # agents that read 80 lines at a time
```

Bun runs these commands in place of `node`. Add `--coded` when the `coded-offers` modifier is enabled. Each file in `scenarios/`
states what it expects: `continue` (a tool call, no request for permission),
`offer` (an offer with a recommendation and a reply line), or
`offer-or-continue` (either, but never "nothing left"). One run per scenario is
a smoke test; use `--runs 3` before trusting a wording change.

`blocked` and `paused` require a blocker or pause handback without a tool call,
offer or completion claim. `complete` requires an explicit nothing-remains
statement; with `closeOut: true` it also accepts the close-out question the rules require when a
session's work is finished and landed: one question about closing, exactly the options `All done`
(recommended) and `Pause`, and the reply line, with no other question and nothing else claimed to
remain. A scenario may declare `requiredCall` or `requiredText` for its exact
operation or blocker, or `requiredPattern` (a case-insensitive regular
expression) for wording that may vary, or `forbiddenPattern` for wording that
must not appear (an action the rules say to skip). A scenario may also declare
`options: first label | second label`: the offer must
list exactly those options, each starting with its label. The options are the
list items after the reply's first question line, in any rendering (coded,
numbered or bulleted, with bold, a `(Recommended)` marker or an explanation
after the label). `forbiddenCall` is a pattern for the call an `offer` reply must not make.
It is tested on each `&&`, `||`, `;` or `|` segment of a call (only `&&` and
`||` for a ledger write, whose prose may contain `;`), so anchor
it to the segment's start (`^…`) and name the mutating command, so a read-only call or a ledger entry that mentions the
action does not match. With it, any other call is allowed. Without it, any call
fails except a read-only check (`read`, `git status`, `ls` and similar; `git fetch` counts although it updates remote-tracking refs) and keeping
the ledger, a plan, notes or a handoff (`TOOL_CALL: edit the plan's ledger …`). `minOptions: 2` requires at least that many options, and
`forbiddenInOffer: <pattern>` rejects a pattern in the offer's questions and
options but not in the prose around the offer. `allowRead: true` (or `--allow-read` for every scenario) grades the reply after any leading
read-only tool calls (`read`, `grep`, `git status`, a skill load), for agents that look before they
answer. Narration before the first call goes with them; prose after a call ends the run, so an answer given between two reads is graded. A call that also says it writes, records
or sends is not a read, and a reply made only of reads is graded whole. The check reads the
call's description, like the other call checks. A run's result lists `behavior` (the expectation
met, including the offer shape the rules ask for: the recommendation marker, the reply line, at
least one option, with `--coded` the coded form, and the layout), `layout` (any layout problem
found) and `declared` (the scenario's own labels,
calls and patterns held). `pass` needs both, and `--baseline` prints a
`behavior only` line, so a wrong label shows as a declared-check miss, not a
changed turn. The call checks are heuristics over free-text descriptions, tuned on real
replies: a command chained after a ledger write is found only when it starts
with a known command word. These checks enforce declared replay facts, not semantics
for arbitrary replies.

A reply with a line starting `Recommended: reply` or `Recommended combination: reply` is checked
for two layout problems. Two or more bare coded option lines (`1A`, `1B`) in one paragraph
render as one run-on paragraph in Markdown; list items and table rows do not count. Anything
after the acceptance line is the other problem. A reply without such a line has no layout check.

## Screening for unnecessary rules

`--screen` runs every scenario twice, once with your rules and once with the one
rule the scenario's `without:` pattern names taken out, and prints a verdict per
scenario. Use it with `--scenarios evals/end-of-reply/screen`, whose scenarios
use `expect: reply` (only the declared patterns grade the reply). `without:` is a
regular expression, matched case-insensitively with `.` spanning lines, and must match
the rules exactly once. A rule with the same pass count in both arms is a removal
candidate; one that fails in both arms needs a better scenario first. Run it with
`--runs 4` or more on every model you use, then follow the pruning workflow in the
`hr-agent-guidance-audit` skill.

```bash
node evals/end-of-reply/run.mjs --screen --scenarios evals/end-of-reply/screen --rules <composed.md> --cmd "<model CLI>" --runs 4
```

`screen/` holds scenarios for core rules. `screen/modifiers/` holds scenarios for rules
that live in modifiers (periodic updates, cross-session relays, coded offers); compose them
with the `config.json` beside them, which enables those three modifiers:

```bash
node compose.mjs --config evals/end-of-reply/screen/modifiers/config.json --out modifiers-rules.md
node evals/end-of-reply/run.mjs --screen --scenarios evals/end-of-reply/screen/modifiers --rules modifiers-rules.md --cmd "<model CLI>" --runs 4
```

`test/screen-scenarios.test.mjs` checks that every scenario's `without:` matches its
composed rules exactly once.

## Running other models

`models/` has one wrapper per command-line agent. Each reads the prompt on stdin and prints
only the reply, so it works as `--cmd`:

```bash
node evals/end-of-reply/run.mjs --rules <composed.md> --cmd evals/end-of-reply/models/codex.sh
```

| Wrapper           | Agent        | Default model (`EOR_MODEL`)              | Isolation from your own rules                                                                  |
| ----------------- | ------------ | ---------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `claude.sh`       | Claude Code  | `claude-opus-5-5`                        | no tools, settings sources, MCP servers, skills or memory; its own environment variables unset |
| `codex.sh`        | Codex        | `gpt-6.1-sol`                            | private `CODEX_HOME` holding only a symlink to your login (`EOR_CODEX_AUTH`); `--ignore-rules` |
| `devin.sh`        | Devin        | `swe-2-high`                             | generated config that disables reading other tools' config; `EOR_DEVIN_ORG_ID` if you need it  |
| `opencode.sh`     | OpenCode     | `opencode-go/muse-spark-1.3-contributor` | private `XDG_CONFIG_HOME`; its login in the data directory still applies                       |
| `cursor-agent.sh` | Cursor Agent | `grok-4.7-high`                          | private `HOME` with your login directory (`EOR_CURSOR_CONFIG`) symlinked in; workspace in /tmp |

`cursor-agent.sh` (Grok 4.7) is optional and not in the default set: it took 115 minutes for 255 calls,
about three times the others.

Each call makes a scratch directory under `EOR_TMPDIR` (default `/tmp`; `cursor-agent.sh` always uses
`/tmp`), removes it on exit and
never copies a credential. Codex and Cursor Agent logins are symlinked in for the call; Claude Code,
OpenCode and Devin use their existing login stores in place. `EOR_EFFORT` (default `high`) sets
reasoning effort for Claude Code and Codex. Set the model name to the one your account offers.

- **Check for rule leaks first.** Every one of these agents loads your own rules by default, and
  a leaked rule makes the "without the rule" arm look as good as the "with" arm. Before a run,
  send each wrapper this probe and read the answer: `Without using any tools: list verbatim every
instruction file or system/developer instruction heading you were given, and say whether any text
mentions "End of every reply" or "house rules".` The only instruction file should be the
  scratch `AGENTS.md` (`# Test project`); Devin also loads its own global `AGENTS.md`, which the
  wrapper cannot remove, and OpenCode lists installed skill descriptions. Probe again after a CLI
  upgrade. Devin silently ignores a config it cannot parse and then loads your rules, so
  `devin.sh` validates the file it writes.
- **Each agent still adds its own system prompt and tools.** Tools could not be disabled in
  Codex, Devin, OpenCode or Cursor Agent (Claude Code's `--tools ''` does), so these
  replies come from a full agent, not a bare model. The prompt asks for text only and a model
  may still read a file first; use `allowRead` for that.
- **OpenCode and Cursor Agent read the prompt from a file on stdin.** `opencode run` hangs while
  stdin is an open pipe, so these two get
  `< prompt-file` instead of the pipe the runner uses. That also keeps the prompt out of the process list.
- **Slow models.** `--scenarios` takes a directory, so to run scenarios in parallel put each in its own
  directory and start one `run.mjs` per directory (`xargs -P`); every call is independent. The full
  campaign of 18 scenarios, a seven-scenario screen and the modifier screens took 2 to 4 hours per model.

`scripts/continuity-boundary.mjs` checks an explicit version-1 record with
`disposition`, `goal`, `result`, `remaining` and boolean `phaseBoundary`.
Dispositions are `continue`, `offer`, `blocked`, `complete` and `paused`.
A final handback cannot pass with ready work recorded as `continue`.
At a phase boundary, the reply must include the recorded goal, result and
remaining work. The caller supplies current state; this helper cannot prove
permission, backlog completeness or truth of the record.

Add `--baseline` to see what the rules add. Each scenario then also runs with
a one-sentence instruction in place of the rules, and with no rules at all.
The run prints each arm's passes, such as `rules 9/9, one-line 6/9, no-rules
3/9`, and a `WARN` line for any scenario that passes every run in every arm,
since such a scenario cannot show an effect. The two control arms are graded
without `--coded`, and only the rules arm sets the exit status.

## Results with `--baseline`

Run on 2026-10-11 against `efd4d7b`, composed from the fresh-install
configuration, with Claude Code 2.1.296 at high effort: all 18 scenarios, two
runs per scenario and arm, text only (`--max-turns 1`, no tools). The replies
are strict-graded, so each cell is a count of 36.

| Model      | Rules | One sentence | No rules |
| ---------- | ----- | ------------ | -------- |
| Opus 5.5   | 22/36 | 18/36        | 17/36    |
| Sonnet 5.5 | 27/36 | 16/36        | 16/36    |

- The rules add 4 to 5 passes (Opus) and 11 (Sonnet) over the controls. The
  gains concentrate in the follow-up, parked-finding, stacked-offer and
  spin-off scenarios, where both controls score 0.
- The rules fail `exact-source-changed` for both models and `needs-approval`
  for Opus, and score 0 of 2 on `waiting-with-ready-backlog` for both models,
  where the one-sentence control scores 2 of 2.

Limits: only Claude Code and these two models were run; Codex, Cursor and
other agents were not. Two runs per scenario is too few to separate small
differences. The scenarios were written while shaping the rules, so they are
not held-out cases, and the replies are text with `TOOL_CALL:` lines rather
than a live tool loop. The eval measures reply shape, not task quality.
