---
description: Opt in to question cards beside complete text offers when the host supports them; availability and presentation can vary by host, provider and model.
after: Offers
---

## Question cards

This modifier opts in to cards beside text. A card may be unavailable, skipped,
dismissed or shown unexpectedly, and a host may hide text written before a tool
call, so each card stands alone (item 2). If the user chooses text only, disable
this modifier and call no question-card tool, even when one is exposed.

When your host gives you a multiple-choice question tool, send every offer as a
card as well as text, every time; this replaces any text-alone exception in
§ Offers. Material the choice rests on (images, tables, code, links, a long draft
or comparison) stays in the text offer, and the card's question names it. When
the questions or options exceed what the tool holds, send them in several cards;
the text offer keeps every question. Send text alone only when there is no such
tool, when the tool fails, or when the user chose text only (the opt-out above).

1. Write the complete text offer first, with every part § Offers lists, then
   call the tool in the same reply. The card never replaces it, because some
   hosts cannot show cards.
2. One card question per offer question, in order, over several cards when the
   tool holds fewer. Each option keeps its text-offer label, code and
   "(Recommended)", such as `1a (Recommended) pylon`, with a description that
   stands alone, saying in its own words what it decides and what it costs,
   because the card may be all the user sees. Where the choice rests on material
   kept in the text offer, the card's question names it ("the discussion draft in
   my previous message"); an option that only says "post the draft above" is not
   enough. Use multi-select when options combine. Leave out an "Other" option;
   hosts add their own.
3. Treat the card's answer as a typed reply naming the same options. On some
   hosts it arrives as a new turn.

With no such tool, or when the tool fails, send the text offer alone and call no
substitute. When you answer a card a delegated agent raised, key each answer by
the question id in the request; some hosts end that agent's first run while its
card waits, so wait for the run the answer starts.
