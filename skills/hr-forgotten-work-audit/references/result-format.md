# Result format

## Slice result (one file per worker)

```markdown
# <slice name>

Coverage: <records read and range>; <N> candidates; done <n>, tracked <n>,
dropped <n>, forgotten <n>, unclear <n>.
Gaps: <records not read, filters applied, truncation>.

| #   | What was asked, promised or offered | Source (agent, session, date, short quote) | Verdict | Evidence searched | Suggested disposition (do, ask, drop) |
| --- | ----------------------------------- | ------------------------------------------ | ------- | ----------------- | ------------------------------------- |

Patterns: <one paragraph on how items got lost>.
```

The table holds every forgotten and unclear item, and tracked items with no
movement for more than seven days. Keep each cell short.

## Consolidated report

```markdown
# Forgotten-work audit: <project>, <start> to <end>

Scope: <repositories, record folders, transcript filter>.
Previous audit: <result path, or none>.

## Coverage

| Slice | Range | Result file | Checked | Done | Tracked | Dropped | Forgotten | Unclear |
| ----- | ----- | ----------- | ------- | ---- | ------- | ------- | --------- | ------- |

Counts overlap between slices; the list below is deduplicated.

Gaps: <one line per source not covered, filter that dropped records, or truncation>.

## Findings, ranked

| #   | Item | State | Owner | Next (do, ask, drop) | Evidence |
| --- | ---- | ----- | ----- | -------------------- | -------- |

## How items got lost

1. <pattern>: <items it explains>.
```
