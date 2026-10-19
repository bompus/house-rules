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
   conversation that the user has not answered, every item deferred with only the
   user's selection as its trigger, every owned uncommitted file, unpushed commit
   or held checkout, and the number of other live ledger items (deferred,
   awaiting selection, blocked or follow-up) with a link to the ledger.
   When the session keeps a plan file, `scripts/check-open-work.mjs <plan>`
   computes this floor (add `--checkout <path>` for each checkout touched, or
   `--app-managed <path>` for one an app retires, which is reported but not a
   finding): run it and quote its result instead of recalling the ledger. Its
   "awaiting your yes/no" group lists the user-trigger deferrals by a text match.
   When every remaining item is deferred it prints "close-out due": ask the user
   to decide each item and offer `All done` or `Pause`; a plan marked paused with
   no done line recording the user's Pause is a finding.
   Its "possibly finished" group lists items whose named pull requests or
   issues are all merged or closed (add `--repo <owner/repo>` for bare numbers),
   unless a named commit sits outside a `--checkout`'s default branch,
   and "re-check due" lists `recheck:` dates that are past or within a week.
   Its "possibly resolved by a later done line" group lists open or deferred
   items whose pull request, issue, commit, thread id, offer ID or work id
   (such as `docs-fix-20261016`) a later done line also names: the result was
   likely logged as a new line instead of closing the old one.
   Look at each before reporting it as done or still waiting. Close a
   finished line in place with `scripts/close-ledger-line.mjs <plan>
   --line <n> --evidence "<what shows it is done>"`, or drop it with
   `--drop --by "<who>"`; `--match <text>` picks the line by its text. It
   refuses without evidence and changes nothing when run again. The checker
   warns when a ledger has more than 100 open or deferred lines or the plan
   reaches 256 KiB.
   It also prints `unanswered offers: N`, the number of offer IDs ("Offer
   ABC-12") on open ledger lines that no line records as answered, dropped or
   superseded, and warns at three. Plans that number offers without an ID are
   not counted.
   When the plan's header has a `Project: <name>` line, it also warns when that
   project's last `hr-forgotten-work-audit` record is missing or over 30 days
   old; offer the audit then.
   Report each floor item, or state that the floor is empty. While any floor
   item remains, do not say that nothing is left or that nothing needs the
   user; re-present the unanswered questions and ask the undecided items (step 6). When three
   or more offers from this conversation are open and unanswered, do not
   re-present them one by one: start a walk-through over them. When asked
   for all current and past items, review the available session transcript,
   relevant plans, task lists, handoffs and linked follow-ups. Name source
   ranges and missing, inaccessible or truncated records. Sweep other
   sessions' records only within the requested project and scope.
2. Trace requests, unanswered questions, commitments, offered alternatives
   and findings to what was last decided or done about them. Reconcile duplicate, superseded
   and stale rows with completion or replacement evidence. Keep owners,
   deferred triggers and other sessions' context visible. An old task
   description alone does not establish current activity or ownership.
3. Preserve the latest selected scope and valid unanswered offer in the
   durable ledger. Distinguish done, authorized unfinished, awaiting selection, dropped,
   blocked, deferred and other-owner items. A completed implementation does
   not complete required checks or landing; deferral does not mean done. A
   deferral is not a yes or no: an item deferred with only the user's selection
   as its trigger is undecided, so it sorts under needs your decision.
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
   Where the user's rules have a backlog view (§ Backlog view, an optional
   rule), show it beside the table whenever any item remains, in the format that
   rule gives. Without one, the table alone is the report. The offer itself
   follows the offer rules, which make an offer visual only when the user asks
   for one.
6. Continue work that can advance under existing authorization. Ask only for
   unresolved choices using the governing offer format. Invoking this skill is
   asking for the backlog (§ Session purpose), so present every needs-your-decision
   item as an offer, or as a walk-through when three or more questions are open,
   instead of only counting it. Record each answer as yes, no
   (dropped) or defer with a trigger other than the user's selection, so the
   item is not asked again on every run. A no is dropped, even when it names
   what would make the user reconsider. Defer only work the user wants done later. Items waiting on others stay listed
   with their trigger and are not asked. Preserve schedules
   and ownership; this audit grants no authority to start, transfer, publish
   or clean up work merely because it appears in the inventory.

## Walk-through

When the user asks to go through the backlog item by item, or three or more
offers are open and unanswered, run it in groups:

1. Rank and save the report as above. Where the user's rules have a backlog
   view (§ Backlog view), show it for the whole ranked backlog with the
   current group marked and placed last among the decisions. The decisions
   stay in the text offer. When
   stacked offers start the walk-through, mark each superseded in the ledger,
   keep its option text, and queue its questions as groups.
2. Put items in one group when one answer can cover them: the same owner, the
   same action or one dependency. Ask one group per reply, one numbered
   question per item with one combined acceptance line. Ask first the group
   whose answers change or unblock the others, then one with a date, then the
   rest; a decision whose prerequisite is still open waits for a later group.
   Say how many groups remain and name the next.
3. Before asking a group, look up what one read-only call can answer (why a
   run failed, whether a setting already exists) and show the finding beside
   the question. Ask the user only the decision.
4. Record each answer in the ledger before acting, then close that group's
   offer. Show the backlog view again, when there is one, with the next group
   marked before asking it.
   `go` selects the recommendation in the latest open group only. A result or
   handoff that brings its own offer while the queue is open joins the queue
   with one line; it does not become another standalone offer.
5. Stop when no decision remains that the user can make now. Record each
   leftover with the condition that would reopen it. Say what closed in the
   text, and show the backlog view, when there is one, with what still waits;
   the view lists open items only.

For a full audit, save a mapping from reviewed source records to items or
reviewed records kept only as context. When the report rebuilds a ledger or
inventory from an earlier one, treat the earlier one as a source. Carry each of
its open or deferred lines over as an item, marked done with its outcome when it
has closed. Several lines may share one item only when the same next action
and completion evidence satisfy every line. A summary row such as "the rest,
reopen only if asked" loses those lines. If `hr-handoff` and its reconciliation
resources are available, reuse its `references/reconciliation.md` procedure
and `scripts/check-reconciliation.mjs` checker. Otherwise retain the mapping
and coverage gaps without claiming a mechanical check. A passing checker
accounts for supplied records; it does not prove every promise was understood
or that unavailable history contains no other work.

## Machine reconciliation

For a host that checks the reply boundary, add `--json --session <id> --turn <id>`
to the existing floor command. It emits a bound `reconciliation` receipt alongside
the usual report. An invalid plan exits `1`, even when displayed groups are empty.
Exit `2` reports open work or findings and does not classify readiness or authority.

The house-rules repository's `evals/end-of-reply/README.md`, Adapter migration,
defines version-2 records, exact item coverage and adapter migration. The floor
only supplies snapshot identities; the producer must explicitly classify each
item. Source availability does not establish host enforcement.
