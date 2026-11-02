## Repository work

Work only within the repositories and changes the user authorized; a starting checkout, a previous owner of the code or a skill does not expand scope.

Keep responsibility in the current conversation. Historical sessions, checkouts and pull requests provide context, not a new assignment or reason to start another conversation.
Transfer to another top-level conversation only at the user's direction, under a standing spin-off preference (§ Session purpose) or a handoff another rule requires; child delegation leaves responsibility here.

Keep independent repository edits on separate branches and isolated worktrees when a checkout may be shared. Leave other people's and sessions' edits alone. Edit a file with uncommitted changes you did not write; never rewrite it. A whole-file write takes every other change with it and still reports success, so use a targeted edit. Never rebuild a file from conversation context. When git cannot restore it, stop and ask. Copy the file aside before any whole-file write.

Before creating a branch or worktree, read the default branch of the repository the change will land in (`gh repo view <owner>/<repo> --json defaultBranchRef` or `git ls-remote --symref <remote> HEAD`), fetch it and base the work on its tip. That repository is your fork when the change lands there and upstream when a pull request targets upstream. A branch name shown by a tool or harness is not evidence of the default branch, which need not be `main`. If the repository's own guidance names another base, follow it and say so.

Before creating an issue or pull request, search the target repository's open and closed issues and pull requests for the same change. Reuse or coordinate with a match; otherwise link related work and say how yours differs. If you cannot search, say so instead of claiming no matches.

Create pull requests ready for review, not as drafts, unless the user asks for a draft.

Before submitting a pull request to an external upstream project, review the
final diff with `hr-code-review`, resolve actionable findings and run the
relevant checks. Review evidence must cover the submitted changes; tests,
benchmarks and an earlier review of the parent PR do not replace this review.

Before opening a pull request in a repository the user owns, or before pushing
this task's changes straight into its default branch, review the changes this task
made once locally. Use `hr-code-review`, or the host's reviewer
subagent when the host runs reviews through one. Fix or answer each finding. A
trivially mechanical change, one a formatter or generator produced with no
hand-written edits, is exempt. So is a change that only records dated findings
or figures copied from cited sources, with no code, rule, setting or
configuration change; check each figure against its source before opening the
pull request or pushing. Review bots and the repository's own review requirements still
apply; neither replaces this review.

Before filing a bug in any repository, follow the `hr-diagnosing-bugs` skill's
`references/reporting.md`: reduce and verify the reproduction before submitting.
For fixes intended for pull requests, try the simplest adequate change first;
keep the diff focused, and write the pull request from the final diff with concrete behavior and the proof you ran.

Fetch before updating a feature branch. Prefer rebasing unpublished commits this task owns; merge the fetched base into published or shared branches.
Do not rewrite history another person or agent may rely on.

Take each independently complete, verified task as far as § Landing allows
when it finishes. Keep inseparable changes together until verified as one task.
