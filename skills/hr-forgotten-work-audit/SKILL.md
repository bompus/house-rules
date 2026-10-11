---
name: hr-forgotten-work-audit
description: "Read-only audit of a project's past sessions, plans and handoffs for work that was asked for, promised or deferred and then lost from every list. Use when asked what fell through the cracks across sessions, or when the open-work check says the project's audit is missing or overdue."
---

# Forgotten-work audit

Per-session checks look at lines that are already in a ledger. They cannot
see a promise that exists only in a transcript, a follow-up written as prose,
or an item a handoff rewrite left out. This audit reads the history itself
and checks every candidate against the records that should hold it.

The audit reads only. It edits, commits, posts, comments, builds and cleans
up nothing. Workers may write only their own result file. The coordinator
writes the consolidated report and the last-audit record. After the report,
step 5 may add owed items to a plan this session owns; that is the only
other write.

## 1. Set the scope

Fill these before starting, and put them at the top of the report:

- **Project**: the name used in plans' `Project:` line, and the repositories
  and checkouts it covers. The name starts with a letter, digit or `_` and
  holds only those and `.` or `-`. It names folders, so stop if it has any
  other character.
- **Window**: from the last audit's date (or the project's first session)
  to today.
- **Records**: the live plan and handoff folders, archived plans, the
  repositories' history and changelogs, and their open and recently closed
  pull requests and issues, including ones on upstream projects.
- **Transcripts**: the host's transcript search, meaning a tool that
  full-text searches earlier agent sessions across providers and filters by
  project directory and date. Use the one the host names. Do not write
  per-provider transcript scanners. Without such a tool, transcripts are a
  coverage gap.
- **Previous audit**: the result named by the last-audit record, if any, and
  its `gaps`. Each gap whose source is now readable becomes a slice of this
  audit over its whole uncovered range, whatever the window. A gap still not
  readable is copied into this audit's `gaps`.

## 2. Slice the sources

Split the work so each slice has roughly 30 to 80 candidates:

1. User prompts, by date window. Drop relayed notices and worker briefs, and
   say how many were dropped and by what filter.
2. Agent-written follow-up lines ("deferred", "follow-up", "still open",
   "later", "parked"), by date window. Say whether lines were read in full or
   found by keyword.
3. Plans and handoffs, live and archived: every open or deferred line, and
   prose follow-ups outside the ledger.
4. Repository state: branches, worktrees, scratch folders, open pull requests
   and issues, comments from others that are waiting on a reply.
5. The previous audit's forgotten and unclear items. Each one carries over
   until it is done, tracked or dropped.

Each slice can go to a read-only worker under the host's delegation rules,
with the brief in [references/brief-template.md](references/brief-template.md).

## 3. Give each candidate one verdict

- **done**: cite the commit, pull request, plan line or file.
- **tracked**: still open, and present in a live ledger or handoff (name it).
- **dropped**: the user or owner decided no, or it was superseded (cite it).
- **forgotten**: no follow-through and absent from every live list.
- **unclear**: the evidence is not enough; say what was searched.

Before calling an item forgotten, search the plans, handoffs, history,
changelogs and docs, the forge and the transcripts for it. A few
well-evidenced forgotten items are worth more than many weak ones. Skip
routine one-turn questions and commands finished in the same session.

## 4. Consolidate

Write the report in the notes directory at
`audits/<project>/<YYYY-MM-DD>/report.md`, beside the slice results, in the
format in [references/result-format.md](references/result-format.md):

1. One coverage row per slice: records read, range, items checked, and the
   count per verdict.
2. The gaps: sources not read, filters that dropped records, and anything
   truncated. Do not claim nothing else is missing.
3. A deduplicated list of forgotten and unclear items. Add tracked items with
   no movement for more than a week. Rank items visible to other people or
   time-limited first, then items the user asked for explicitly, then by
   correctness impact, then by effort.
4. The patterns that lost items, each with the items it explains.

## 5. Turn results into decisions

The report does not authorize work. For each forgotten or unclear item:

- If the current session owns the plan and the item is work the user asked
  for or was promised, add it as an open ledger line with its source.
- Otherwise present it under the governing offer rules. With three or more
  questions, use the walk-through in `hr-what-next`. Record each answer as
  yes, no (dropped) or deferred with a trigger.
- For items owned by another session or owner, name the owner and leave
  their records alone.
- Done and dropped items stay in the report only.

Report time-limited items and anything visible to other people first.

## 6. Write the last-audit record

When the report is saved, write `audits/<project>/last-audit.json` in the
notes directory, replacing the previous one:

```json
{
  "project": "example-app",
  "date": "2026-10-11",
  "scope": "sessions, plans, handoffs and pull requests, 2026-09-07 to 2026-10-11",
  "result": "audits/example-app/2026-10-11/report.md",
  "gaps": ["sessions in other repositories that discussed this project"]
}
```

`date`, `scope` and `result` are required; `gaps` is optional. `date` is the
day the report was saved. A partial audit still writes the record, and its
`scope` and `gaps` say what it left out.

`hr-what-next`'s open-work check reads this record for any plan whose header
has a `Project: <name>` line. It warns when the record is missing, unreadable,
more than 30 days old, or dated after today. A plan without that line gets no
audit warning.

Thirty days is a default, not a measurement of the best interval. In the
audit this skill is based on, items went missing within two to four weeks.
A handoff rewrite dropped five items overnight. A maintainer's question sat
unanswered for two weeks. A time-limited offer was six days from ending.
A full audit is a large run of model sessions, so a shorter interval needs
evidence that it finds more.
