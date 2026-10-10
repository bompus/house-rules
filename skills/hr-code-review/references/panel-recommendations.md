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

## Reading an entry

Each entry names the task the evidence measures, the exact model and effort, the
harness and route, the source URL, the date it was checked, the number of runs, the
quality metric and its definitions of time and cost, the limits of the evidence and
why it is suggested. A value that was not recorded is the string `unknown`.

- Compare entries only on the same board and conditions. A board's task time is not
  a host's time to finish.
- Public list prices are not a user's subscription billing.
- A `status` other than `current` (`superseded`, `withdrawn`, `unverified`) stays
  listed with its evidence and is not suggested.

## Updating

Check an entry again when a model, route, price or benchmark correction changes the
choice, and when preparing a release. Only changed entries need new evidence. An
update shows the old and suggested choices, the evidence date, the expected
tradeoff and the uncertainty; the user confirms before any saved preference
changes, and installing a newer catalog leaves saved profiles and bindings alone.
