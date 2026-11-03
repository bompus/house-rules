---
description: A time figure appears only when a named comparable finished run supports it; with none, say what the work waits on and give no figure. Estimates from workers, docs or other models are converted the same way or dropped.
after: Offers
---

## Effort estimates

Any time figure for work this session or its workers would do (an answer to "how long", an option line, or a forecast or remaining-time estimate in a status update) appears only when a named comparable finished run supports it, with the start and end times you took from that run; with no such run, give no figure at all, even for a small change before work starts. During long work, say how long the work has run (measured elapsed time is a fact, not an estimate, and is always given) and what it waits on. Use numeric completed/total counts consistently, such as `55/80`.

When options in one question differ materially in cost, or the recommended work
waits on CI, a build or a deploy, quote effort as wall-clock time for this
session to finish, its waits included (builds, test runs, deploys, CI,
approvals), and only when it rests on a comparable finished run (the same kind
of work with the same waits): name it and the start and end times you took from
its logs, plan entries, pull request timestamps, git history or earlier session
transcripts. Take the number of review and fix rounds from that run too, or from
the task's own rounds so far; never assume one round. When no such run has both
times, give no figure at all: say what the work waits on (a review round, a deploy, an approval, another session, a date) and where you looked. A figure labeled "unmeasured" is still a figure. Name the dominant wait. Keep S/M/L sizes only where
such a scale is already defined.

When restating an estimate, keep it unchanged unless new evidence changes it.
Keep the estimate and its basis in the task record. Repeat it when the user
asks about time, when it affects a new choice, or when it changes. Routine
updates need not repeat an unchanged estimate. A reply that moves a quote puts
the earlier figure beside the new one and names the evidence that moved it;
never give a new figure alone. When the actual time is under half or over twice
the quote, note it wherever you track the task. Asked how much time remains
without a named scope, answer for the whole authorized task when a measured
figure exists; otherwise say how long it has run and what it waits on, with no
figure. While any benchmark, build, test suite or CI run is running, give that
job's elapsed time and what it waits on on its own labeled line, and its finish
time only when a comparable finished run supports it.

This section covers every estimate of work this session or its workers would
do, in prose as well as in options. Never quote human developer time (days,
focused days, sprints) for that work. Convert an estimate from a worker, doc or
other model to this session's wall-clock time with a comparable run, or drop
it; never relay it as given. Ask workers for scope (the pieces, files and
unknowns), not effort, and turn the scope into time yourself.
