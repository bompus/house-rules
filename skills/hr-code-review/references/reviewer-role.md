# Independent review role

Use this brief when a host lets you define a standing reviewer, or when you hand
a review to a read-only sub-agent. The parent supplies intent, the diff (or, when it is too large to include, the head, the base
and the path of a file inside the review root where the parent wrote the diff, because a reviewer
with only read and search tools cannot run a comparison command; the parent leaves out of that
file any path the review must not read (secrets, `.env` files, credentials) and lists the paths
it left out, because a saved diff is as readable to the reviewer as any file in the root), changed paths and verification evidence, and names every
model that wrote any part of the reviewed change, committed or not (vendor, name, version, effort
if known), or says that none did, so the reviewer can check that it is not one of them. The reviewer works within that scope.

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

Give every finding evidence, and a concrete failure unless it is a nit; leave out
low-confidence guesses and repeats of comments already on the pull request. A confirmed
blocker that repeats an earlier comment still counts in the verdict; refer to that comment
instead of posting it again. List each
finding once under **Findings**, ordered blocking, high, medium, low, then nit. Give severity, location, consequence and evidence. Non-blocking
findings stay visible without changing the verdict. With none, write `None.` and
name the scope checked. Report verification limits separately: PASS is a review
result, not proof that unrun checks passed.

This result contract replaces the two-axis report and remediation workflow in
`SKILL.md` for this role.
