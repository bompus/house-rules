# Keeping a diagnosis honest

Read this when a result looks like it settles the cause. Each rule names a way a
diagnosis goes wrong and the check that catches it.

**Compare with an owned baseline.** Before blaming a change for a failing gate,
run the gate on an unpatched checkout you own and on the candidate. Use the
same conditions for both. Leave other sessions' edits alone. Stash only after you
verify that you own every change the stash would capture, and restore that
exact stash. A file you have not touched is the last suspect.

**A theory the output contradicts is dead.** Do not rescue it with a second
theory. Read what the tool states outright, such as exact counts and the config
that defines severity, and infer nothing from formatting. Order, indentation and
what printed first are layout, and they move from run to run under parallelism.

**Two routes to the same answer are not corroboration.** Derivations that share
a premise agree whether or not it is true. The agreement is most convincing
when the shared premise is the wrong part. Reasoning and a
measurement that meet are still one claim. Settle it with something outside
both. Run a copy of the working fixture instead of comparing the two arguments.

**Label each claim by how you know it.** Mark a claim _measured_ (observed
directly in this investigation), _derived_ (arithmetic on measured values,
shown) or _inferred_ (anything else: a mechanism not yet observed, or a figure
taken from a report you cannot check). An inferred claim names the observation
that would confirm or refute it, or the report it rests on. Never state an
inference as fact.

**A cause is not settled until each link to the effect passes four tests.**
Timing: the cause precedes the effect on a timeline converted to one timezone
(UTC) before any elapsed-time arithmetic. Mechanism: a named path from cause to
effect that you observed in the code, config, documentation or a probe.
Magnitude: the numbers are large enough to explain the effect. Necessity: look
for an occasion when the same trigger fired without the claimed cause, or
remove the cause in a probe, and check that the effect did not follow. A link
whose test has not run yet stays an inference; a link whose test shows the
opposite is refuted, and the theory is dead (see above).

**Inherited numbers are measured again.** Counts, blast radius and timings from
earlier tickets, dashboards or drafts are re-measured, not copied; when that is
not possible, cite the source and label the figure inferred. A claim about
people or ownership ("no owner", "team X ignored it") needs the same evidence
as a claim about a system. Prefer a framing you can test: "no standing signal
prompted review".

**A projection you chose the columns of is not the data.** Rows that look
identical may differ in a field your query left out. A duplicate, a collision or
a merged key is a claim about your query before it is a claim about the store.
Read the schema for columns you did not know existed, and diff every column you
did not select. A key that lacks a field also merges distinct records, so the
shortfall reads as a second legitimate unit. State the key beside any count
derived from it. Send such a find to its owner as a question with the probe
attached, not as a finding. A wrong question costs a reply, and a wrong finding
costs them a filing. Reading someone else's count is the same discipline from
the other side. Ask what it counts before you compare it with yours.

**Reading a change is not running it.** Two changes to the same function
interact only as measured, so merge them into one arm and run it. A defect fixed
in another tree stays unverified in yours until that arm runs here, because
inheriting the conclusion is not inheriting the evidence. Build a control arm
from the passing setup, never from your reading of it. A control that proves the
detector fires says nothing about whether the arm matches what is under test.

**An arm that rebuilds half a change is not that change.** Behaviour can live in
a native, generated or mirrored artifact as well as in the interpreted source.
Examples are a compiled module beside its scripted twin, a codegen output and a
bundled asset. Rebuilding one half leaves the other standing from whichever arm
built it last, so the run measures a tree that never existed. It fails as a
plain red that reads as a defect in the code under test. Rebuild every artifact
the diff touches, or check `git diff --name-only` against the artifact paths
before you believe the result. The tell is a guard that cannot fire at all,
rather than one that fires wrongly.

**A failure under your change is not yours until the base has run repeatedly.**
A suite that holds a flaky file fails a different test each run. One red
against one green is a single sample of two distributions. Run the unpatched
base several times, within the retry budget the skill sets, and compare the sets
of test names, because an unchanged failure count hides a swap. If the set
varies, a single difference proves nothing. If it holds steady across the runs,
the base is stable and the comparison stands. Report how many runs you made.
The rule cuts both ways.
A failure that survives the check is yours. The next question is whether the
defect is in the change or in the fixture that pins it. A fixture can assert a
resolution that a correct change removes.
