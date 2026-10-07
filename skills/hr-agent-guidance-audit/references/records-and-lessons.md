# Research records, lessons and override evidence

Use this method when reviewing research, lessons or guidance overrides.
The owning repository or host chooses the record locations, archive layout,
indexes and sweep triggers. Existing authorization governs any edits or sweep.

## Preserve research that helps a later decision

Save reusable findings in the owning project's research record, or the host's
configured durable notes when no repository owns them. Record source links,
the date checked and revision when available, what each resource helps with,
limits, the recommendation and its evidence. Separate inspected source,
tested behavior, adoption and proposals. Keep useful rejected alternatives
with their reason and a condition for reconsidering them. Link existing
records instead of duplicating them.

Read the relevant saved record before another deep investigation. Recheck stale
or decision-critical facts and update that record when evidence changes.
Retrieved history remains subordinate to current code, instructions and user
direction. A saved recommendation grants no installation or implementation
authority.

## Stage, promote or retire a lesson

Record the condition, recommended action, reason, evidence and obsolescence
trigger. A lesson stays staged until evidence supports it; a one-off correction
stays in task history. Review raw candidates before treating them as lessons.

Promote an accepted lesson into the strongest adequate mechanism in this order:
a type, lint rule, test or check script, shared helper, runtime check, then prose.
Use owning rules or guidance only when none of those mechanisms can express it.
Record `check:` with the check that would fail on recurrence, or `none` and the
reason no check can catch it.

When a lesson replaces another, record `supersedes:` on the new record and
`superseded-by:` plus status `retired` on the old one. Preserve both so the
old record explains the earlier practice. Retire lessons when their
obsolescence condition occurs. Archive promoted or retired records under the
owner's policy; the promoted rule or check becomes the current source.

## Keep overrides accountable

For each override, record one source owner, reason, the upstream default or
precedence it changes and dated verification. Keep values with their installer
or role owner; guidance points there. Distinguish explicit user preferences,
temporary workarounds and model-performance choices. An adopted framework or
runtime dependency needs the same record.

Recheck affected overrides during upgrades, restoration, guidance audits or
model re-evaluation. Reopen model routing when aliases, effort levels, plan
limits or observed quality/usage change. Compare current official documentation
and effective runtime behavior. Record coverage; an installation drift check
does not verify vendor semantics.

Retire a workaround when its cause is gone or an optimization when its benefit
no longer justifies maintenance, within existing authority. Preserve explicit
user choices until changed by the user. Report uncertainty rather than
silently repinning. Retiring a managed setting must also remove its installed
keys; stopping future writes does not reset existing configuration. These are
checks in the selected workflow, not a new scheduled job.
