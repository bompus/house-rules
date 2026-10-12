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
statement. A scenario may declare `requiredCall` or `requiredText` for its exact
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
options but not in the prose around the offer. A run's result lists `behavior` (the expectation met, including the offer
shape the rules ask for: the recommendation marker, the reply line, at least one option
and, with `--coded`, the coded form) and `declared` (the scenario's own labels,
calls and patterns held). `pass` needs both, and `--baseline` prints a
`behavior only` line, so a wrong label shows as a declared-check miss, not a
changed turn. The call checks are heuristics over free-text descriptions, tuned on real
replies: a command chained after a ledger write is found only when it starts
with a known command word. These checks enforce declared replay facts, not semantics
for arbitrary replies.

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
