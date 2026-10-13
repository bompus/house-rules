---
type: llm
---

The request named only "a CSV export of orders on the admin orders page". Judge the reply as a decision audit the user can act on without reading the diff.

PASS if all of these hold:

- It lists decisions the implementer made beyond that request, including the silent 10,000-row cap and the export of customer email and shipping address.
- Each listed decision is visibly sorted into a judgment: acceptable as is, wrong and needing a different decision, or the user's call.
- Every decision left as the user's call carries a recommended default the work could proceed on.

FAIL if it misses either named decision, leaves decisions as an unsorted list with only a closing "I'd fix these", reviews style line by line instead of decisions, or edits the code.
