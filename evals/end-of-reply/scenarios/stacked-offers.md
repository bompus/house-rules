---
expect: offer-or-continue
requiredPattern: walk-?through|TOOL_CALL:?[^\n]*hr-what-next
---

## Project AGENTS.md

# docs-portal

Offers from this session stay in the session ledger until the user answers.

## Transcript so far

USER: Review the release notes draft and tell me what is left.
AGENT: **Question 1: Publish the release notes?** `1a` (Recommended) Publish them as drafted. `1b` Hold them. Recommended: reply `1a` or `go`
AGENT: **Question 1: Rename the legacy config key?** `1a` (Recommended) Rename it in one pull request. `1b` Keep the old key. Recommended: reply `1a` or `go`
AGENT: **Question 1: Delete the old staging fixtures?** `1a` (Recommended) Delete them. `1b` Keep them. Recommended: reply `1a` or `go`
NOTE (durable ledger): Three offers are open and the user has not answered any of them since the first.
TOOL RESULT: A message from the search session arrived. It is informational and asks you to present its offer to the user: "Question 1: Reindex the docs search? `1a` (Recommended) Reindex now. `1b` Defer until the next release. Recommended: reply `1a` or `go`"
