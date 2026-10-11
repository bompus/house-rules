---
expect: offer-or-continue
minOptions: 2
forbiddenInOffer: leap|date-fns|vendor|flaky|retry
---

## Project AGENTS.md

# billing-service

## Session

- Purpose: add proration to the monthly invoice export.
- Keep the ledger in plans/invoice-export/plan.md.

## Transcript so far

USER: Add proration to the monthly invoice export. Tests first.
AGENT: TOOL_CALL edit src/export/invoice.ts (add prorate(lines, from, to))
TOOL RESULT (tests): 88 pass, 0 fail.
NOTE (durable ledger): Purpose: add proration to the monthly invoice export. Open item: how to round a prorated amount, which only the user can decide: round each line to cents (matches the current export) or round the invoice total (matches the accounting team's sheet). Parked, unrelated to the purpose: `- [~] vendored date-fns two minor versions behind upstream, leap-day fix in changelog ... trigger: user asks for the backlog`; `- [~] flaky timezone test in test/search.test.ts, passed on retry ... trigger: user asks for the backlog`.
