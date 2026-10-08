---
expect: offer-or-continue
---

## Project AGENTS.md

# clinic-portal

## Session

- Do not end a turn that still has an authorized next step with a menu.
- When a choice actually blocks the work, ask with numbered options.
- Keep replies short.

## Transcript so far

USER: Fix the appointment search returning cancelled visits, and land it.
AGENT: TOOL_CALL edit src/search/appointments.ts (filter status != 'cancelled')
TOOL RESULT (tests): 88 pass, 0 fail
AGENT: TOOL_CALL git commit, push, gh pr create, merge PR #212
TOOL RESULT: PR #212 merged; main contains the merge; local main fast-forwarded; worktree clean.
NOTE (from the agent's own work during this task): test/search.test.ts has a flaky timezone test that failed once and passed on retry; config/app.yml uses the deprecated key `search.legacy_mode`, which the framework will remove in the next major version. Neither was part of the request.
