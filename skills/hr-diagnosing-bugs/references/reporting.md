# Reporting a bug

Before filing, apply the submission search in your loaded agent guidance's "Repository work" section.
If that section is unavailable, locate the local house-rules checkout and read
`rules/core.md` there. Report an unavailable local source before submitting.
Inspect labels, linked changes and timeline actions as well as comments.
For the same problem and scope, add new evidence to a matching open issue.
When a closed report still reproduces and remains materially unchanged,
explain the failed fix or changed conditions and request reopening. If reopening
is unavailable, file one linked follow-up. For material changes, use the
replacement workflow below.

Reduce the failure to the smallest self-contained reproduction you can verify.
Remove unrelated code, dependencies, data and setup. Keep reducing until each
remaining part is needed to reproduce the failure. For a library failure,
trace the failing path and isolate its underlying runtime API or language
operation. Use source inspection, profiling or controlled substitutions to
choose the next reduction; a slow dependency does not establish its cause.

Verify both the final reduction and the original scenario with exact commands
and pinned versions. Preserve the inputs, output checks and relevant allocation,
retention, concurrency or lifecycle behavior. A similar standalone failure is
a contributor observation until evidence connects it to the original symptom.
For performance or memory bugs, compare equivalent work under the applicable
benchmark protocol. State units, repetitions, variability and measured controls;
put the focused case before a larger comparison matrix.

Include a cause-and-reduction note in the report: the isolated operation,
evidence connecting it to the original failure, and remaining uncertainty.
Test the proposed cause by changing or removing the suspected factor while
preserving the other relevant conditions. Distinguish a reproduced operation,
a supported causal explanation and a confirmed internal defect. Do not infer
an engine defect merely because one runtime is slower on a library workload.

Lead with one symptom, the reproduction, expected and actual text results,
and the versions and environment needed to reproduce it. Check the current
stable release; identify development builds separately when tested. A verified
small reproduction can be reported while its internal cause remains unknown.
Show direct reproduction commands. Omit incidental scheduling, resource-control
and observer wrappers from issue and pull request examples. When a control is
required to reproduce the defect, include it and explain why. Keep exact executed
commands in measurement records; disclose material conditions beside performance
results without presenting local controls as prerequisites or changing historical
conditions. This reporting choice is checked by the author, not a syntax gate.
When reduction is blocked, record the attempted isolations and why the remaining
parts are necessary before asking whether to submit the broader case.

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
