---
name: hr-manual-qa
description: "Make a reproducible manual verification checklist when the user requests manual QA, or a change needs a device, access or human judgment the agent lacks. Exclude checks the agent can automate or perform itself."
---

# Manual QA

Turn changed behavior and credible regression risks into observations the user
can reproduce. Follow the project's verification and domain safeguards.

1. Identify the changed flow and its expected behavior from the request, diff
   and existing requirements. Name missing information that affects a check.
2. Reuse verification results already obtained and run remaining relevant
   agent-accessible checks within current authorization. Report each check's
   command or context and actual result: passed, failed, blocked or not run.
   Keep failed checks visible; a manual checklist does not establish a pass.
3. Select the observations that still need the user's device, access or
   judgment. Keep agent-runnable checks with the agent. When no manual
   observation is needed, say so instead of inventing a checklist.
4. Ground regression checks in the changed flow and supported surfaces. Use
   available impact findings and UI guidance. When a consequential risk needs
   investigation and `hr-change-impact` is available, use it for that risk;
   otherwise name the uncertainty. A checklist does not require a full impact
   assessment.
5. Present agent results first. When a manual observation remains, include a
   quick smoke check of the changed flow and any further required user checks.
   When none remains, do not request a user smoke check. Each manual check names:
   - **Setup**: device, account, data and navigation needed to reach the state.
   - **Action**: the interaction to perform.
   - **Expected observation**: the visible result that distinguishes success
     from failure.
   - **Reason**: the changed requirement or credible regression it checks.
     Keep the smoke check short without omitting required coverage to meet a
     time limit. Report access gaps and checks still awaiting the user.

Done when each required manual observation has a reproducible check or a named
coverage gap. Distinguish agent verification from user checks still pending.
