---
name: hr-handoff
description: Create a resumable handoff when the user requests one or the low-quota handoff rule triggers. Do not invoke merely because a conversation is long.
argument-hint: "What will the next session be used for?"
disable-model-invocation: false
---

Write a handoff document summarising the current conversation so a fresh agent can continue the work. Save it outside disposable storage and task worktrees, as § Durable notes in the house rules requires.

Default to `handoffs/<project>/<session>.md` in your notes directory (§ Durable notes), expanding `~` and environment variables to an absolute path. Respect a user-selected persistent location. Create parent directories as needed, choose a unique session name, reuse the file for updates, verify its contents, and report the absolute path. Do not default to temporary directories or caches for resumable handoffs.

For a low-quota handoff (trigger defined by the `low-quota-handoff` modifier), do only what
is necessary to reach a safe boundary. Do not abandon time-critical duty mid-action. Create the essential
current state, Git ownership
and next action first so they survive an interrupted write; then fill in the
remaining context. Record the triggering bucket, reading source/time and reset
time when known, and unknown quota/reset information as unknown.

Verify the saved handoff, report its absolute path, and end the turn without
continuing substantive work, even if tasks were previously authorized; this is the stop
the house rules' § End of every reply allows for a rule you are following. Only an explicit
user instruction resumes work, limited to its requested scope; update this same
handoff and stop again afterward while quota remains low. Do not change
provider, model or effort without authorization.

For a handoff unrelated to quota, follow the user's requested continuation or
stop boundary.

Before a handoff unrelated to quota, check the docs this session relied on or
changed against the current code: repository guidance, READMEs and design docs
that name the files, commands or behavior the session touched. List each claim
the code contradicts, with the doc's file and line and the code evidence, and
propose the smallest fix for each. Edit docs only with the user's approval;
record unapproved contradictions as open items so the next session doesn't
trust them. Skip this check for a low-quota handoff.

Preserve, stated exactly and complete even at the cost of length: (1) problems that came up and how they were handled; (2) options raised, tried, or set aside, and why; (3) anything asked for, decided, ruled out, or established as a preference, constraint, or boundary; (4) exactly where things stand now, including any external action started without a recorded result; (5) anything still open, promised, or expected next; (6) details that are hard to reconstruct: names, numbers, dates, exact wording, paths, links. Keep what the user said close to their own words; condense your own reasoning to what it concluded or produced. Everything else stays concise.

Close the loop on remaining work: inventory every current and past item as done,
open, or deferred, each with its owner and next action, and state whether all
items are addressed. When the handoff spans several threads or scopes, include
an integrated plan. Preserve an already-selected next action; record unresolved
decisions and recommendations in priority order.

For a handoff unrelated to quota, follow
[reconciliation.md](references/reconciliation.md) to compare the current and
preceding source transcripts, linked ledgers and Git inventory with this
inventory. Save its receipt and run the offline checker. Report coverage gaps
and mechanical results separately from the reviewed claim that all items are
addressed. Include owned unlanded PRs, dependency PRs and own commits without a
PR; preserve their owners and landing authority.

At a low-quota stop, save essential state first and record partial coverage
when feasible. An unfinished receipt or failing check never delays that stop.

Ask what to work on next only when an unresolved decision needs the user's
input and the handoff's stop boundary permits it. Follow the house rules'
§ Offers and § Finishing work. When stopping for low quota, the saved handoff and recorded next action serve
as the offer; do not ask a new selection question.

A session resuming from a handoff re-reads the repository's guidance index,
meaning its `AGENTS.md` (or configured instruction root) and the rules and docs
it names. It also checks `git log` on those paths plus the house-rules checkout
for changes since the handoff was written; an installed or composed copy of
the rules can lag its source. Boot-injected rules are a snapshot, not proof of
current text.

Include a **Git** section when the handoff involves repo work:

```markdown
## Git

- Checkout: <absolute path>; branch or detached HEAD: <verified value>
- Owns: `path/globs`
- Do not touch: `<paths other chats own>`
- Last commit: `<sha> <subject>`
```

If two chats run in parallel on this repo, owns must not overlap. Prefer one implementation chat at a time.

End your report with a ready-to-paste prompt for the resuming agent inside a
fenced code block, so the user can copy it into a fresh session verbatim. It
must name the handoff's absolute path, tell the resuming session to read the
handoff fully before acting (which itself directs the guidance re-read), and
state the recorded next action plus any provider or host constraint the user
gave. Keep it under ten lines; the handoff carries the detail, the prompt only
points at it.

Redact any sensitive information, such as API keys, passwords, or personally identifiable information.

If the user passed arguments, treat them as a description of what the next session will focus on and tailor the doc accordingly.
