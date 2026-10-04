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

Add `--baseline` to see what the rules add. Each scenario then also runs with
a one-sentence instruction in place of the rules, and with no rules at all.
The run prints each arm's passes, such as `rules 9/9, one-line 6/9, no-rules
3/9`, and a `WARN` line for any scenario that passes every run in every arm,
since such a scenario cannot show an effect. The two control arms are graded
without `--coded`, and only the rules arm sets the exit status.
