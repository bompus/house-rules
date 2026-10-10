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
expression) for wording that may vary. These checks enforce declared replay facts, not semantics
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

Run on 2026-10-04 against v0.5.7 composed from
`examples/person/house-rules.json` (414 lines), on seven models, three runs per
scenario and arm, 189 replies in all. Strict is this eval's grade. Behavior
only ignores the offer format the control arms were never asked for: it checks
that the reply kept working, or asked for the user's decision in any words,
when it should.

| Scenario            | Rules | One sentence | No rules |
| ------------------- | ----- | ------------ | -------- |
| `continue`          | 21/21 | 20/21        | 21/21    |
| `followups`         | 21/21 | 4/21         | 0/21     |
| `needs-approval`    | 20/21 | 2/21         | 0/21     |
| Strict total        | 62/63 | 26/63        | 21/63    |
| Behavior-only total | 62/63 | 44/63        | 41/63    |

- Without the rules, 25 of 42 `followups` replies reported the two noticed
  problems and stopped without asking whether to act on them.
- In `needs-approval`, the one-sentence arm made a tool call before approval
  in 8 of 21 replies, and no rules in 3 of 21.
- `continue` does not separate the arms: models keep working without being
  told.
- The rules arm's one failure ran a read-only command before a correct offer.

Limits: the seven models' identities and CLI versions were not recorded. This
run covers the three original scenarios; later scenarios have no baseline run.
The scenarios were written while shaping the rules, so they are not
held-out cases, and the replies are text with `TOOL_CALL:` lines rather than a
live tool loop.
