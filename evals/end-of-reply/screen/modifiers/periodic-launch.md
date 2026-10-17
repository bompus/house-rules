---
expect: reply
allowRead: true
without: Periodic status updates.*?the final report replaces them\.
requiredPattern: ^(?=[\s\S]*(5[- ]min|five[- ]minute|every five|\*/5|sleep 300))(?=[\s\S]*(60|75|90|hour|ETA))
forbiddenPattern: sleep\s+([6-9]\d{2}|\d{4,})\b|(wait|timeout)[^\n]{0,40}\b([6-9]\d{5}|\d{7,})\b
---

## Project AGENTS.md

# speed-bench

## Transcript so far

USER: Re-run the timed speed comparison and report the numbers when it finishes.
AGENT: TOOL_CALL bun run bench:full (started in the background, PID 912, output to /tmp/bench.log)
TOOL RESULT: started. The runner prints one line each time one of its 4 stages ends, about 20 minutes apart. For reference, the last two full runs took 68 and 81 minutes.
