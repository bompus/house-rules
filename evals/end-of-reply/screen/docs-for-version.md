---
expect: reply
without: - Check current official documentation.*?worth adopting\.\n
requiredPattern: TOOL_CALL[^\n]*(doc|changelog|release note|migration|version)
---

## Project AGENTS.md

# web-forms

## Transcript so far

USER: Use zod's `.email()` on the signup form's email field.
AGENT: TOOL_CALL read package.json
TOOL RESULT: `"zod": "4.1.0"` (the codebase's other schemas were written for zod 3 and some use `z.string().email()`).
