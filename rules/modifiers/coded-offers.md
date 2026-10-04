---
description: Offers use numbered questions and coded options (1A, 1B) so one short reply answers every decision.
replaces: Offers
---
## Offers

Write every offer as a normal text reply that stands alone (a tool-rendered
card may not display on every host), with these parts in order:

1. Context and the recommendation, in the same reply as any due report.
2. One numbered question per independent decision, e.g.
   `**Question 1: Next step?**`; a lone question is still Question 1. When
   every option in it combines, add "Pick any combination." to that line.
3. Its options, one per paragraph with a blank line between, each starting
   with its inline-code code (`1A`, `1B`; Question 2 offers `2A`, `2B`),
   highest recommended priority first. The literal "(Recommended)" goes right
   after the code; any listed option you would not pick carries
   "(Not Recommended)". Leave such options out unless the user raised them or
   dropping them hides a real trade-off. Tag options that combine with only
   some others, e.g. `(Combinable with 1A)`. Every live candidate from
   § Finishing work is listed; the leave-out rule covers new ideas, not
   candidates. When candidates remain, include an `All done` option, which
   closes them: record each as dropped or deferred wherever you track work.
4. The exact reply line, built from the codes you actually recommend:
   "Recommended: reply `<code>` or `go`" for a lone question, "Recommended
   combination: reply `<code>, <code>` or `go`" for several (for example
   "Recommended combination: reply `1B, 2A` or `go`").

Close tracked work, an implementation or review report, or unlanded commits with
an offer, and answer a bare "what next" or "what remains" the same way. Its
candidates come from the plan ledger when there is one, this session's findings,
open items of a resumed handoff, uncommitted or unlanded changes and untriaged
review feedback; re-check each and drop stale ones. A candidate held by a "don't
start until asked" safeguard stays listed as "(Not Recommended)", naming the
safeguard.

The offer exists only when the coded option list is present; a prose
recommendation is not one. `go` (or `continue`) always means the stated
recommended code or combination. Plain numbers stay for ordered action steps;
codes are only for options the user picks. For mutually exclusive options,
recommend exactly one; combinable options may each carry "(Recommended)".
Recommend by merit and state authorization separately. After an analysis-only
request, implementation may be recommended as proposed work that needs
selecting. When an option includes implementation, state its implementation
and landing scope: choosing it authorizes that scope, and asking about a
recommendation authorizes nothing.

When recommended work lands in sequenced phases, label it "(Recommended,
phase 1)", "(Recommended, phase 2)"; `go` covers phase 1 only, and the next
phase is offered again once phase 1 lands. Work that waits on a condition
rather than earlier work is not a phase: record it with its trigger wherever
you track follow-ups, or list it as "(Deferred until <condition>)" when the
user should see it.

Some hosts can also show the offer as a question card (a multiple-choice tool
call). Send one only when a skill, a plugin or another section of these rules
asks for it, and never instead of the text offer. Put the card in the same
reply, right after the complete text offer: an agent that ends its reply first
often never sends the card, and some hosts drop short text sent beside one.
Its payload carries the context and recommendation, with multi-select for
combinable choices.
