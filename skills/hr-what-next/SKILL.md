---
name: hr-what-next
description: "Reconcile remaining work and recommend priorities. Use for next, next?, what's next, what remains, backlog reviews, walk-throughs of the backlog item by item, full-session audits of tasks and unanswered or past questions, and equivalent requests. Do not use for go or continue, which retain their acceptance/continuation meaning, or progress/ETA-only requests."
---

# What next

Turn the requested scope into an evidence-based inventory and next decision.
Before reporting, read the bundled [reporting procedure](references/reporting.md).
Use it with the governing continuation and offer rules; this request does
not cancel selected work or authorize a new task.

Before a session-completion claim, apply the governing § Finishing work's
full-session gate even when the request was only a short "next?". Save the
completed state before the completion message; a report alone does not do so.

1. Choose the review scope from the request and its context. For a short
   "next?", check the current task, its ledger and latest results, plus this
   floor whatever the scope: every question from an earlier offer in this
   conversation that the user has not answered, every owned uncommitted file,
   unpushed commit or held checkout, and the number of other live ledger items
   (deferred, unselected, blocked or follow-up) with a link to the ledger.
   When the session keeps a plan file, `scripts/check-open-work.mjs <plan>`
   computes this floor (add `--checkout <path>` for each checkout touched):
   run it and quote its result instead of recalling the ledger.
   Report each floor item, or state that the floor is empty. While any floor
   item remains, do not say that nothing is left or that nothing needs the
   user; re-present the unanswered questions as an offer instead. When asked
   for all current and past items, review the available session transcript,
   relevant plans, task lists, handoffs and linked follow-ups. Name source
   ranges and missing, inaccessible or truncated records. Sweep other
   sessions' records only within the requested project and scope.
2. Trace requests, unanswered questions, commitments, offered alternatives
   and findings to their latest disposition. Reconcile duplicate, superseded
   and stale rows with completion or replacement evidence. Keep owners,
   deferred triggers and other sessions' context visible. An old task
   description alone does not establish current activity or ownership.
3. Preserve the latest selected scope and valid unanswered offer in the
   durable ledger. Distinguish done, authorized unfinished, unselected,
   blocked, deferred and other-owner items. A completed implementation does
   not complete required checks or landing; deferral does not mean done.
   Sort every open item by what it waits on: **actionable now** (this session
   can advance it under existing authority), **needs your decision** (a
   selection or answer only the user can give) or **waiting on others** (an
   external release, issue or pull request, another project or owner, a date,
   or an app that retires it). Keep each waiting item's trigger and owner. A
   waiting item stays in the ledger and in the report with its trigger, but it
   is not work this session can do yet: do not recommend it as a next step
   before its trigger fires.
4. Rank remaining items toward the current goal and explicit priorities.
   Explain the objective and weigh expected impact, next-decision value,
   urgency, dependencies, effort and evidence confidence. Keep priority,
   readiness and authority separate. Label unknown gains rather than
   inventing scores or measurements.
5. Lead with what is complete, what remains and the next unfinished selected
   step. Show one row per remaining item with rank, state, expected impact
   and its reason, next action or decision, and owner/source where needed.
   For a full audit, put the full individual table in a durable report
   and link it beside the immediate decisions. Answer whether items are
   accounted for separately from whether selected work is complete.
   Whenever any item remains, add one visual beside the table, not only when
   the user asks to see the backlog. Group the rows by what each waits on and
   order the groups bottom-up, so what needs the user sits last, next to the
   offer: waiting on others first (one compact row each with its trigger and
   owner), then needs your decision, then actionable now. Number a decision row
   with its offer question number, keep the actionable-now group even when it
   is empty ("Nothing"), and put the highest-ranked item last within a group.
   Where the host cannot render a visual, give a text outline in the same order.
6. Continue work that can advance under existing authorization. Ask only for
   unresolved choices using the governing offer format. Preserve schedules
   and ownership; this audit grants no authority to start, transfer, publish
   or clean up work merely because it appears in the inventory.

## Walk-through

When the user asks to go through the backlog item by item, run it in groups:

1. Rank and save the report as above. Show one visual of the whole ranked
   backlog, grouped and ordered as in step 5, with the current group marked
   and last; use a text outline where the host cannot render one. The
   decisions stay in the text offer.
2. Put items in one group when one answer can cover them: the same owner, the
   same action or one dependency. Ask one group per reply, one numbered
   question per item with one combined acceptance line.
3. Record each answer in the ledger before acting, then close that group's
   offer. Show the visual again with the next group marked before asking it.
   `go` selects the recommendation in the latest open group only.
4. After the last group, show the visual with what closed and what still
   waits.

For a full audit, save a mapping from reviewed source records to items or
reviewed context-only dispositions. If `hr-handoff` and its reconciliation
resources are available, reuse its `references/reconciliation.md` procedure
and `scripts/check-reconciliation.mjs` checker. Otherwise retain the mapping
and coverage gaps without claiming a mechanical check. A passing checker
accounts for supplied records; it does not prove every promise was understood
or that unavailable history contains no other work.
