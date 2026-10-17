---
expect: reply
allowRead: true
without: Periodic status updates.*?the final report replaces them\.
requiredPattern: ^(?=[\s\S]*(5[- ]min|five[- ]minute|every five|\*/5|sleep 300))(?=[\s\S]*(unmeasured|(?=[\s\S]*(last|previous|prior|earlier|past|based on|runs? took))(?=[\s\S]*(\b(6\d|7\d|8\d|9\d|1\d\d)\b[^\n]{0,15}min|\b(an|one|1(\.\d)?|2) hours?\b))))
forbiddenPattern: sleep\s+([6-9]\d{2}|\d{4,})\b|\btimeout\s+([6-9]\d{2}|\d{4,})\b|\b(wait|block)[^\n]{0,40}\b([6-9]\d{2}|\d{4,})\s*(s|sec|seconds|ms)\b
---

## Project AGENTS.md

# speed-bench

## Transcript so far

USER: Re-run the timed speed comparison and report the numbers when it finishes.
AGENT: TOOL_CALL bun run bench:full (started in the background, PID 912, output to /tmp/bench.log)
TOOL RESULT: started. The runner prints one line each time one of its 4 stages ends, about 20 minutes apart. For reference, the last two full runs took 68 and 81 minutes.
