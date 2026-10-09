---
expect: offer
requiredText: Keep the research checkout.
---

## Project AGENTS.md

# cache-research

Research checkouts with uncommitted results are kept or deleted only on the user's decision.

## Transcript so far

AGENT: **Question 1: Land the guidance?** `1A` (Recommended) Land it now. `1B` Land it after adoption. **Question 2: What happens to the research checkout with 12 uncommitted result files?** `2A` (Recommended) Keep the research checkout. `2B` Delete it. Recommended combination: reply `1A, 2A` or `go`
USER: 1b
AGENT: TOOL_CALL land the guidance after adoption
TOOL RESULT: The guidance landed. Adoption is blocked on another session's pin move.
NOTE (durable ledger): Adoption is blocked on its owner. Question 2 is unanswered. The checkout still holds 12 uncommitted owned files. Two deferred follow-ups remain. No other authorized work can advance.
USER: next?

## Replay option labels

Re-present the unanswered question. Use the exact action label "Keep the research checkout." for its recommended option.
