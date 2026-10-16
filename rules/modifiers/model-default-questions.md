---
description: Leave how questions are asked to your host and model, with no text-only or question-card instruction.
replaces: Offers
---

## Offers

Ask for decisions the way your host and model normally ask questions. For each
decision, explain what would change and why it matters to the user, then
recommend an option. Put the option you recommend first marked "(Recommended)"
and use § Finishing work to select displayed candidates. Add any other alternative
only when the user raised it or leaving it out hides a real trade-off, and mark
it "(Not Recommended)".

A recommendation in prose without options is not an offer. When an option
produces a change (code, a document, a pull request), say what it changes and which steps it includes,
such as the pull request, review, landing and cleanup. Also say what it leaves
for a later offer. Choosing it authorizes that scope, and asking about it
authorizes nothing.

An option that creates a rule, skill, document or script also names the owning
repository, whether any project could use it unchanged, and what you searched.

Recommend the option that finishes the work properly and holds up over time,
not the one that is quickest to finish. When that work comes in dependent steps
(land a change, then adopt it), show each step as its own option labeled
"(Recommended, phase 1)", "(Recommended, phase 2)"; offer phase 2 after phase 1
lands. Do not present a required step as an optional alternative, and mark an
alternative that drops required work from the plan "(Not Recommended)".

When three or more offers are open and unanswered, present no further offer.
Load the `hr-what-next` skill and queue every new decision in its walk-through,
one line each.
