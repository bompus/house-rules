---
description: Run existing and new JavaScript and TypeScript commands with Bun; retain evidenced Node requirements and explicit user requests.
after: Implementation economy
reference: ../references/bun-runtime.md
---

## JavaScript and TypeScript runtime

Run JavaScript and TypeScript with Bun by default, including existing scripts, package
tasks and validation. Use Node only when the user explicitly requests it (a selected
Node comparison included) or a concrete technical requirement needs it, and record the
request or evidence before running Node; an old example, a Node shebang, `node:` imports,
`@types/node` or missing Bun does not establish that requirement. Keep frozen
evaluation inputs and historical records unchanged unless their selected scope
authorizes a change. Before choosing or changing a runtime for a command, read
[the runtime procedure](../references/bun-runtime.md).
