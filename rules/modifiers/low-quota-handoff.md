---
description: When the current model's usage allowance runs low, write a handoff before work stops.
after: Finishing work
requires: hr-handoff
---

## Low-quota handoff

Check your remaining usage allowance at session start or resume, after a model
switch and before substantial new work, using a reading the host shows or the
user reports. When a fresh reading shows the current session's provider and
model with less than 5% of its daily, weekly or monthly allowance left, use the
`hr-handoff` skill to checkpoint the work. Another model being low, context size
and token totals do not trigger it. When no reliable reading is available, say
once that detection is unverified; never guess a low balance or poll for one.

This handoff is a stop under § End of every reply: after saving it, end the
reply with the handoff report and its recorded next action, which serve as the
offer, and do no further work until the user resumes it.
