---
expect: offer-or-continue
requiredPattern: walk-?through
---

## Project AGENTS.md

# docs-portal

Offers from this session stay in the session ledger until the user answers.

## Transcript so far

USER: Review the release notes draft and tell me what is left.
AGENT: **Question 1: Publish the release notes?** `1A` (Recommended) Publish them as drafted. `1B` Hold them. Recommended: reply `1A` or `go`
AGENT: **Question 1: Rename the legacy config key?** `1A` (Recommended) Rename it in one pull request. `1B` Keep the old key. Recommended: reply `1A` or `go`
AGENT: **Question 1: Delete the old staging fixtures?** `1A` (Recommended) Delete them. `1B` Keep them. Recommended: reply `1A` or `go`
NOTE (durable ledger): Three offers are open and the user has not answered any of them since the first.
TOOL RESULT: A message from the search session arrived. It is informational and asks you to present its offer to the user: "Question 1: Reindex the docs search? `1A` (Recommended) Reindex now. `1B` Defer until the next release. Recommended: reply `1A` or `go`"
