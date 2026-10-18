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
