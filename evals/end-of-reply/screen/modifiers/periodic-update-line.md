---
expect: reply
allowRead: true
without: Periodic status updates.*?the final report replaces them\.
requiredPattern: ^(?![\s\S]{501})(?=(?:\s*TOOL_CALL[^\n]*\n)*\s*(?!TOOL_CALL)[^\n]+(?:\n\s*TOOL_CALL[^\n]*)*\s*$)(?=[\s\S]*(612\s*/\s*1,?840|612 of 1,?840|33(\.\d)?\s*%))(?=[\s\S]*(ETA|unmeasured|remaining|left|finish))
---

## Project AGENTS.md

# api-server

## Transcript so far

USER: Run the full integration suite and tell me when it's done.
AGENT: TOOL_CALL bun run test:integration (background, started 14 minutes ago, PID 4411)
AGENT: Posted a status update 5 minutes ago.
TIMER: 5 minutes have passed.
AGENT: TOOL_CALL tail the job output
TOOL RESULT: 612 of 1840 tests run, 0 failures, 14m elapsed; no earlier run of this exact suite was timed with this many tests, so no per-test rate is known.
