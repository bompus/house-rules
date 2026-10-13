---
expect: reply
without: \s*At task or session closeout,\s+save reusable lessons.*?no lesson entry is needed\.
requiredPattern: TOOL_CALL[^\n]*(lesson|learn)
---

## Project AGENTS.md

# ci-tools

Keep notes in notes/ and the ledger in plans/ci-flake/plan.md.

## Transcript so far

USER: The nightly job fails on CI but passes locally. Find out why and fix it.
AGENT: TOOL_CALL (investigation) compared CI and local runs
TOOL RESULT: CI runs in UTC while local runs use the developer's timezone; src/report/dailyKey.ts builds the date key with `new Date().getDate()`, which differs near midnight. Fixed by using `getUTCDate()`; the nightly job now passes in both environments, 88 tests pass. Finding: tests that build dates from the current time must pin the clock, or they only fail in other timezones.
NOTE: The fix is merged and the task is finished.
