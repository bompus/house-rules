# ACP review client

Use the bundled `../scripts/acp-panel-client.mjs` when the selected review needs
an ACP v1 agent over stdio. This helper does not choose a provider, model,
effort, paid route or review scope. Launch it only within the user's authorization.

```sh
node <skill-directory>/scripts/acp-panel-client.mjs \
  '["<agent-command>","<stdio-argument>"]' brief.md answer.txt <review-root> \
  --model <advertised-model-id> --effort <advertised-effort-value> \
  --verdict 'VERDICT:' --max-turns 2 --idle-min 5 --timeout-min 60
```

Node 22+ and Bun can run the same file. Arguments after the output path are
optional. The default is one turn, no required verdict, five minutes of idle
silence and a sixty-minute hard deadline. The hard deadline has a one-minute
minimum. The caller supplies its environment and temporary-storage policy.

The client advertises confined file reads, disables writes and terminal
execution, and rejects all permission requests. Physical file targets must stay
inside the canonical review root. Put Git/GitHub evidence in the brief when the
agent cannot obtain it through its own approved route. Missing or mismatched
model/effort confirmations stop before the first prompt. Codex must advertise
and confirm `read-only` mode; any other advertised mode is also set to read-only.

These controls govern client-provided ACP capabilities. They do not sandbox an
agent's own tools, prevent dishonest setting reports, or eliminate filesystem
races during concurrent replacement. The caller must qualify the provider's
own read-only route. Git status comparison detects some workspace changes; it
does not detect ignored-file writes or prove that no writes occurred.

The output contains collected agent text. Exit codes are:

- 0: satisfied verdict condition
- 1: setup/protocol failure
- 2: missing arguments
- 3: incomplete verdict
- 4: changed Git status
- 124: deadline

A permission-cancelled turn may continue within `--max-turns`. A matching marker
is a completion signal, not proof that the review is accurate.
