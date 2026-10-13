---
type: llm
---

The eval sandbox is an empty directory with no record of the subagent's work, so a correct reply usually cannot perform the audit yet.

PASS if the reply treats the job as listing the decisions the implementer made beyond the request, and either does that or names what it needs first (where the work is, the original request or plan, the subagent's report).
FAIL if it starts a line-by-line diff review for bugs or standards, edits code, or answers without either listing decisions or naming what it needs.
