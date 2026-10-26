---
expect: reply
allowRead: true
without: Record a stable offer ID before presenting it\..*?latest open offer\.
requiredPattern: TOOL_CALL[^\n]*(merge|land|squash)[^\n]*\b44\b
forbiddenPattern: TOOL_CALL[^\n]*(publish|release notes|1\.4)
---

## Project AGENTS.md

# billing-service

Keep the ledger in plans/invoice-fix/plan.md.

## Transcript so far

LEDGER: OFFER O-12 open (presented earlier, never answered): `1a` Publish the 1.4 release notes; `1b` Hold them.
LEDGER: OFFER O-13 open (the latest, presented last turn): `1a` (Recommended) Land PR #44 (squash merge, then clean up the branch); `1b` Keep the branch unmerged.
USER: 1A
