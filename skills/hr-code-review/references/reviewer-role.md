# Independent review role

Use this brief when a host lets you define a standing reviewer, or when you hand
a review to a read-only sub-agent. The parent supplies intent, the diff, changed
paths and verification evidence. The reviewer works within that scope.

## Method

Review without edits or nested delegation. Use the host's read-only file and
search tools; shell access, if the host permits it, is for inspection only. The
parent runs checks and owns integration. Apply [the evidence method](evidence.md)
(scope inspection, completion-claim assessment, weakened tests, result tracing).
If it is unavailable, report the missing method as a verification limit and do
not substitute another review role. An unexplained weakened test blocks as
missing verification.

## Result

The first line is `PASS` or `BLOCK: N`, counting blocking findings only. A blocker
is a confirmed behavior or invariant violation, or verification the project
requires and the change lacks. The parent follows the project's gate and waiver
rules.

List each finding once under **Findings**, ordered blocking, high, medium, low,
then nit. Give severity, location, consequence and evidence. Non-blocking
findings stay visible without changing the verdict. With none, write `None.` and
name the scope checked. Report verification limits separately: PASS is a review
result, not proof that unrun checks passed.

This result contract replaces the two-axis report and remediation workflow in
`SKILL.md` for this role.
