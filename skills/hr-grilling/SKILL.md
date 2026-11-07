---
name: hr-grilling
description: Stress-test a plan, decision, or idea via relentless interview. Use when the user wants questions and pushback; when they also want ADRs or a glossary written as you go, pair it with hr-domain-modeling.
license: MIT
metadata:
  upstream: https://github.com/mattpocock/skills
  upstream_ref: a496f5513d4a4cf889bc48e189e579f4b0bdf6aa
  upstream_path: skills/productivity/grilling/
  house_rules_patches: "Portable provenance; hr- skill names"
---

Interview the user relentlessly until you reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled: the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask the ready questions whose answers could change the selected goal, supported behavior, interfaces, safeguards or verification. Give a recommended answer for each. Keep dependent questions for later rounds. Leave speculative or out-of-scope branches out of the interview unless the user explicitly requests an exhaustive exploration. Then wait for the user's answers before the next round.

Follow the active shared workflow's question presentation policy for each
round. Tool availability alone does not enable question cards. Use its offer
format for choices, with this round structure:

```
**Question 1: <title>** <body>

`1A` <option> (Recommended)

`1B` <option>

Recommended: reply `1A` or `go`
```

When a round asks several questions, close it with one line instead:

```
Recommended combination: reply `1A, 2B` or `go`
```

For an open question with no options, end it with `Recommended: <answer>`.

For an actual yes/no question, phrase it so "yes" accepts the recommendation. For questions with several options, keep the explicit option codes and `go` acceptance line.

Each round the user answers reshapes the tree: settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one.

Finding _facts_ is your job, never the user's. When a frontier question needs a fact from the environment (filesystem, tools, etc.), find it yourself rather than asking the user. The _decisions_ are the user's: put each to them and wait.

Answer a fact inline when one call would do. Dispatch a read-only sub-agent with a fresh context window when it is a real hunt, using the current host's native mechanism and the repository's model-selection rules. Don't block on it: a running exploration is an unsettled prerequisite, so only the questions downstream of it wait for the sub-agent to report; ask the rest of the frontier now.

Stop when the material decisions needed for the selected goal are settled. Record reasonable implementation assumptions and any deferred questions with their triggers. Do not invent more branches merely to exhaust the design tree. If the user explicitly asks for exhaustive exploration, continue within that requested scope. Confirm the shared understanding before implementation; confirmation of the discussion does not expand implementation authority.

Asked to capture the outcome as docs (ADRs, glossary) rather than just reach agreement? Run the `hr-domain-modeling` skill alongside this one.
