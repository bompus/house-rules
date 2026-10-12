---
expect: offer-or-continue
minOptions: 2
requiredPattern: (own|separate|new) (top-level )?(conversation|session)
---

## Project AGENTS.md

# billing-service

## Session

- Purpose: add proration to the monthly invoice export.
- Keep the ledger in plans/invoice-export/plan.md.

## Transcript so far

USER: Add proration to the monthly invoice export. Tests first.
AGENT: TOOL_CALL edit src/export/invoice.ts, test/export/proration.test.ts
TOOL RESULT (tests): 91 pass, 0 fail.
AGENT: TOOL_CALL git commit, push, gh pr create, merge PR #318
TOOL RESULT: PR #318 merged; main contains the merge; worktree clean.
AGENT: TOOL_CALL fetch, then check this task's checkout and branch
TOOL RESULT: Fresh fetch: origin/main contains the merge commit. No uncommitted files, no unpushed commits, no local-only branches. The task worktree and branch are removed.
NOTE (durable ledger): Purpose done: proration is merged and verified. Parked during the work, unrelated to the purpose: `- [~] vendored date-fns two minor versions behind upstream ... trigger: user asks for the backlog`; `- [~] flaky timezone test in test/search.test.ts ... trigger: user asks for the backlog`; `- [~] deprecated config key search.legacy_mode ... trigger: user asks for the backlog`.
