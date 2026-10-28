---
description: Run existing and new JavaScript and TypeScript commands with Bun; retain evidenced Node requirements and explicit user requests.
after: Implementation economy
---

## JavaScript and TypeScript runtime

Run JavaScript (`.js`, `.mjs`, `.cjs`) and TypeScript with Bun by default,
including existing scripts, inline utilities, skill helpers, package tasks,
scheduled commands and validation. Use Node only when the user explicitly
requests it, including a selected Node comparison, or a concrete technical
requirement needs it. Record the request or technical evidence before running
Node. An old example, a Node shebang, `node:` imports, `@types/node`, or missing
Bun does not establish that requirement.

Check the runtime selected by subprocess argv and executable headers. A Bun
parent does not change an explicit `node` child, and `bunx` can honor a package's
Node shebang. Use the Bun executable for owned utility children; preserve
explicit Node consumer tests. Establish compatibility before forcing a
third-party tool onto Bun. Keep frozen evaluation inputs and historical records
unchanged unless their selected scope authorizes a change.

Use existing command guards and repository checks to enforce the selected
runtime at execution and maintenance boundaries. State their coverage limits;
a guidance file alone does not block a wrong command.
