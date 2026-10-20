---
description: Only benchmarks and other performance measurements wait for a quiet host; other work runs whatever the load. Very large jobs still run under a memory cap.
after: Coordination and isolation
---

## Shared machine load

Work that is not a benchmark, timing run or other performance measurement is
never delayed, serialized or refused because the host is busy, and needs no lock
or admission check. Several heavy jobs may run at the same time. Checking and
reporting load or running jobs stays allowed; what you see informs the report and
never holds the work back. A limit the user states for a run still applies.

A benchmark, timing run or other performance measurement keeps every rule of
`hr-benchmarking`. That includes keeping other work from competing with the run
and rejecting a run that competing load disturbs. It also includes any lock or
admission step the host defines for measurements. While a measurement that needs
the machine to itself is running, work that would compete with it follows that
measurement's isolation rules. The wait comes from the measurement, not from the
load.

Memory limits stay in force whatever the load, as protection against a crash.
Work risks exhausting memory when its expected or last measured peak leaves
little headroom in the memory available to it, or when its peak is unknown and
its input is large. Constrain such work using the host's supported controls.
Retry with a larger budget only when host evidence shows memory pressure caused
the failure; without that evidence, find the cause before raising the budget.
