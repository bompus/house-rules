---
description: Opt in to question cards beside complete text offers when the host supports them; availability and presentation can vary by host, provider and model.
after: Offers
---

## Question cards

This modifier opts in to cards beside text. A card may be unavailable, skipped,
dismissed or shown unexpectedly, and a host may hide text written before a tool
call, so each card carries its whole decision. If the user chooses text only,
disable this modifier and call no question-card tool, even when one is exposed.

When your host gives you a multiple-choice question tool, send every offer as a
card as well as text, unless the choice depends on images, tables, code, links or
a comparison longer than a card option holds; send those as text alone.

1. Write the complete text offer first, with every part § Offers lists, then
   call the tool in the same reply. The card never replaces it, because some
   hosts cannot show cards.
2. One card question per offer question, in order. Each option keeps its
   text-offer label, code and "(Recommended)", such as `1a (Recommended) pylon`,
   with a description that stands alone, saying what it does and what it costs,
   because the card may be all the user sees. Use multi-select when options
   combine. Leave out an "Other" option; hosts add their own.
3. Treat the card's answer as a typed reply naming the same options. On some
   hosts it arrives as a new turn.

With no such tool, send the text offer alone and call no substitute. When you
answer a card a delegated agent raised, key each answer by the question id in the
request; some hosts end that agent's first run while its card waits, so wait for
the run the answer starts.
