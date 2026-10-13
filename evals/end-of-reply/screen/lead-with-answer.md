---
expect: reply
without: Lead with the answer or the concrete result\.\s+
requiredPattern: ^\W*(no\b|not safe|don't|do not|not yet|unsafe)
---

## Project AGENTS.md

# docs-portal

## Transcript so far

USER: Is it safe to delete the old staging fixtures under test/fixtures/staging?
AGENT: TOOL_CALL grep -rn "fixtures/staging" test src
TOOL RESULT: test/e2e/login.test.ts:9 and test/e2e/export.test.ts:14 still import from fixtures/staging; no other references.
AGENT: TOOL_CALL bun test test/e2e
TOOL RESULT: 41 pass, 0 fail (with the fixtures present).
