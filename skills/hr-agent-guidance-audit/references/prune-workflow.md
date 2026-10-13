# Pruning workflow for rules, skills and docs

Use this when the goal is a smaller, clearer set of always-loaded guidance, not
only a read-through. Each step produces a list you can act on; skip a step the
request does not need.

1. **Size it.** List every file the agent loads (composed rules, skill
   descriptions, linked docs) with its byte count, largest first. The always-on
   rules and the skill catalog are the costly part; a reference loaded on demand
   is cheap. Record the totals so the end result can be compared.
2. **Find what belongs elsewhere.** For each doc, script and agent definition
   outside the portable rules repository, ask whether another project could use
   it unchanged. Where the repository owns the file and the task covers the move,
   move it into the shared repository and leave a pointer in the old place;
   otherwise report it as a candidate without editing. Keep host mechanics,
   personal choices and measurement data where they are.
3. **Condense and clarify.** Cut repeated sentences, filler and wording tuned
   for older models. Prefer positive wording ("do X") to prohibitions and plain
   absolutes ("always", "never") where the rule really is absolute. Keep every
   requirement a test or another file names. Measure each edit as
   before/after bytes; if the total barely moves, say so rather than cutting
   reasons.
4. **Screen for unnecessary rules.** A rule earns its place only if the
   model does worse without it. In the house-rules checkout,
   `evals/end-of-reply/run.mjs --screen` runs each scenario twice, with the rules
   and with the one rule named in the scenario's `without:` pattern removed:
   - Write a scenario for the rule: `expect: reply`, a transcript where the rule
     decides the outcome, and `requiredPattern` or `forbiddenPattern` for the
     right and wrong reply. Add `without:` as a regular expression matching the
     rule's exact text once. Add `allowRead: true` unless the scenario is about
     the first call itself: a model that reads a file before answering is
     otherwise graded on the read.
   - Test the models you use, at the effort you use: Claude Opus 5.5 and
     Sonnet 5.5, GPT-6.1 Sol, SWE-2, Muse Spark 1.3 Contributor, and Grok 4.7
     last, because it is the slowest. One wrapper per agent is in
     `evals/end-of-reply/models/`; its README section has the commands.
   - Check for rule leaks first. Every one of these agents loads your own rules
     by default, so probe each wrapper (the README gives the question) and
     confirm the only instruction file is the scratch `AGENTS.md`. A leak makes
     the "without" arm obey the rule anyway.
   - Use `--runs 4` or more. Four runs separate a rule only when the arms differ
     by 4 and 0; a smaller gap needs 9 runs per arm before you act on it.
   - Read the output: "rule helps" keeps the rule; "no difference" on all
     models makes it a removal candidate; "fails with the rule" means fix the
     scenario first, because it tests nothing. A scenario that fails in both
     arms on most models (the pattern is too narrow, or the transcript lacks
     what the rule needs) discriminates nothing; rewrite it and confirm that
     it passes with the rule and fails without it before using its result.
   - A harness that grades only the first reply penalizes models that read
     before answering, whatever the rules say. Use `allowRead`, and compare a
     model's failures with its replies before blaming the rule.
   - A removal candidate is a recommendation, not a deletion. Confirm with
     more runs, and offer the user the choice; moving the rule to an opt-in
     modifier is the middle option.
5. **Check against vendor guidance.** Read the current prompting guides of the
   model vendors you target. Treat them as evidence: remove emphasis and steering
   the guides now call unneeded only where the change keeps every domain
   safeguard and explicit user choice, and keep what they recommend.
6. **Recommend opt-ins.** A rule that matters only for some users or setups
   belongs in a modifier that is off by default. List each candidate with who
   needs it.
7. **Land and adopt.** Run the full test suite and the end-of-reply eval with
   the final composed rules, before and after, on each model. Land through the
   repository's path, then adopt the new revision wherever it is pinned and
   install the result. Report the size totals from step 1, the screening table,
   and what you left alone.
