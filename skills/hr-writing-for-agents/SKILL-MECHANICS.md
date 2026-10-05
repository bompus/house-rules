# Skill mechanics

The skill-specific branch of [`hr-writing-for-agents`](SKILL.md): frontmatter, invocation choice, testing a description or output, and router skills. The main skill owns writing guidance.

## Invocation

Choose whether the host may select the skill implicitly or whether the user must request it. Keep a concise description that states its scope.

Configure invocation through the host's supported mechanism. [Codex documents](https://learn.chatgpt.com/docs/build-skills#optional-metadata) `policy.allow_implicit_invocation` in `agents/openai.yaml`; setting it to `false` prevents implicit invocation while explicit invocation remains available. Use `disable-model-invocation` only for a host whose documentation supports it.

When a user invokes a skill with arguments, Claude Code substitutes `$0`, `$1`, … and `$ARGUMENTS` anywhere in the skill text, so a price written as `$0.01` renders as the first argument followed by `.01`. Write amounts as `0.01 USD` in skill files.

Make each runnable block in a skill self-contained. Hosts differ on whether a variable, `cd` or sourced function survives from one tool call to the next, so a later block that needs a value says where to get it rather than relying on an earlier block's shell. Branches between blocks read better as numbered steps than as shell conditionals.

Do not assume an invocation setting hides metadata, prevents reading a referenced file, or has the same effect across hosts. Invocation policy alone does not establish context-token savings.

## Testing a description

A description is a context pointer, so judge a rewrite by whether it fires on
the right requests, not by how it reads. Compare the current and the new
wording on the same prompts: requests that should trigger the skill, taken
from real use where possible, plus near-misses that belong to a neighbouring
skill. Run each prompt at least three times per wording; one run is noise.
Keep the rewrite only when it fires more without firing on the near-misses,
then add the missed prompts as a trigger eval.

Test in an isolated copy of the skill catalog, never by editing installed
skill files, which every live session on the host reads. With Claude Code,
copy the skills into a scratch plugin, edit the copy, and read the first
`Skill` call from each run:

```bash
claude -p "<prompt>" --setting-sources project --plugin-dir <catalog-copy> \
  --max-turns 2 --output-format stream-json --verbose
```

`--setting-sources project` hides the user-level skills, so only the copy
loads. Run the repository's skill tests on the new frontmatter before
trusting a result: Claude Code accepts an unquoted description containing
`: `, but a strict YAML parser rejects it, so quote such descriptions.
Prompts lifted from old sessions often fire nothing without their
conversation; count that as a limit of the test set, not of the wording.

## Testing output

A trigger eval shows that the skill fires; an output case shows that it does
its job. Give each case a prompt that carries the whole input (a diff, a
scenario), so a run needs no repository.

- The runner sees only the prompt, in a fresh session. A separate judge grades
  the reply against a bar: the outcome a good reply reaches and the smells that
  fail it. Name a specific item only when missing it is the failure; a full
  answer key tests conformance, not the skill's judgment.
- Run each case with and without the skill, at least three times per arm, and
  read the delta, not the with-skill score. When the no-skill arm passes too,
  the case cannot measure the skill: read both arms' replies, then raise the
  bar to what the skill promises beyond a plain answer.
- Before editing the skill over a miss, decide whether the skill failed or the
  bar asked for something the skill should not do. Fix the bar in the second
  case.
- After an edit, re-run every case for that skill, since a fix can regress a
  passing one.
- To compare wordings of one instruction, run five or more fresh samples per
  wording plus a no-guidance control. If the control does not show the
  failure, there is nothing to fix. Read the spread as well as the average: a
  wording that gives the same result every run beats a noisier one with a
  similar mean.

When your host has a skill-eval runner (Claude Code's `claude plugin eval`,
for example), run the cases under it: it supplies the fresh runner, a grader
and the no-skill arm. Check its help for how it selects several cases at once:
Claude Code's `--case` takes one glob and a repeated flag keeps only the last,
so select several cases by a shared name prefix (`--case 'audit-*'`), and the
replies land in the run's `aggregate-result.json`. Its results cover that
host's skill selection only; other hosts need their own runs.

## Splitting by invocation

Split off a skill when it handles a distinct task the user or another workflow needs to select independently. Define its trigger and invocation policy for the supported hosts. Keep shared reference in a plain file when several workflows need it.

## Router skills

A router names related skills and when to use them. State whether it suggests a skill to the user or invokes it under the active host's policy. Referencing a file and implicitly selecting a skill are separate operations; follow the host's rules for each.
