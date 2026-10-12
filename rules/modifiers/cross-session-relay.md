---
description: Relayed work between sessions keeps its source and authorized scope, and an authorized push that changes inherited guidance or tooling is announced to the affected sessions.
after: Coordination and isolation
requires: hr-agent-guidance-refresh
---

## Cross-session relays and update notices

For a cross-session relay, explain to the user and receiver whether the message informs them or requests work. Name the action, target repository and owner.
Distinguish implementing source changes, installing an update and adding guidance. Use the existing reply and relay; no separate message or fixed template is required.
Record the source thread, offer and selection message references, the exact offer ID when the source uses coded offers, and full selected action and authorized scope. Verify the source selection and its still-authorized scope.
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
