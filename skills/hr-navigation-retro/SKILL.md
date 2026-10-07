---
name: hr-navigation-retro
description: "Audit agent navigation using selected tool-call transcripts: rank misses, widened searches, re-reads and stale-doc remarks, verify findings against current repositories, and propose findability fixes. Use for agent-navigation retrospectives or re-measuring navigation fixes; general project retrospectives are outside this scope."
argument-hint: "<transcript ...> --repo-root NAME=ROOT"
disable-model-invocation: true
---

# Navigation retro

Any coding agent with file and shell access can run this workflow. Find
navigation failures in recorded tool-call evidence, then verify their causes
against current source. Ordinary guidance audits belong to
`hr-agent-guidance-audit`. Changes need their existing implementation authority;
a request for a retrospective alone authorizes the investigation and proposals.

## Select evidence

1. Read each target repository's guidance and its restrictions on access.
2. Locate transcripts through the host's existing tools. Select only authorized
   input files; do not scan every account or transcript store to find them.
3. Record the repository roots used in those sessions, including each checkout
   when the same repository appears at several paths. Map each to one name.
4. Keep transcripts, timelines, metric JSON and reports local. They expose raw
   prompts, commands, assistant text and paths. Truncation is not redaction.

The bundled [parser](scripts/retro.py) requires Python 3.11 or newer and uses only
the standard library. It accepts Claude Code and Codex JSONL, OpenCode JSON
exports, Cursor CLI stream JSON and recorded ACP v1 updates.
Read [input formats and limits](references/inputs.md) before selecting evidence.
Its header defines metrics and limitations. It reads selected files, executes no recorded commands and makes
no network calls. `--json` overwrites its output; choose a task-owned output file.
`--repo` filters results after analysis and does not restrict which inputs are read.

## Rank and inspect

Resolve the installed skill directory and task scratch directory before running
these commands. Pass actual selected paths for the placeholders:

```bash
python3 <skill-directory>/scripts/retro.py rank \
  --repo-root app=<absolute-recorded-repository-root> \
  --json <task-scratch>/retro.json \
  <selected-transcript.jsonl> <another-selected-transcript.jsonl>
```

All selected events are included by default. Use `--since-days 30` for a dated
window; undated events are excluded with a warning. If a recording omits its
working directory, pass its actual recorded directory with `--cwd`.

Repeat `--repo-root` for multiple repositories or checkouts. The most specific
matching root owns a command; unmapped or unresolved paths remain unknown.
Use `--subagents` only when the selected subagent transcripts are in scope.
Report missing inputs and rows omitted by `--min-sessions` or `--min-tools`.
A heuristic score prioritizes misses, widening and repeated reads. Stale-text
matches remain visible but do not affect ranking; discussion and quoted examples
can match. Neither the score nor a repeated read proves a navigation mistake.

Read each top session through its timeline:

```bash
python3 <skill-directory>/scripts/retro.py timeline <selected-transcript.jsonl>
```

Record the transcript and tool-call number for each navigation finding.
Repeated reads during editing may be necessary. Distinguish misses, repeated
searches and stale instructions from useful revisits. Every inspected session
gets a verified finding or an explanation that no navigation cause was found.

## Verify and propose

Verify each finding against the repository's fetched default branch.
Check the path or instruction that caused the search. Search the whole
repository, including docs, before claiming something is missing.
Drop findings already fixed or unsupported by current source.

Propose one repair per verified cause. Prefer deleting stale material, moving
or renaming it to where agents looked, simplifying it, then automating repeated
steps. Add prose only when those remedies cannot express what is missing.

Record source revision, session evidence, proposed repair and coverage in the
task's plan. Keep transcript evidence private. Offer implementation within the
user's existing authorization; do not treat a proposal as permission to apply it.

To assess a repair, compare a post-landing window with the saved baseline.
Normalize misses, re-reads and stale remarks by tool calls. State changes in
input coverage and concurrent conditions; totals alone do not show improvement.
