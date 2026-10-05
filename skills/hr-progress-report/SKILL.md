---
name: hr-progress-report
description: "Report the current task's activity, completion evidence and remaining wall-clock time. Use for task status, progress, completion percentage or ETA requests. Session-roster and liveness checks belong to the available coordination tools."
---

# Progress report

Produce a dated snapshot of the requested task. A status request does not
cancel authorized work or authorize new work. Resume work after the report
under the governing continuation and offer rules.

1. Identify the task's goal, selected scope and completion criteria. Read
   the relevant plan and latest results. Name the records checked and any
   missing coverage. Keep unrelated backlog items outside this task report.
2. Verify current activity with available job state or recent results.
   Distinguish working, waiting, blocked and idle. Say when activity cannot
   be verified; a saved task description alone does not establish current work.
3. Reconcile completed and remaining milestones against the completion
   criteria. Include validation and landing when they belong to the selected
   scope. List blockers and who or what can resolve each one.
4. State the basis for a completion percentage. Use bounded work units or
   milestone weights recorded before this report. Label a simple milestone
   count as milestone completion, not a share of remaining time. During
   open-ended investigation, report percentage unknown and the evidence gathered.
   Explain scope changes that alter an earlier percentage. Report full
   completion only when every selected completion criterion is satisfied.
5. Show elapsed wall-clock time and remaining ETA under the governing
   estimate policy. Without one, use comparable finished runs or observed
   job progress and name the basis. Include tests, CI, review and fix rounds,
   integration and dependency waits. Give a range and confidence when the
   evidence supports them. Mark missing evidence or unbounded external waits
   unknown or unmeasured. Give a running job's finish forecast separately
   from the whole-task ETA. Include the timezone for clock-time forecasts.
6. Lead with the task's state and current action, followed by a compact
   table. Separate verified facts, session estimates and unknowns. End with
   the next action or required decision using the governing offer format.

| Field | Report |
|---|---|
| Task / state | Goal, selected scope; working, waiting, blocked or idle |
| Current action | Action and supporting job state or recent result |
| Progress | Completed milestones, percentage basis or unknown |
| Remaining | Unfinished milestones, including checks and integration |
| Elapsed / ETA | Wall-clock time, evidence, confidence and waiting conditions |
| Blockers / next action | Dependency, owner or decision needed |

This is a snapshot, not independent proof of another session's activity.
Use existing tools and records. Do not start watchers, ping other sessions
or change schedules merely to produce the report.
