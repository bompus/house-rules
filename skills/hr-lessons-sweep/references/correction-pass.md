# Correction pass

Finds the turns where the user had to correct or steer a session, and decides
whether a change to guidance, a skill or a check would have prevented each one.
It spends model quota, so run it only when asked. It edits nothing: every
proposal waits for the user's selection.

## 1. Pick sessions

The bundled condenser reads Claude Code transcripts; other hosts' stores need
their own. Name the sessions, or take recent ones:

```
find ~/.claude/projects -name '*.jsonl' -mtime -7 ! -path '*subagents*'
```

Condense each one into a scratch folder on disk, outside the repository:

```
bun <skill-directory>/scripts/condense-turns.ts <transcript.jsonl> <out.txt>
```

Skip a session with fewer than five typed turns; tool-driven sessions have
almost no user words to read.

## 2. Extract

Give one read-only subagent per session the condensed file, the installed
always-on guidance read in full (`~/.claude/CLAUDE.md` or the host's
equivalent, not excerpts), and this task:

> Find every user turn where the user corrected the agent, pointed out a mistake
> or an omission, doubted an unchecked claim, repeated a question the agent had
> not answered, or had to steer the agent to do something properly. Do not flag
> a plain reply to an offer ("go", "1a"), a new task or scope, a context summary,
> a message relayed from another agent, or an automated notice. For each flagged
> turn give: Turn; User words (short quote); What the agent had just done (from
> the text before the turn only); Existing coverage (`none`, `present-not-followed`,
> `ambiguous` or `contradicted`, with the guidance sentence quoted, or `unknown`);
> Standing correction or one-off. Be conservative. List doubtful turns separately
> with one line each. End with `FLAGGED: <n>  DOUBTFUL: <n>`. Write no files.

Read the doubtful list yourself: in a replay over three sessions the extractor
listed two real steering turns there instead of flagging them.

## 3. Decide

- A one-off preference stays in task history. Save a lesson candidate only for a
  standing correction.
- Verify `Existing coverage` yourself against the guidance text before using it.
  `present-not-followed` points to a check or a structural fix, not new prose.
- Propose a guidance or skill change only when the same cause appears in a second
  session (search earlier sessions with whatever transcript search the host
  has) or when existing sentences contradict each other. Before a recurrence,
  record the lesson candidate and stop.
- Prefer, in order: a check or script, deleting or simplifying text, replacing
  text, then adding text. For every proposal state the net lines it adds to
  always-on guidance and any size limit it counts against.
- Offer the proposals as one ranked group in the host's offer format. Land a
  chosen one through the owner of the file it changes.

## What the extractor missed or cannot see

Mistakes the agent caught itself leave no user turn, so this pass cannot find
them; record those as lessons at closeout. The extractor's coverage field was
`unknown` for half the flagged turns when it saw only excerpts.
