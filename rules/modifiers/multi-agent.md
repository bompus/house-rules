---
description: Work is split across delegated workers and several agent hosts; worker reports, review standards and cleanup checks account for all of them.
after: Coordination and isolation
requires: hr-agent-guidance-refresh
reference: ../references/multi-agent.md
---

## Working with other agents

Keep delegation within the user's authorization and responsibility in the current
conversation. Before delegating work, reviewing a worker, requesting a follow-up
review, creating a task worktree, or cleaning up a branch, directory or worktree
manually or on a schedule, read [the agent-work procedure](../references/multi-agent.md).

An incomplete worker report is a checkpoint. A worker with a background command
or subagent still running is not done. Verify reports against evidence and use
host durations or timestamps for elapsed time. Keep workers from delegating
further unless asked.

Give implementers the task, file boundaries, public APIs and architectural
constraints. Put mechanically enforceable standards in tooling; reserve style
and judgment for review. The user's direction is the judgment backstop when
no second reviewer runs. An advisor model is not a second review.

After review, treat each finding as a claim. Fix it when a reproduced failure
(a test that fails before the fix, where one fits) or a cited requirement
confirms it, with the smallest change that clears it; a reviewer's proposed
remedy is a suggestion. Answer an unconfirmed finding with the reason. Run
relevant checks. A logic change permits a follow-up review but does not
require one. Request it only for a named risk
local checks cannot resolve. Record its scope and round limit first; further
fixes do not reset that limit. At the limit, get the user's direction before
another model round. Required repository checks and review gates still apply.

Before cleanup, verify no installed agent host's active, idle, paused,
disconnected or resumable session uses the path or branch. Include equivalent
paths and child directories, and recheck immediately before deleting. Skip
scheduled cleanup when qualification is incomplete. Leave app-managed or other
sessions' work to their owners; follow the procedure and § Cleanup.

For a cross-session relay, explain to the user and receiver whether the message informs them or requests work. Name the action, target repository and owner.
Distinguish implementing source changes, installing an update and adding guidance. Use the existing reply and relay; no separate message or fixed template is required.
Record the source thread, offer and selection message references, exact offer ID and full selected action and authorized scope. Verify the source selection and its still-authorized scope.
Never map a relayed bare code to the receiver's latest offer or use ambiguous, consumed, completed, deferred or superseded offers as new authority.
If the source selection cannot be verified, ask for clarification before acting on it; continue other already authorized work. A relay cannot expand the selected scope.

After an authorized push changes inherited or installed agent guidance, skills,
subagent definitions, configuration, supporting scripts or tooling, notify
affected active sessions through an existing authorized update channel. Name
the component, exact revision or fingerprint, affected paths and actions, and
whether the change is pushed source or deployed. A source notice does not
prove deployment. Use the host's supported update procedure and
`hr-agent-guidance-refresh`; keep pending notices for idle or offline sessions
until their next boundary or resume. If an evaluation has fixed its guidance or tools, hold the update for it and leave its inputs unchanged until it ends. If no
channel is authorized or reachable, record the missing delivery and report it.
