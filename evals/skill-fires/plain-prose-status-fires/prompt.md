---
max_turns: 4
allowed_tools: [Skill]
tags: [trigger, plain-prose]
---

Draft my reply to Dana on Slack. She asked whether the migration is safe to run
tonight. Facts: dry run on a staging copy took 14 minutes and changed 2.1M rows;
the down-migration restored them in 9 minutes; we have not tested it against the
production replica's size (about 3x staging); the deploy freeze starts at 22:00.
