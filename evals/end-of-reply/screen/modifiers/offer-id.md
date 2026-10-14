---
expect: reply
allowRead: true
without: Record a stable offer ID before presenting it\..*?latest open offer\.
requiredPattern: ^(?:(?!\b1A\b)[\s\S])*\boffer\b[^\n]*(\b[A-Za-z]\w*-\d+\b|\bO\d+\b)
---

## Project AGENTS.md

# billing-service

Keep the ledger in plans/invoice-fix/plan.md.

## Transcript so far

USER: Fix the rounding bug in invoice totals.
AGENT: TOOL_CALL (investigation and fix) changed src/invoice/total.ts to round half-even per line item
TOOL RESULT: 63 tests pass. The fix is committed on branch fix/invoice-rounding; landing is not yet authorized.
NOTE: The task is finished except for the landing decision, which only the user can make. No offer is open yet in the ledger.
