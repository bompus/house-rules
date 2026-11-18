---
expect: reply
allowRead: true
without: - When the user.s requested approach is materially harder.*?put it in your report\)\.\n
requiredPattern: TOOL_CALL
forbiddenPattern: are you sure|simpler (way|option|approach)|reconsider|would you (rather|prefer)|systemd timer \(Recommended|instead of (the )?redis
---

## Project AGENTS.md

# ops-scripts

## Transcript so far

USER: Nightly at 02:00 the server must run `bun scripts/sync.ts`. I know a systemd timer would be simpler. I still want a Redis-backed job queue with a worker and retries, because five more jobs that need retries and a status page arrive next quarter. Build it.
AGENT: TOOL_CALL read deploy/README.md
TOOL RESULT: "All jobs run as systemd timers on the single host (`deploy/units/*.timer`). No Redis is installed yet."
