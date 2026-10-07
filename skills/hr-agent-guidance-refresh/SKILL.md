---
name: hr-agent-guidance-refresh
description: "Check deployed guidance revisions and reread changed rules and skills. Use for reload requests, start/resume, or an update signal before affected work."
---

# Agent guidance refresh

Injected rules and skill catalogs can retain an earlier snapshot. Use the
host's approved deployed target, not an upstream commit or pending source edit.
This skill rereads guidance; it does not authorize installation, settings
changes, model calls or provider restarts.

1. At start/resume, or the next affected-action boundary after an update signal,
   check the host's deployed revision or content fingerprints against this
   session's last refresh record. Include the repository instruction root and
   applicable shared rules and selected skills. If no record exists, read the
   current applicable guidance once and record its identity. An unavailable
   target or approval record stays unverified; do not infer approval from a hash.
2. Keep only the newest pending target per component. An unchanged identity
   needs no repeated read or notice. Routine updates wait for an active session's
   next boundary; they do not start idle model turns. Skip excluded skills and
   preserve explicit invocation policies, settings and repository safeguards.
3. Finish an active operation before refreshing. When an evaluation fixes its
   guidance or tools, record the target as held until that context is released.
   Do not change its inputs. If an incompatible update prevents the next
   affected operation, hold that operation for supported recovery instead of
   using an incompatible context or forcing a restart.
4. Read the changed deployed instruction files and affected skill content,
   following their local indexes and necessary references. Recheck worktree
   assumptions invalidated by the change. Use the host's supported catalog or
   tool refresh only when its capability is established. A reread does not
   prove that a provider's injected root, skill catalog or tool definitions
   changed. Record unsupported or failed refresh paths and their blockers.
5. Record the target, paths reread and observed loaded identities separately
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
