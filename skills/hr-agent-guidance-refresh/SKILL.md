---
name: hr-agent-guidance-refresh
description: "Check deployed agent components and reread changed guidance, skills and subagent definitions; verify configuration and tooling discovery. Use for reload requests, start/resume, or an update signal before affected work."
---

# Agent guidance refresh

Injected rules and skill catalogs can retain an earlier snapshot. Use the
host's approved deployed target, not an upstream commit or pending source edit.
This skill reads guidance and checks supported discovery; it does not authorize
installation, configuration changes, model calls, new probes or provider restarts.
A pushed-source notice remains pending until the affected component is deployed.

1. At start/resume, or the next affected-action boundary after an update signal,
   check the host's deployed revision or content fingerprints against this
   session's last refresh record. Include the repository instruction root and
   applicable shared rules, selected skills and their resources, subagent
   definitions, configuration, supporting scripts and tooling. Scope this
   inventory to components the session inherits or uses. Record effective
   deployed identities through supported host discovery without exposing secrets.
   If no record exists, read the applicable guidance and establish that baseline.
   An unavailable target or approval record stays unverified; do not infer approval from a hash.
2. Keep only the newest pending target per component. An unchanged identity
   needs no repeated read or notice. Coalesce duplicate signals; a source revision
   and its deployed target remain separate evidence. Routine updates wait for
   the next affected action after the active operation ends. Keep idle and
   offline sessions pending until resume; do not start a model turn for a notice.
   Skip excluded skills and preserve explicit invocation policies, settings and repository safeguards.
3. Finish an active operation before refreshing. When an evaluation fixes its
   guidance or tools, record the target as held until that context is released.
   Do not change its inputs. If an incompatible update prevents the next
   affected operation, hold that operation for supported recovery instead of
   using an incompatible context or forcing a restart.
4. Read changed deployed instructions, affected skill resources and subagent
   definitions through their local indexes and necessary references. Inspect
   changed configuration through supported redacted summaries, never secret
   values. Verify affected script or tool versions and the actual catalog,
   configuration or callable interfaces the session would use next. Reading a
   script does not run or deploy it. Recheck assumptions invalidated by changes.
   Use supported context, catalog or tool refresh only when its capability and
   authorization are established. A reread does not prove injected context,
   effective subagent definitions, process configuration or tool discovery changed.
   Record unsupported or failed paths. If a restart, reinstall or reload is needed,
   report the component and required action as a blocker; do not perform it without
   existing authorization.
5. Record each component's source and deployed targets, affected paths, refresh
   action and observed effective identity. Keep these results separate
   from installed-byte checks, catalog discovery, delivery acknowledgements and
   behavior tests. Mark components current only for the evidence obtained;
   keep pending, held, unsupported and offline states explicit. Disconnected
   sessions compare targets on resume. Update the pending target without
   repeating its notice; report blockers when action is needed. Never treat an
   acknowledgement as proof of loaded context.

When guidance verification is selected, read
[the verification method](references/verification.md) for evidence layers,
answer-blind probes and scoped adoption checks.

For an explicit source-update request, follow the owning checkout's adoption
procedure and authorization before changing files. Upstream/source drift alone
is not a newer deployed target. Report changed behavior or a blocker when it
needs attention; an unchanged check stays quiet.

When the host supplies Swarmail updates, follow the connected product
instructions and `swarmail updates --help`. If those instructions are hidden
or omit needed detail, locate the owning checkout's `docs/updates.md` at the
installed or approved revision. Keep unsupported details unverified. Other
hosts may supply a different qualified update signal.
