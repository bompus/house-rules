---
name: hr-usage-report
description: Measure where Claude Code, Codex and OpenCode usage went by provider, model and role, and chart model comparisons as HTML. Use for quota or cost questions and to show a model or role recommendation visually.
---

# Usage report

Answer quota and model-role questions from measured usage and published
evidence, then show the result as charts and tables. Run the scripts from this
skill's directory with Bun.

## 1. Measure where usage went

```bash
bun scripts/usage-by-model.ts --days 7 [--providers claude,codex,opencode] [--prices <api.json>] [--json]
```

It reads Claude Code transcripts (`~/.claude/projects`), Codex rollouts
(`~/.codex/sessions`) and the OpenCode database, all read-only and local. It
prices each request at [models.dev](https://models.dev) list rates, including
long-context tiers, and splits usage by provider, model and role: main session,
subagent, advisor. Without `--prices` it downloads `https://models.dev/api.json`;
that request carries no local data. Use `--since <ISO>` for a fixed start.

Read the output beside the provider's live quota readings:

- **Shares, not dollars.** List price stands in for subscription quota; no
  provider publishes the conversion. Say so in the report.
- **Cache reads.** When cache reads dominate a row's cost, context length, not
  the model's output, drives usage. Compare the main-request context median
  with the session-start median: the gap is conversation growth; the start is
  fixed overhead (system prompt, rules, tool schemas).
- **Advisor rows.** Each advisor call re-reads the whole transcript uncached at
  the advisor's rates; a few calls can outweigh many main turns.
- **Cross-provider work.** The same table shows what the author's sessions and
  another vendor's reviewer each cost.
- **Unpriced models.** The summary lists models models.dev has no price for;
  report them rather than dropping them.

## 2. Pick evidence by question

| Question                              | Evidence                                                             | Read                                                                |
| ------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Quality per dollar for implementation | Agentic coding boards that publish effort, harness and cost per task | Score against cost at every effort; cost per solved task            |
| Review and bug finding                | Bug-finding boards with run counts per row                           | The effort curve; treat single runs as noisy                        |
| Raw speed                             | Output tokens per second                                             | Generation speed only                                               |
| Task speed                            | Boards that time whole tasks                                         | Time to finish; a model that generates faster can still take longer |
| Fit for your own work                 | A known-answer trial on your own tasks (`hr-benchmarking`)           | Correctness and model time per task shape                           |

Compare models at the same effort and harness, or say they differ. A vendor
table that sets one model's top effort against another's lower effort is not a
matched comparison. Keep token speed and task time in separate charts; never
infer one from the other.

## 3. Render the report

Write a data file, then:

```bash
bun scripts/render-report.ts <data.json> <out.html>
```

The page is self-contained, follows the host's theme variables when it is
embedded, and falls back to a dark surface. `assets/example-report.json` uses
every section type.

The data file declares `series` once, so each model keeps one color across
every chart in the report: up to three colored series with slots 0 to 2, and at
most one `"reference": true` series drawn dashed and neutral. The renderer
rejects a fourth colored series because no fourth hue passes the color-vision
check on the dark surface against the other three. Compare more models in a
second report file.

Section types:

- `curve`: points with `x`, `y`, `label`, `tip` per series; `xLog`, domains,
  ticks and axis affixes. Use for score against cost across efforts.
- `ladder`: `categories` (usually efforts) and `values` per series, `null` for a
  missing row, optional `notes` such as run counts.
- `bars`: `rows` of `label`, `key`, `value`, optional `display` and `tip`.
- `pair`: two sections side by side, such as token speed beside task time.
- `table`: `columns` and `rows`; a cell may be `{ "text", "verdict": "yes" | "maybe" | "no" }`;
  `numeric` lists right-aligned column indexes.

End with one verdict table per model or role: role, key evidence with numbers,
verdict. Name the evidence date in the title, and apply any model or effort
limits the user has set before recommending a configuration.
