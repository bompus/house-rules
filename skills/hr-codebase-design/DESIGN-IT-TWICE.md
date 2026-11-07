# Design it twice

When the user wants alternative interfaces for a chosen deepening candidate, compare materially different designs within the approved requirements.

Uses the vocabulary in [SKILL.md](SKILL.md): **module**, **interface**, **seam**, **adapter**, **leverage**.

## Process

### 1. Frame the problem space

Before comparing designs, write a user-facing explanation of the problem space for the chosen candidate:

- The constraints any new interface would need to satisfy
- The dependencies it would rely on, and which category they fall into (see [DEEPENING.md](DEEPENING.md))
- A rough illustrative code sketch to ground the constraints, not a proposal, just a way to make the constraints concrete

Show this to the user, then proceed to Step 2 within the approved requirements.

### 2. Develop alternatives

Delegate distinct alternatives, each to a sub-agent with a fresh context window (not a fork of this thread), when useful independent work remains in this thread; otherwise compare them here. Follow the host and repository's delegation and model-selection rules, and state read-only scope in each delegated brief. Accept convergence when the constraints explain it.

Choose contrasting constraints relevant to the requested behavior, such as minimizing the interface or simplifying the common caller. Consider extension points or ports and adapters only when an approved requirement needs them. For delegated alternatives, include file paths, coupling details, dependency category from [DEEPENING.md](DEEPENING.md), and what sits behind the seam in each brief.

Use [SKILL.md](SKILL.md) definitions for module depth and established CONTEXT.md terms for the domain; include the relevant terms in delegated briefs.

Describe each alternative with:

1. Interface (types, methods, params, plus invariants, ordering, error modes)
2. Usage example showing how callers use it
3. What the implementation hides behind the seam
4. Dependency strategy and adapters (see [DEEPENING.md](DEEPENING.md))
5. Trade-offs: where leverage is high, where it's thin

### 3. Present and compare

Present designs sequentially so the user can absorb each one, then compare them in prose. Contrast by **depth** (leverage at the interface), **locality** (where change concentrates), and **seam placement**.

After comparing, give your own recommendation: which design you think is strongest and why. If elements from different designs would combine well, propose a hybrid. Be opinionated: the user wants a strong read, not a menu.
