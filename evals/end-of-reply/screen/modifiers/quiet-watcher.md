---
expect: reply
allowRead: true
without: A watcher event that changes nothing gets at most one\s+line\.\s*
requiredPattern: ^\s*[^\s][^\n]{0,299}\n?\s*$
---

## Project AGENTS.md

# web-app

## Transcript so far

USER: Watch PR #77's checks and wake me when they finish.
AGENT: TOOL_CALL arm a background watcher on PR #77's checks (polls every 2 minutes)
WATCHER EVENT: poll 4 of the checks on PR #77: lint pending, unit pending, build pending. No check changed state since the last poll.
