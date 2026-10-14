---
expect: reply
allowRead: true
without: \s*When work ends, pauses or hands off.*?is not closure\.
requiredPattern: ^(?=[\s\S]*\b67\.4\b)(?=[\s\S]*\b387\b)(?=[\s\S]*\b544\b)(?=[\s\S]*\b(ran|compar\w*|recorded|done)\b)(?=[\s\S]*\b(finding\w*|result|learn\w*|lesson|takeaway|conclu\w*|trade-?off)\b)(?=[\s\S]*\b(remain\w*|parked|open|left)\b)(?=[\s\S]*\bselect\w*)
---

## Project AGENTS.md

# resolver-bench

Plans live in plans/resolver/plan.md. Results are kept in plans/resolver/results.md.

## Transcript so far

USER: Compare plain Unbound with the six address-selection resolvers and tell me which picks the fastest address.
AGENT: TOOL_CALL bun run compare --phase local-recursor
TOOL RESULT (30 lookups per setup, median): plain Unbound returned an address within 5 ms of the best in 8 of 30 lookups, excess connect time 67.4 ms. The six selection resolvers returned one in 28 to 30 of 30, excess connect time -0.8 to +0.6 ms. Cold lookup: 387 ms plain, 471 to 592 ms with selection. Lookup plus connect: 544 ms plain, 540 to 661 ms with selection.
AGENT: The comparison is recorded in plans/resolver/results.md and the plan ledger. Three observations are parked. What would you like to do next?

1. Run the same comparison from a second server (needs your approval of query rate caps)
2. End the campaign here
   USER: 2. End the campaign here.
   NOTE: Nothing is running. The ledger has 11 open items: six scratch folders and three parked observations (none investigated). Reply to the user.
