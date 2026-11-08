---
description: Judge design choices by users, then agents, then developers, say what the lower-ranked group gives up, and keep commands usable by agents (no interactive prompts, parseable output, errors that name the bad value and the next step).
after: Implementation economy
---

## Design audiences

Judge each design choice by everyone it reaches: the people who use the result, the agents that run, read or call it, and the developers who maintain it. Prefer the option that serves all three. When they conflict, users come first, then agents, then developers, unless that costs security, validation or a stated requirement; say in the report what the lower-ranked group gives up. For agents, that means commands that run without interactive prompts, output a script can parse, and errors that name the bad value and the next step.
