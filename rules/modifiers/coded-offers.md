---
description: Offers use numbered questions and coded options (1A, 1B) so one short reply answers every decision.
replaces: Offers
---

## Offers

Use § Finishing work to select displayed candidates. Each offer stands alone:

1. Brief context and the recommendation beside the result the user needs.
2. One numbered question per independent decision, such as
   `**Question 1: Next step?**`. If all options combine, add "Pick any combination."
3. One paragraph per option, separated by a blank line. Start with its inline-code
   code (`1A`, `1B`; Question 2 uses `2A`, `2B`). Put the recommendation first,
   with "(Recommended)" immediately after its code. Mark options you would not pick
   "(Not Recommended)"; name partial combinations, such as "(Combinable with 1A)".
4. The exact acceptance line. One question uses "Recommended: reply `<code>` or `go`".
   Several use "Recommended combination: reply `<code>, <code>` or `go`".
   Nothing follows that line. Each option's own paragraph says what it leaves
   for a later offer.

Include alternatives the user raised or needed to explain a material tradeoff.
Routine offers include an option to defer or drop displayed proposals; say other ledger
items remain pending. Full backlog offers include `All done`, which drops or defers
every listed candidate. Record what was decided about each; deferral never means completion.

Name what each applicable option produces and how far it goes. Cover the change,
the steps it includes (such as the pull request, review, landing and cleanup) and
what it leaves for a later offer. Selection authorizes that scope; questions authorize
nothing. Implementation after analysis needs selection.
The coded list makes an offer; a prose recommendation alone does not.
`go` or `continue` selects the recommendation in the latest open offer. Keep that
offer and its scope in the ledger; status or inbox updates leave it open. Record
replacements. Accepted, completed, deferred or superseded offers cannot authorize
new work. If the open offer is unclear, ask which work to resume.

When three or more offers are open and unanswered, do not present another one.
Queue the new decision in a walk-through (load the `hr-what-next` skill) and
give it one line.

Use plain numbers for steps and codes for options. Recommend one mutually
exclusive option. Independent options may each be recommended; list their codes
in the acceptance line. For sequential landing phases, label
options "(Recommended, phase 1)" and "(Recommended, phase 2)". `go` covers phase 1
only; offer phase 2 after phase 1 lands. Record conditional work with its trigger.

Make an offer visual only when the user asks for one, and only where the host
can render a visual. It is a rendered page, not a question-card tool, so
§ Question cards does not gate it. It sits beside the complete text offer, which
still carries the acceptance line. Give each question one block. Show every
option's code, a short label and its steps from start to finish, and mark the
recommended options. Add a short box on how to reply.

Use text for questions unless § Question cards is enabled. Tool availability
alone does not enable it. When enabled, follow it beside the complete text offer.
