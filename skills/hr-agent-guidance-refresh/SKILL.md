---
name: hr-agent-guidance-refresh
description: "Reread the agent guidance a session loaded (instruction files, skills and subagent definitions) and report what changed since. Use for reload requests, session start or resume, or a signal that guidance was updated."
---

# Agent guidance refresh

Injected rules and skill catalogs can retain an earlier snapshot. This skill
rereads guidance and checks supported discovery; it does not authorize
installation, configuration changes, model calls, new probes or provider restarts.

1. At start or resume, and at the next affected-action boundary after an update
   signal, list what the session inherits or uses. That is the repository
   instruction root, the rules, docs and skills it names with their resources,
   and any subagent definitions. Compare them with this session's last refresh
   record. If no record exists, read the applicable guidance and establish that
   baseline.
2. Finish the active operation before refreshing. When an evaluation fixes its
   guidance or tools, hold the update until that context is released and leave
   its inputs unchanged.
3. Reread changed instructions, affected skill resources and subagent definitions
   through their indexes and the references they need. Recheck assumptions the
   changes invalidate. A reread does not prove that injected context, effective
   subagent definitions or tool discovery changed. Use a context or catalog
   refresh only when the host supports it and you are authorized. If a restart,
   reinstall or reload is needed, report the component and the action as a
   blocker; do not perform it without existing authorization.
4. Record what you reread, the identity you observed for each component and
   what stays unverified. Report changed behavior or a blocker when it needs
   attention; an unchanged check stays quiet.

When guidance verification is selected, read
[the verification method](references/verification.md) for evidence layers,
behavior checks that do not reveal the expected answer, and scoped adoption checks.
