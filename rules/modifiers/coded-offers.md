---
description: Offers use numbered questions and coded options (1a, 1b) so one short reply answers every decision.
replaces: Offers
---

## Offers

Use § Finishing work to select displayed candidates. Each offer stands alone:

1. For each decision, explain what would change and why it matters to the user,
   then recommend an option.
2. One numbered question per independent decision, such as
   `**Question 1: Next step?**`. If all options combine, add "Pick any combination."
3. One list item per option, so options cannot run together. Start each with its
   inline-code code in lowercase (`1a`, `1b`; Question 2 uses `2a`, `2b`); a reply's
   code matches in any case (`2A` selects `2a`). Put the recommendation
   first, with "(Recommended)" immediately after its code. Mark options you would not
   pick "(Not Recommended)"; name partial combinations, such as "(Combinable with 1a)".
   Keep each to a line or two that says what it does and how far it goes.
4. The exact acceptance line, a plain paragraph after the list. One question uses
   "Recommended: reply `<code>` or `go`". Several use "Recommended combination: reply
   `<code>, <code>` or `go`". Nothing follows that line, so a parked-item note, or any
   other closing line the rules ask for, goes before the offer. Each option's own line
   says what it leaves for a later offer.

Include alternatives the user raised or needed to explain a material tradeoff.
Routine offers include an option to decline or defer displayed proposals; say other
ledger items remain pending. Declining drops a proposal. Defer only work the user wants
done later. Full backlog offers include `All done`, which drops every listed candidate that
the user has already answered in an offer of its own, unless the user explicitly asks for some to be done later;
defer only those. A candidate never asked about individually gets its own question first. Record what
was decided about each; deferral never means completion.

Name what each applicable option produces and how far it goes. Cover the change,
the steps it includes (such as the pull request, review, landing and cleanup) and
what it leaves for a later offer. Selection authorizes that scope; questions authorize
nothing. Implementation after analysis needs selection.

An option that creates a rule, skill, document or script also names the owning
repository, whether any project could use it unchanged, and what you searched.

The coded list makes an offer; a prose recommendation alone does not.
Record a stable offer ID before presenting it. Codes and `go`/`continue` refer to that
conversation's latest open offer.
`go` or `continue` selects the recommendation in the latest open offer. Keep that
offer and its scope in the ledger; status or notification updates leave it open. Record
replacements. Accepted, completed, deferred or superseded offers cannot authorize
new work. If the open offer is unclear, ask which work to resume.

When three or more offers are open and unanswered, present no further offer.
Load the `hr-what-next` skill and queue every new decision in its walk-through,
one line each.

Use plain numbers for steps and codes for options. Recommend one mutually
exclusive option: the one that finishes the work properly and holds up over
time, not the one quickest to finish. Independent options may each be
recommended; list their codes in the acceptance line. When the proper work comes
in dependent steps (land a change, then adopt it), label each step's option
"(Recommended, phase 1)", "(Recommended, phase 2)"; never present a required
step as an optional alternative, and mark an alternative that drops required
work from the plan "(Not Recommended)". `go` covers phase 1 only; offer phase 2 after phase 1
lands. A trial or pilot that exists to decide a wider rollout is phase 1 of it: offer the rollout as
phase 2 in the same offer, and offer it again when the trial lands, or say why the result
argues against it. Waiting is a deferral only the user chooses.
Record conditional work with its trigger.

Make an offer visual only when the user asks for one, and only where the host
can render a visual. It is a rendered page, not a question-card tool, so the
optional question-cards modifier does not govern it, whether that modifier is
on or off. It sits beside the complete text offer, which
still carries the acceptance line. Give each question one block. Show every
option's code, a short label and its steps from start to finish, and mark the
recommended options. Add a short box on how to reply.

Ask questions in text. Question cards are a separate, optional modifier
(`question-cards`); while it is off, which is the default, never call a
question-card tool. Tool availability alone does not turn it on. When it is on,
follow it beside the complete text offer.
