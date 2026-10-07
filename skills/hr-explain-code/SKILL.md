---
name: hr-explain-code
description: "Explain how existing code works by tracing it from trigger to effect, read-only, so the reader can change it with confidence. Use when the user asks how a part of the codebase works, or wants a walkthrough or trace of a flow. Not for designing new code or critiquing existing code."
disable-model-invocation: true
---

# Explain code

The goal is a reader who can open the right files and predict what the code
will do before they touch it. This skill reads and reports. It edits nothing,
runs nothing that changes state and offers no verdicts on quality.

## Pin down the question

Restate the question in one or two lines before reading far: which behavior,
which entry point, and where you will stop. "How does login work?" might mean
the form submit, the token exchange, session storage or all three. Pick the
reading that best fits what the user said, say which one you picked, and start.
Do not wait for confirmation; the user can redirect you.

If the question names something that does not exist in the code, say so early
and offer the nearest real thing.

## Trace the behavior

Start where the behavior starts: a route, a command, an event handler, a
scheduled job, a public function. Follow calls forward until you reach the
effects the question cares about, such as a write, a response, a message sent
or a value returned.

- Use the project's code search or code index when it has one. It follows
  calls and dispatch that plain text search misses.
- Read the code that runs. A function name, a config key or a package
  description says what someone intended, not what happens. Confirm by
  reading the body, the call site and the value actually passed.
- Follow indirection to its target: dependency injection, registries, event
  buses, plugin loading, dynamic imports, overrides. Name the mechanism when
  it is the reason the path is hard to see.
- Separate the normal path from code that exists but is not wired in: dead
  branches, disabled flags, handlers nobody registers, fallbacks that only
  fire on a specific error. An exported or configured function not called on
  the normal path is an optional capability, not a step in that flow.
- Distinguish a configured provider, an injected adapter, a local stub and a
  durable service. Name only the runtime role the wiring and code support.
- For a state change, trace to the line that performs the write and the
  conditions that permit it. Finding a caller alone does not prove a write.
- Check configuration and environment that change the path, and say which
  values you assumed.
- When you cannot close a gap (generated code, a closed dependency, runtime
  data you cannot see), write the open question right beside the claim it
  weakens. Do not collect unknowns in a footnote far from what they affect.

The trace is done when every step from trigger to effect is either read in
the code or marked unverified at that step.

## Split a large area

When the area is too wide for one careful pass and the host can run helper
agents, divide it into slices that do not overlap, for example one per
service, layer or entry point. Give each helper a single slice, read-only
access and the brief in [`references/helper-brief.md`](references/helper-brief.md).
Run them in parallel.

Merge the results yourself. Where two slices meet, check that one helper's
outgoing call matches the other's entry point. Re-read the code for any claim
that surprises you or that the explanation depends on; a helper's summary is
a lead, not proof.

## Match depth to the question

A narrow question gets a short answer. "Where is the retry count set?" needs
a file reference and a sentence, not a tour. A request for a walkthrough of a
subsystem gets the full shape below.

- Cite files and functions as `path/to/file.ext:function` or with line
  numbers, so the reader can open each one.
- Quote code only when the exact line carries the point: an off-by-one
  boundary, an unusual default, a condition that decides the branch.
- Choose the smallest view that explains the behavior clearly. Use pseudocode
  for decisions, a call tree for execution order, or a component/file tree for
  ownership. Use a diagram for interactions or state transitions when it is
  clearer than prose. Keep the conditions, side effects and unverified links
  that affect the answer, with source references beside them.

## Shape the answer

Cover these in whatever order and form suits the question. Skip a part only
when it has nothing to say.

1. **Purpose.** What the code is for and who or what triggers it.
2. **Terms.** The few names, types or ideas the reader must know to follow
   the rest. Three to five is usually enough.
3. **The flow.** The path from trigger to effect, using prose or the selected
   view, with a source reference for each step. Explain any assumption or
   omitted branch that changes the reader's understanding.
4. **Where to start reading.** The two or three files that repay opening
   first, and in what order.
5. **Surprises.** Behavior a careful reader would not expect: side effects,
   ordering dependencies, silent fallbacks, caching, code that looks live but
   is not, and history that explains why code looks odd.
6. **Unverified.** What you could not confirm and what would confirm it,
   if any of it is not already noted next to its claim.

## Stay descriptive

Describe what the code does, not whether it should. If you notice a likely
bug, mention it once as a fact with its location and move on. For a critique
of the design, point to `hr-maintainability-review`. For what a planned change
would affect, point to `hr-change-impact`. For a failure being chased, point to
`hr-diagnosing-bugs`.
