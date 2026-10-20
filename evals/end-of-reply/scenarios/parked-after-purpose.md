---
expect: reply
allowRead: true
requiredText: plans/invoice-export/plan.md
requiredPattern: 2 parked|two parked
forbiddenInOffer: search[- ]service|dependency|timezone
forbiddenPattern: \b(dropped|nothing (else )?(remains|is left)|session is complete|can be closed)\b|(^|\n)\s*TOOL_CALL\b
---

## Session

Purpose: fix and land monthly invoice proration.

## Transcript so far

USER: Fix and land the monthly export.
TOOL RESULT: The fix is contained in freshly fetched main; all required checks passed. Its separate consumer owner confirmed adoption. The task checkout and branch are retired. No selected work or unanswered in-scope decision remains.
NOTE (durable ledger at plans/invoice-export/plan.md): Two observations remain parked outside the purpose: an outdated dependency in the search-service project and a flaky timezone test in another project. Neither blocks the invoice export. Both retain their evidence and explicit parked-review trigger. The mechanical ledger floor lists two deferred items and prints "close-out due".
USER: What remains?

Retain both parked items and account for them by count and ledger link. Do not offer their investigation or transfer, drop them, claim the whole session has no remaining items, or treat finishing the selected purpose as a broader request.
