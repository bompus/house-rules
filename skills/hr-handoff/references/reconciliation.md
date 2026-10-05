# Reconcile a handoff against its sources

Keep a JSON receipt beside the human-readable handoff. It accounts for the
source records you reviewed and the candidates you extracted. It does not
replace reading their content or reviewing context-only classifications.

## Collect independent source snapshots

Review the current transcript and the preceding handoff's source transcript
when available. Include linked plans, child ledgers, schedules, pending
decisions and owned Git work. Use the host's existing export and session-search
tools. Preserve source IDs and text rather than exporting only the items you
already remembered.

Normalize each source into a JSON object with a `records` array. Each record
has a unique `id` and its original `text`. Record the original location and
snapshot or range in the receipt's `snapshot` field. Name records by stable
message IDs or ledger row IDs. Several records can map to the same item.

When a record establishes a disposition, add an `outcome` with `item` and
`state`, plus `at` as a UTC ISO timestamp. States are `done`, `open` and
`deferred`. Use the evidence's time, not the export time. A later request or
current contradictory evidence that reopens completed work also sets
`outcome.reopens` to `true`. These annotations are reviewed judgments.

Record each expected count from independent export metadata or ledger
inventory. Use `null` when the total is unknown. A count is for the declared
snapshot or range; it does not establish coverage outside that range.
Describe missing, omitted, truncated or unavailable content in `gaps`.
Keep sensitive snapshots local and redact secrets before normalization.

## Fill the receipt

Copy the fictional [receipt example](../assets/receipt.example.json) and its
[session snapshot](../assets/source.example.json) and
[child ledger](../assets/ledger.example.json) into persistent notes. Replace
their contents with this session's evidence. Source `file` paths resolve
relative to the receipt; the checker reads only explicitly named snapshots.

- `version` is `1`; `owner` names this session. `coverage` is `complete` or
  `partial`. Claim complete only for the declared source ranges with known
  counts and no known gaps.
- Each `sources` entry has `id`, `file`, `snapshot`, `expectedRecords` and
  `gaps`. Include inaccessible sources and their limitations rather than
  silently dropping them.
- Every source record gets one `accounting` row with `source` and `record`.
  Add nonempty `items` containing extracted item IDs, or a `context` reason
  explaining why the record creates no candidate. Review user requests and
  assistant commitments and options before assigning context-only status.
- Each `items` entry has `id`, `owner`, `state`, `evidence` and `next`.
  Evidence references use `{ "source": "source-id", "record": "record-id" }`.
  Include the latest declared outcome. For deferred work, `next` gives its
  trigger; for done work, give its result and any separately tracked follow-up.
- `git` records `scope`, `checkedAt` and `evidence`, plus explicit `ownedPrs`,
  `dependencyPrs` and `commitsWithoutPr` arrays. Empty arrays are checked
  results, not omitted fields. For no repository work, say so in `scope` and
  reference the evidence for that conclusion.
- Every PR has `url`, `owner`, `state`, `checkedAt`, `evidence` and `next`.
  PR states are `open`, `closed` and `merged`. Put every owned unlanded PR in
  `ownedPrs`; distinguish dependency PRs owned by another session.
  Owned PRs must match the receipt owner. Dependencies confer no landing
  authority. Query all touched repositories; host-linked PR lists alone can
  omit work.
- Own commits without a PR have `repo`, `branch`, `sha`, `owner`, `evidence`
  and `next`. Inspect checkout state and remote containment as the repository
  requires. Do not infer landing from a closed PR alone.

Use UTC ISO timestamps such as `2025-01-01T10:01:00Z`. State the query scope
and check time; this offline checker does not refresh Git or PR state.

Preserve already-selected work and the latest unanswered offer, including its
scope. Questions, inbox notices and other owners' messages grant no new
authorization. Reconcile a stale open row with later completion evidence;
record a later reopening separately.

## Run the offline check

From this skill's directory, replace the receipt path with its saved location:

```sh
node scripts/check-reconciliation.mjs <receipt.json>
```

Bun runs the same script. It prints JSON with status, counts, missing IDs,
errors, coverage gaps and limits. It does not write files or query hosts.
Repeating the command on unchanged inputs repeats no external action.

| Exit | Meaning | Action |
| --- | --- | --- |
| `0` | Supplied accounting and declared outcomes are mechanically complete | Review the semantic coverage and saved handoff before claiming all items were addressed. |
| `1` | Malformed input, missing accounting or contradictory declared state | Resolve the reported fields and IDs within the handoff's stop boundary. |
| `2` | Valid accounting with partial coverage | Save the limitations and known next action; do not label coverage complete. |

The checker cannot detect a promise hidden behind a context-only annotation,
an omitted source, a falsely complete export or an omitted PR query scope.
Its success checks supplied evidence, not every possible task or current
external state. Report those limits beside the result.

## Low-quota stop

Write essential current state, Git ownership and next action first. Save known
coverage and missing sources when feasible. Keep the partial handoff even if
its receipt is unfinished or the checker reports errors. Do not recover a
transcript, run new evaluations or continue substantive work to make the
checker pass. The skill's low-quota stop takes precedence over reconciliation.
