---
name: hr-change-impact
description: "Check what a change can break beyond the lines it edits, and back the claim that it is safe with something that ran. Use when the user asks what a change might break, wants its impact checked before merging, or distrusts a small diff."
disable-model-invocation: true
---

# Change impact

The diff shows what changed. This skill asks what else depends on the old
behavior, and whether the change is safe for a reason someone has seen work.
Follow project guidance for commands, test runners and domain safeguards.

## Scope the change

Read the whole diff and the code around each hunk. Write one or two sentences
on what the change does, including behavior a reader of the diff could miss:
a new default, a reordered side effect, a changed error type, a value that is
now computed lazily or cached. If you cannot explain the change yet, read the
code first (see `hr-explain-code`) before judging its impact.

When the reason for old behavior affects the risk, inspect relevant history.
Use a scoped `git log -p` or `git log -S<symbol>` where it can answer that
question; a literal symbol search may miss renames or indirect behavior.

## Look past the call sites

List direct callers quickly; a compiler or a symbol search usually covers them,
and they are rarely where the surprise is. Spend the effort on coupling that a
symbol search does not see:

- **Stored and serialized shapes.** Field names, enum values, JSON keys,
  cache keys, database columns, file formats and anything written today and
  read back after a deploy or by an older version.
- **Other readers.** Another process, service, job, script or client that
  consumes the output, the queue message, the log line or the API response.
  Search for the literal strings, not only the symbol.
- **Supported surfaces.** Other screens, entry points, clients, providers and
  connection modes that reach the behavior. Check reverse operations and
  state transitions too, such as enabling/disabling or connecting/disconnecting,
  when the feature supports them. Use the project's actual supported cases;
  do not invent surfaces or expand project-mandated verification to cover
  unsupported cases. Keep the focused probe below when existing tests do not
  exercise a load-bearing assumption.
- **Timing.** Startup order, background workers, scheduled jobs, retries,
  timeouts and shutdown. A change that is correct on the request path can
  break a job that runs once a night.
- **Configuration.** Environment variables, feature flags, defaults that
  differ between environments, and code paths only one flag value reaches.
- **Dependencies as pinned.** How the library behaves at the version in the
  lockfile, including local patches the project applies, not the version in
  current upstream docs. Check the effective installed source, patch files or
  changelog when the change relies on a specific behavior.

Each search is a finding. "No other reader of `order_status` found in this
repository or its deploy config" is worth reporting; say where you looked.
Never name a caller, consumer or API you have not seen at a real location.

## Find the load-bearing assumption

A change that looks risky usually rests on one or two facts: no
consumer reads the old field, the flag is off in production, the migration
runs before the new code. Name those assumptions explicitly. Then put most of
the remaining effort into confirming or breaking them, rather than adding more
hypothetical risks to a list.

A risk that depends on an assumption you have already confirmed does not need
its own entry. A risk nobody can check deserves a sentence on why it cannot be
checked and who could.

## Back each claim

A claim can rest on your word alone, on a source location that shows it, on
a failure path you walked step by step, or on real code that ran and gave the
result. These are not equal, and the reader cannot tell them apart unless you
say. Next to each important claim, state in a few words what backs it: "the
only reader is `billing/export.py:88`", "traced: a missing key falls through
to the default", "ran `test_legacy_payload`, passes".

Get the load-bearing assumption to something that ran. A careful trace is
enough for lesser claims. A claim with nothing behind it is a gap; report it
as one instead of dressing it up.

Prefer evidence that already exists: run the tests that cover the changed code
and read what they actually assert. When none exercise the assumption, write
the smallest probe that does, such as a script that round-trips an old
serialized record through the new code. Keep probes outside committed source,
or delete them before reporting, and say in the report that you did.

## Report

Use these parts, in order:

1. **What it does**: the change in plain terms, with the non-obvious behavior.
2. **What it relies on**: each load-bearing assumption, its support, and
   whether it held.
3. **Risks**: for each real one, the location, how likely it is, what it costs
   if it happens, and how to check it.
4. **Ruled out**: concerns you examined and dismissed, with where you looked.
   This keeps a reviewer from redoing the same search.
5. **Before merging**: the specific check to run, with the command when there
   is one, or "none needed" with the reason.

Keep the list of risks short. Three real ones with locations beat fifteen
possibilities.

## Related skills

- `hr-explain-code` when you need to understand the code before judging a change.
- `hr-code-review` for standards, style and spec conformance of the same diff.
- `hr-diagnosing-bugs` once something is actually broken.
