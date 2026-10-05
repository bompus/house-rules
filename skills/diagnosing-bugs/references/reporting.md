# Reporting a bug

Before filing in any repository, search existing issues and fix pull requests.
Inspect labels, linked changes and timeline actions as well as comments.
For the same problem and scope, add new evidence to a matching open issue.
When a closed report still reproduces and remains materially unchanged,
explain the failed fix or changed conditions and request reopening. If reopening
is unavailable, file one linked follow-up. For material changes, use the
replacement workflow below.

Reduce the failure to the smallest self-contained reproduction you can verify.
Remove unrelated code, dependencies, data and setup. Keep reducing until each
remaining part is needed to reproduce the failure. For a library failure,
trace the operation and reproduce it directly when possible. Dig deeper when
a broad symptom hides which part fails.

Run the final reproduction with exact commands and pinned versions. Confirm
that it preserves the original failure. Lead with one symptom, the reproduction,
expected and actual text results, and the versions and environment needed to
reproduce it. Check the current stable release; identify development builds
separately when tested. Separate confirmed causes from suspected explanations.
A verified small reproduction can be reported while its internal cause remains
unknown. When reduction fails, report what you tried and what remains before
asking whether to submit the broader case.

For performance or memory bugs, follow the applicable benchmark protocol.
Put the focused case and its result before a larger comparison matrix.
Check correctness and compare the same operation under the same conditions.
Recheck both reduced and original cases. State units, repetitions and
variability; include useful controls or workarounds when already measured.

Read the repository's contribution guidance and matching issue template,
including organization defaults. Complete required fields and checklists.
Submit issue forms through the form or tooling that preserves required fields,
labels and routing; copied headings alone do not preserve form metadata.
Verify the published body and metadata. If available tooling cannot preserve
the form, prepare the report and ask for access or user submission.

When an issue needs major or material changes, replace it with a new issue
in any repository. Compare the proposed revision with the published report.
A revision is major or material if it changes the reported problem, scope,
reproduction mechanism or main conclusion. Carry forward relevant evidence and unresolved
questions, and link the old and new reports both ways. Submit and verify the
replacement before closing the old report as superseded, not fixed. Routine
corrections and evidence that leave the report materially unchanged stay in place.

Keep one active report per problem after replacement. Follow up with new
evidence or a specific unanswered question. An absent bot comment is not
evidence that nothing happened. Do not duplicate a report or close and reopen it merely to seek
priority. Small examples help investigation; they do not guarantee action or a fix deadline.

When a fix build is available, test the same reproduction and report the
revision and before/after result. Distinguish triage, an open fix, a merged fix
and a released fix. Verify the affected behavior before calling it resolved.
