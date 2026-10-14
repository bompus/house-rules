---
expect: reply
allowRead: true
without: Periodic status updates.*?the final report replaces them\.
requiredPattern: (5[- ]min|five[- ]minute|every five|\*/5|sleep 300)
---

## Project AGENTS.md

# api-server

## Transcript so far

USER: Run the full integration suite and tell me when it's done.
AGENT: TOOL_CALL bun run test:integration (started in the background, PID 4411, output to /tmp/int.log)
TOOL RESULT: started. For reference, the last three full runs took 34, 37 and 41 minutes.
