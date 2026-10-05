---
name: diagnosing-bugs
description: Investigate unknown-cause or intermittent bugs and performance regressions systematically. Evident fixes only on explicit diagnosis requests; exclude change reviews.
---

# Diagnosing bugs

When filing an upstream bug, follow [Reporting a bug](references/reporting.md)
for reduction, submission and fix verification.

Follow project guidance for source paths, domain safeguards, tests and deployment.
Read relevant domain documents when they help explain the affected behavior.
Choose the next probe from the evidence; these techniques are not mandatory phases.

## Establish the symptom

Identify expected and observed behavior and seek a repeatable signal for the
reported failure. Source inspection and initial hypotheses can help construct it.
Prefer an existing test, command or captured input before building a harness.
Minimize the scenario when doing so helps distinguish causes or create a useful
regression test; an exhaustively minimal reproduction is not a prerequisite.

For intermittent failures, record attempts and failures under comparable
conditions. Increase the reproduction rate when practical within host load and
environment safeguards; do not impose a fixed retry count or success threshold.
For performance regressions, establish a measured baseline before changing code.

If reproduction is unavailable, continue useful source and artifact analysis,
label hypotheses as unverified, and report what would confirm them. Ask for
missing access or evidence only when it blocks further progress. Production
instrumentation still requires the applicable authorization.

## Distinguish causes

State a falsifiable prediction for the likely cause and test it. Consider
alternatives when evidence is ambiguous or a probe fails; there is no hypothesis
quota. Use targeted inspection, a debugger, logs, replay, bisection or differential
testing according to the uncertainty each resolves. Keep probes attributable by
changing one relevant variable at a time where practical.

When the cause depends on event order between actors, control the relevant
boundaries in an implementation test. Pause a response or write, interrupt the
process, then resume or restart it and assert the visible result. Use barriers
or explicit signals instead of sleeps to force the failing order. When the
failing order is unknown, the `ordering-tests` skill enumerates the orderings
through the real code and names the sequence that breaks.

Keep secrets out of commands and shared artifacts; use environment variables
for credentials and redact captured headers or logs before displaying them.
Tag temporary instrumentation so it can be found and removed. When a human must
perform a reproduction step, give clear steps and the expected observation.

## Bound the loop

When retrying a probe or fix, cap attempts per hypothesis, stop on
no-progress (repeated identical calls, oscillation, unchanged error class),
and enforce time/token/cost ceilings outside the agent so a stuck loop
terminates instead of retrying.

## Question the premise

When two fixes that rest on the same assumption have failed the same check,
stop fixing and test the assumption. Write it down as the one sentence every
failed fix took for granted. Before a third fix, gather evidence that would
show the sentence false, such as a count per input, actor or run, and keep it
as a script that can be rerun. If the evidence contradicts the sentence, find
what made it false and fix that, instead of compensating for it on every run.
If the evidence supports the sentence, keep it as a record and look for the
cause elsewhere. (Adapted from pstack's `principle-attack-the-premise`.)

## Fix and verify

When the confirmed cause admits more than one viable fix, such as a targeted
workaround versus a root-cause correction, present the fixes as an offer (the house rules' § Offers) with
rough relative effort before changing code. Mark the recommendation and name
the right fix when it differs, with the reason: scope, risk, blast radius or
existing debt. Skip this when the evidence supports a single obvious fix or
the user already prescribed the remedy.

Make the smallest fix supported by the evidence. Use a regression assertion that
exercises the actual failure when a suitable seam exists and the change warrants
it under project guidance. It must fail on the pre-fix code for the intended
reason and pass after the fix, as `test-audit` requires. Test-first ordering is optional
unless requested or required by the project.

Recheck the original symptom, including the original scenario if a minimized
case was used. For intermittent or performance issues, compare measurements and
report their limits. If verification is blocked or coverage lacks a suitable
seam, state the gap rather than claiming the fix is proven or expanding the
architecture without authorization.

Remove temporary instrumentation and throwaway artifacts. Report the cause,
change, checks actually run and remaining uncertainty. Recommend preventive work
only when the evidence supports a concrete benefit; follow project completion
and scope boundaries.
