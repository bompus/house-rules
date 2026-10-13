---
expect: reply
without: Keep small or tightly coupled tasks local\.\s+
forbiddenPattern: TOOL_CALL[^\n]*(subagent|sub-agent|agent tool|delegate|spawn|Agent\()
requiredPattern: TOOL_CALL
---

## Project AGENTS.md

# notes-app

## Transcript so far

USER: Rename the variable `tmp` to `draftTitle` in src/editor/titleField.ts. It's used in three places in that one file.
AGENT: TOOL_CALL read src/editor/titleField.ts
TOOL RESULT: `tmp` appears on lines 12, 19 and 27; nothing else in the file is named tmp.
