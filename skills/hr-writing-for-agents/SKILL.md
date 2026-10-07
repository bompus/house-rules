---
name: hr-writing-for-agents
description: "How to write any document an agent reads: skills, AGENTS.md, CLAUDE.md, rules and the docs they point to (wording, structure, triggers, pruning). Use when drafting or revising that text in any repository."
---

Reference for writing any document an agent consumes: a skill, an `AGENTS.md` / `CLAUDE.md`, a doc reached by a pointer. The packaging differs; the writing does not: the same levers make each one predictable, since the agent takes the same _process_ every run rather than producing the same output.

When the document you're writing is a skill, read [`SKILL-MECHANICS.md`](SKILL-MECHANICS.md) for frontmatter, invocation choice, testing a description or a skill's output, and router skills.

## Source ownership and adaptations

Choose the owning source within the selected scope. Keep portable shared guidance
with its shared owner, host settings and personal selections with their host,
and product commands, contracts and safeguards with their product. For mixed
content, split only the portions the user authorized. An ownership lookup does
not authorize edits, installation or publication.

Reusable third-party guidance may be contributed upstream or published as a
clearly identified adaptation within the selected scope. Check its licence before
copying or adapting it. Preserve required notices and source provenance, including
the revision when known. A vendor label identifies its source; assess permitted
adaptations rather than excluding them by that label alone. For house-rules
contributions, locate its checkout and follow `CONTRIBUTING.md` for notice placement.
Put pure credit in distributed notices; retain instruction references that help
the task. Standalone bundles must carry their required notices.

## Context pointers

Use local files for operational pointers to available guidance. In a skill,
bundle the target or name its path from a located checkout; source-relative
paths outside the installed skill can break. The local-reference check is
`guidance-links.mjs` in the located house-rules checkout. Its README describes
the gate, repository mappings and justified remote-reference annotations.

A **context pointer** is a reference held in the agent's context that names some out-of-context material and encodes the condition for reaching it. A skill's description is one; a line in `AGENTS.md` naming a doc is the same object. The pointer's _wording_, not its target, decides when the agent reaches the material, and how reliably. A must-have target behind a weakly worded pointer is a variance bug: sharpen the wording first, and inline the material only if sharpening fails.

A pointer does two jobs: state what the material is, and list the **branches** that should trigger reaching it (a branch is a distinct case the document handles, so different runs take different paths through it). Every word of an always-loaded pointer costs on every turn, so it earns even harder pruning than the body:

- **Front-load the leading word**: the pointer is where it does its triggering work.
- **One trigger per branch.** Synonyms that rename a single branch are one branch written twice; collapse them and keep only distinct branches.
- **Cut identity the body already carries.**

## The two loads

Every document and pointer you add spends one of two budgets:

- **Context load** is the cost of always-loaded material on the agent's window: an `AGENTS.md` line, a skill description, anything sitting in context every turn, spending tokens and attention whether or not it fires.
- **Cognitive load** is the cost on the human: which documents exist and when to reach for each. The human is the index. Not a cost to minimise: it is the price of human agency; spend it where human judgement matters, remove it where it does not.

Material reached only through a pointer escapes context load at the price of the pointer's own line; material with no pointer at all rides entirely on cognitive load.

## Information hierarchy

A document is built from two content types: **steps** (the ordered actions the agent performs) and **reference** (definitions, rules, facts consulted on demand). The two mix freely: all steps (a recipe), all reference (a review's rules, this skill), or both. The core decision is where each piece sits on the **information hierarchy**, a ladder ranked by how immediately the agent needs the material:

1. **In-file step** is the primary tier: what the agent does, in order.
2. **In-file reference** is consulted on demand. Often a legitimately flat peer-set (every rule of a review on one rung), which is a fine arrangement, not a smell.
3. **Disclosed reference** is pushed out into a separate file, reached by a context pointer, loaded only when the pointer fires. Spans a sibling file in the same folder through fully external reference that lives anywhere and any document can point at.

Push too little down and the top bloats; push too much and you hide material the agent actually needs. That tension is the whole decision.

**Progressive disclosure** is the move down the ladder (out of the main file and behind a pointer) so the top stays legible. Not primarily a token optimisation: it is how the hierarchy is protected. Branching is the cleanest disclosure test: inline what every branch needs, and push behind a pointer what only some branches reach. When a document has steps, in-file reference that should be disclosed buries them and turns attending to them into a coin-flip: a variance lever, not just a legibility one.

**Co-location** is the within-file companion: where the ladder decides _how far down_ a piece sits, co-location decides _what sits beside it_ once there. Keep a concept's definition, rules, and caveats under one heading rather than scattered, so reading one part brings its neighbours with it. The test: the document should read like documentation written for the agent. Grouped material reads that way; scattered material does not. (Distinct from duplication: that repeats one meaning in two places; scattering fragments one meaning across many.)

**Sprawl** is the failure mode here: a document simply too long, even when every line is live and unique. Attention thins across the excess, and every extra line is one more to keep relevant. The cure is the ladder: disclose reference behind pointers, and split by branch or sequence so each path carries only what it needs.

## Steps and completion criteria

Every step ends on a **completion criterion**, the condition that tells the agent the work is done. Two properties make it a lever:

- **Clarity**: can the agent tell done from not-done? A vague bound ("understanding reached") invites **premature completion**: ending the step before it is genuinely done, attention slipping to _being done_. The visible steps still ahead (the **post-completion steps**) supply the pull; the criterion's clarity is the resistance. Defend in order: **sharpen the bound first** (local and cheap); only if it is irreducibly fuzzy _and_ you observe the rush, hide the later steps by splitting the sequence. Hiding only works across a real context boundary (a hand-off or a subagent dispatch; an inline call leaves the later steps in context and clears nothing).
- **Demand**: how much it requires. "Every modified model accounted for" forces thorough work where "produce a change list" does not. Demand drives **legwork** (the digging the agent does within the work, latent in the wording rather than written as its own step), and it is not step-bound: "every rule applied" binds a body of flat reference just as "every step done" binds a sequence, which is how an all-reference document still carries an exhaustiveness bar.

The strongest criteria are both checkable and exhaustive.

## When to split

Splitting one document into two spends one of the two loads, so split only when the cut earns it:

- **By sequence**: split a run of steps where the post-completion steps tempt the agent to rush the one in front of it. Keeping them out of view drives more legwork on the current task. Beware the reverse: merging sequences exposes each step's later steps to what follows, inviting premature completion.
- **By invocation**, skill-specific: see [`SKILL-MECHANICS.md`](SKILL-MECHANICS.md).

## Leading words

Reuse established domain terms when their meaning is clear to the intended reader. Keep explicit criteria where a shorter label would hide a constraint. Do not invent shorthand merely to reduce token count. Judge wording by whether it produces the intended behavior, not by its intensity.

State the desired behavior clearly. Retain explicit prohibitions when they define a real boundary, and pair them with the permitted behavior when that helps the reader act.

Choose the instruction's form from the failure it fixes:

| Observed failure | Form that fixes it | Form that backfires |
|---|---|---|
| Knows the rule, skips it under pressure | An explicit prohibition that names the workaround | Soft guidance ("prefer", "consider") |
| Complies, but the output has the wrong shape | A recipe: the output's parts, in order | A list of "don't" items, which the agent negotiates with |
| Leaves out a required element | A required slot in the template it fills in | A prose reminder near the template |
| Behavior depends on a condition | A conditional on something the agent can observe | An unconditional rule with exemption clauses |

Exemption and nuance clauses leak: "don't X unless it matters" reopens the decision, and "this limit doesn't apply to code blocks" still suppresses code blocks. Express a real exception as its own conditional, or restructure so the rule cannot reach the exempt part.

## Pruning

- Keep each meaning in a **single source of truth**: one authoritative place, so changing the behaviour is a one-place edit. **Duplication** (the same meaning in more than one place) costs maintenance and tokens, and inflates a meaning's prominence on the ladder past its real rank.
- The **environment** is a source of truth too (`package.json` scripts, config files, the directory layout, `--help` output), and a document that restates it is a **cache**: a copy of a lookup, earning its load only when the lookup is expensive. Cache what the agent cannot find by looking: the unwritten convention, the reason behind a choice, the gotcha no config confesses. Leave the one-file, one-command lookups to the environment, where they cannot go stale.
- A rule a **check** can enforce (a type, a lint rule, a test, a CI gate) lives in that check. An agent under pressure skips a prose rule but cannot pass a failing check. The document keeps only what the check cannot say: why the rule exists, where it deliberately does not apply, and the check's name, so an agent that trips it knows what to do instead. When you write a mechanical rule (a pattern a search could find, such as raw colour values outside the token file) and no check exists, add one in the same change, or state that the rule is unchecked.
- Document a **component beside the component**: its build, flags, layout, measurements and troubleshooting go in its directory's README or its header comment, with at most a one-line pointer from shared guidance. A shared file is read for many tasks; component detail there taxes every reader for a lookup only one task needs, and it drifts because nobody editing the component sees it.
- Check every line for **relevance**: does it still bear on what the document does? A line loses relevance by never bearing on the task (mere exposition, or a branch that should be disclosed) or by going stale as the behaviour or world it describes changes. Shorter documents are easier to keep relevant. Without a pruning discipline the default fate is **sediment**: stale layers that settle because adding feels safe and removing feels risky, until you must core down through them to find what is still live. Rewrite durable guidance in place; keep incident history in the repository's tracker or archive rather than appending it to operational rules. An example goes stale the same way when it records the fix you applied: have it teach the failure and the tell that exposed it, and let the agent derive the fix from the current code.
- If an instruction adds no useful behavior, remove it. If behavior is missing, state the observable requirement or completion condition rather than adding stronger emphasis. Treat claims about wording effects as hypotheses unless supported by task evidence.
