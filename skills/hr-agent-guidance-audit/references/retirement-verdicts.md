# Retirement and merge verdicts

Use this method when an audit asks which skills, guidance files, docs or
scripts are still needed, or when a scheduled usage report lists candidates.

## Inventory

Cover skills, rule files, agent-facing docs, and the scripts, scheduled jobs
and services that support them. A script counts as unused only when nothing
outside its own tests and itself calls, schedules or documents it.

Usage evidence is optional and only supporting. When session transcripts are
available, count a use only when the skill or file was invoked or loaded for
real work. Exclude sessions that only list, edit, audit or install it, and
give anything added recently a grace period before low use counts against it.
Low use alone never justifies retirement: rare skills can guard rare,
expensive situations.

## Verdicts

Give each candidate exactly one verdict, with its evidence:

- **Exact duplicate**: name the other copy and which one owns it.
- **Near duplicate**: name the skill to merge into and list what the
  retired side contributes that the survivor lacks. Carry those ideas over
  in your own words, respecting the source's license.
- **Covered by X**: quote the line or section of X that does the same job.
  If you cannot quote it, the verdict is not "covered".
- **Not applicable**: say to whom it does not apply and why.
- **Keep**: name the concrete situation it serves.

Verify every "covered by", provenance or history claim against the source
before stating it. A plausible guess about why something exists is not
evidence.

## Shared source and local installs

When the guidance ships to other people, give two verdicts: whether the
shared source should keep it, and whether this installation should. Do not
assume readers of shared guidance have the same optional tools, indexes or
services as the auditing host. A skill made redundant here by a local tool
can still be the only option for everyone else.

## Report

Group candidates by verdict. For merges, name the surviving skill, the
carried-over ideas and the callers, tests and installer lists that must
change. For retirements, name what replaces each item. Offer retirements and
merges for the user's selection; do not delete on usage evidence alone.
