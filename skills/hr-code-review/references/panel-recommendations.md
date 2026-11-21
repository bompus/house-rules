# Panel recommendations

Load this only during [panel setup](panel-setup.md) or when the user asks for
recommendations. [`panel-recommendations.json`](panel-recommendations.json) holds
the entries; this page says how to read them.

The entries are dated suggestions for choosing seats, not measured guarantees,
capability tiers or required seat counts. A model or effort here can be absent from
a user's catalog, over their limit or excluded by them; the user's limits win.

## Profiles

| Profile    | Intended use                                  | Starting shape                                              |
| ---------- | --------------------------------------------- | ----------------------------------------------------------- |
| `quick`    | A bounded question with an objective verifier | Two eligible independent models, limited reply scope        |
| `balanced` | A substantive review with explicit criteria   | Two models, with an explicitly permitted residual tie-break |
| `deep`     | A broad or difficult review the user selected | A named larger panel, with receipt checks and adjudication  |

The `quick` and `deep` profiles have no entry yet; current entries are tagged
`balanced` only. The only recorded evidence here, the Bug Hunt board,
measures single model-and-effort runs on a find-every-planted-bug task. It does not
test a two-model panel with a limited reply scope, or a larger panel with receipt
checks and adjudication, so tagging an entry `quick` or `deep` would extrapolate.
For those profiles, suggest only the shape in the table and the user's own limits,
and say that no recorded evidence backs a seat choice.

## Reading an entry

Each entry (`kind: "board"` unless it says otherwise) names the task the evidence measures, the exact model and effort, the
harness and route, the source URL, the date it was checked, the number of runs, the
quality metric and its definitions of time and cost, the limits of the evidence and
why it is suggested. A value that was not recorded is the string `unknown`.

- Compare entries only on the same board and conditions. A board's task time is not
  a host's time to finish.
- Public list prices are not a user's subscription billing.
- A `status` other than `current` (`superseded`, `withdrawn`, `unverified`) stays
  listed with its evidence and is not suggested.

## Updating

The catalog is generated, so do not edit [`panel-recommendations.json`](panel-recommendations.json)
by hand. `scripts/refresh-recommendations.mjs` builds it from three files in this
folder: the source spec (`panel-recommendations.sources.json`: which board rows each
entry uses, plus the route, limits and advice that no board states), the board
snapshot (`panel-board-snapshot.json`: the board's current rows, fetched by
`--fetch`) and the own results (`panel-recommendations.own.json`). `--check` runs
offline, with no clock and no network, and fails when the catalog is not what those
files generate.

Check an entry again when a model, route, price or benchmark correction changes the
choice, and when preparing a release. Only changed entries need new evidence. An
update shows the old and suggested choices, the evidence date, the expected
tradeoff and the uncertainty; the user confirms before any saved preference
changes, and installing a newer catalog leaves saved profiles and bindings alone.

An entry with `kind: "own-evaluation"` is a maintainer's own result: model, effort,
defects found of the total, false share, minutes a review and a one-line cohort
description, with `provenance: "own-evaluation"` and no public source. It comes from
a case set this repository does not publish, so it cannot be reproduced here and does
not compare with the board entries. The generator accepts only a fixed set of plain
fields for it (no paths, links, addresses, credentials or free text beyond the cohort
line) and refuses any extra name the maintainer lists in a deny file.
