# Upgrading skill names

Every skill shipped by house-rules uses the `hr-` prefix. For example,
`handoff` becomes `hr-handoff`. Rule headings, modifier names and the
`house-rules` command stay the same. Skills from other sources keep their names.

## Before updating

1. In `house-rules.json`, replace each shipped skill name in `skills.exclude`
   with its `hr-` name.
2. For each personal override of a shipped skill, rename its directory and
   its frontmatter `name:` to the matching `hr-` name.
3. Update your skill invocations, rules, links and host settings to use the
   new names.

Composition refuses unresolved old exclusion names, ambiguous old personal
folders and legacy frontmatter names in prefixed overrides before writing output. The error names the replacement. Fix the
config or layer, then compose again. The installer keeps the previous composed
skills until composition succeeds.

A personal override named `hr-handoff` replaces the shipped `hr-handoff`.
If your generic `handoff` is a separate skill you intend to keep alongside it,
record that decision in your config:

```json
{
  "skills": {
    "independent": ["handoff"],
    "exclude": ["hr-read-reddit"]
  }
}
```

`skills.independent` lets the listed personal skills keep names that match old
house-rules names. It does not create an alias or replace the prefixed skill.
`skills.exclude` uses the new names for shipped skills. An old name listed in
`skills.independent` refers to the independent personal skill and can be excluded
without excluding its prefixed counterpart. Unrelated personal
names need no entry in `skills.independent`.

## Connect hosts after composing

If a host reads the whole composed directory, point it at the new composed set.
If it has individual skill links or copied folders, replace its old house-rules
entries with the matching prefixed entries. Preserve unrelated skills.
Restart or reload the host and check that it discovers the new names.

The composer and installer do not edit host files or remove old host entries.
Do not keep both the old and new house-rules copies active. Historical skill
invocations need the new names; there are no compatibility aliases.
