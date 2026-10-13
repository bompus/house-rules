# Skill-fire cases

Each directory is one `claude plugin eval` case: a `prompt.md` and `graders/*.md`.
A case asks whether a shipped `hr-*` skill fires on a realistic request (a
`tool_used: Skill` grader) and whether the reply meets the skill's contract (an
`llm` grader), or whether a skill stays quiet on a near miss.

```sh
node evals/skill-fires/prepare.mjs "$SCRATCH/house-rules-skills"
claude --setting-sources project --effort high plugin eval "$SCRATCH/house-rules-skills" \
  --tag routing-baseline --runs 3 --concurrency 1 --ablation none \
  --model <agent-model> --judge-model <judge-model> \
  --no-publish --no-scaffold --trust-plugin --keep-temp \
  --output-dir "$SCRATCH/evidence" --json "$SCRATCH/evidence/result.json"
```

Use a scratch directory outside the repository. `--case <glob>` runs a subset.
Read the exit status and the `partial` flag, then judge two things per case:
routing (expected or forbidden skill calls, from the tool grader and the raw trace)
and answer quality (the result grader plus a look at the reply). Under
`--ablation with-without`, `tool_used: Skill` graders are a with-only indicator
(`scored: false`), so a successful exit does not prove routing; use that mode
for answer-quality comparisons, at least three runs per arm.

These cases measure Claude's skill selection and replies, not other hosts'
discovery. Three runs on a handful of cases and a model judge do not establish a
skill's general benefit. When a case asks for behavior outside the skill's
contract, correct the case before changing the skill's description. Run the
cases against your own model and effort; no results ship with them.
