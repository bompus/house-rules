# What rule files hold

Use this when a finding is about where text belongs, not whether it is correct.

- Rule files hold current behavior only. History, incident stories, trial
  results and answer provenance go to a dated record with a short link.
- Split a paragraph over about 2.5 KB that holds more than one rule: one rule
  per bullet.
- A rule stated in two files has one owner and a pointer in the other. Write a
  value that changes often (a default model, a limit) once and reference it.
- Text that exists only for a transition ("until X", "not yet", "proposed")
  states an explicit end condition, and is removed once that condition holds.
  Remove a suspended or retired workflow from always-on text in the same
  change.
- A script's usage manual belongs in the script's own header, not in an
  always-loaded instruction file; an index line plus a pointer is enough there.
  Generate a hand-kept index of a directory, or cut it.
