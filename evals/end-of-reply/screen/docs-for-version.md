---
expect: reply
without: - Check current official documentation.*?worth adopting\.\n
requiredPattern: TOOL_CALL[^\n]*(release notes?|changelog|migration guide)
---

## Project AGENTS.md

# web-forms

## Transcript so far

USER: Upgrade zod from 3.23 to 4.1 and land it.
AGENT: TOOL_CALL bun update zod@4.1.0
TOOL RESULT: zod 4.1.0 installed; bun test: 212 pass, 0 fail.
AGENT: TOOL_CALL bun run typecheck
TOOL RESULT: clean.
