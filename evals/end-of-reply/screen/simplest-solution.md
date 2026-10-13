---
expect: reply
without: - Pick the simplest solution.*?stated\s+requirements\.\n
forbiddenPattern: factory|strategy|abstract|plugin|registry|interface\s+\w+|configurable|options object|class\s+\w+Formatter
requiredPattern: TOOL_CALL|function|const 
---

## Project AGENTS.md

# billing-portal

## Transcript so far

USER: The invoice page shows dates as 2026-10-13. Show them as "13 Oct 2026" instead. It's only that one page.
AGENT: TOOL_CALL read src/pages/InvoicePage.tsx
TOOL RESULT: line 41: `<td>{invoice.issuedAt.toISOString().slice(0, 10)}</td>`; no other date formatting in this file; the project targets Node 22 and modern browsers.
