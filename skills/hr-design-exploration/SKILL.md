---
name: hr-design-exploration
description: "Explore visual design or redesign alternatives through four ranked directions, top-two feedback and successive refinement toward one chosen design. Use when asked to propose or compare UI design directions; ordinary UI fixes and implementing an already chosen design do not need this workflow."
---

# Design exploration

Use the user's requested scope and constraints. The default is four initial
directions, then rounds containing the two selected designs and one variation
of each. A requested count or method takes precedence.

## Establish the comparison

Read the brief and current design. Identify the intended users, primary task,
content, required interactions, brand constraints and target viewports. Use
existing answers; ask only for missing information that would change the
alternatives. State the goal used to rank recommendations.

Keep the same real content, states and viewport sizes across previews. Hold
accessibility and required behavior constant. If content is unavailable, label
placeholder content and the assumptions it introduces.

## Show four directions

Create four meaningfully different approaches to the same goal. Differences
should affect hierarchy, layout, navigation, interaction or density. Color
swaps alone do not make distinct directions. Stay within the authorized
prototype scope; keep the current implementation available for comparison.

Show inspectable previews at comparable sizes, using the host's available
preview or image tools. Include interaction states when they distinguish the
directions. If rendering is unavailable, label the output as concepts and name
what remains unverified. Never claim an unseen design was visually checked.

Give each direction a stable ID and a short descriptive name. Present all four
in recommendation order, strongest first. Mark the strongest choices
"(Recommended)" and explain why they fit the stated goal. Recommendations are
judgments; do not invent usability results, performance gains or scores.

Beside the previews, use a short comparison table with each direction's ID,
main difference, benefit and tradeoff. Keep IDs stable when rankings change.
Ask the user to select their top two and give feedback on each, including what
to retain and what to change. Follow the host's question format. Wait for the
answer before narrowing or generating the next round.

## Refine the selected two

Record the chosen IDs and feedback in the task's durable design notes. Keep
eliminated directions there so later rounds do not revive rejected ideas by
accident. If the user chooses one as final, move to final selection below.

Show four options again:

1. The first selected design, unchanged as a comparison.
2. The second selected design, unchanged as a comparison.
3. One variation of the first design responding to its feedback.
4. One variation of the second design responding to its feedback.

Give variations new IDs and name their parent IDs. Explain what changed and
which feedback it addresses. Keep the inherited strengths visible and the
variation distinct enough to assess. Rerank all four against the goal and
latest feedback, mark recommended choices, and ask for the next top two with
feedback on each.

Repeat this round only after a new selection. Do not add new unrelated
concepts unless the user asks to reopen exploration. If feedback leaves no
meaningful variation to test, offer final selection or ask which unresolved
tradeoff needs another round instead of inventing cosmetic differences.

## Final selection

An explicit final choice ends exploration; no minimum round count is required.
Record the chosen ID, accepted refinements, rejected directions and remaining
uncertainties. Summarize the final design's layout, interactions and relevant
responsive states so implementation can follow it.

Choosing two for refinement authorizes that comparison, not promotion of a
winner. Apply the final design within existing implementation authorization;
when implementation or landing has not been authorized, offer that next step.
