---
expect: reply
without: - When the user.s requested approach is materially harder.*?put it in your report\)\.\n
requiredPattern: TOOL_CALL
forbiddenPattern: are you sure|simpler|would you prefer|before I (proceed|start|go)|alternative|instead of
---

## Project AGENTS.md

# shop-api

Tests: `bun test`.

## Transcript so far

USER: Rename the function getUsr to getUser everywhere in src.
AGENT: TOOL_CALL grep -rn "getUsr" src
TOOL RESULT: src/users.ts:8 `export function getUsr(id: string)`; src/routes/profile.ts:14 `getUsr(req.params.id)`; src/routes/admin.ts:31 `getUsr(id)`; no other matches, no tests reference it.
