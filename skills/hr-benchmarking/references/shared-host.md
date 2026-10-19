# Shared-host controls

Read this when other sessions or services share the machine and brief bursts
keep failing admission, or when a new protocol needs a low-rate observer.

## Pinning a measurement to whole cores

A fenced-core arm keeps other work off chosen CPUs for a finite phase. It is a
declared sensitivity arm and needs the machine owner's authorization, because it
changes other work's CPU placement.

1. Choose the benchmark CPUs as whole physical cores (include SMT siblings) and
   pin every arm, its browser or runtime and its children to them.
2. Move every other thread you are permitted to change off the benchmark CPUs.
   Record each thread's identity (process ID, thread ID, birth ticks) and its
   original affinity. Stop and signal nothing. A thread that sets its own
   affinity, or is created with an explicit mask, can stay eligible on the
   benchmark CPUs; the gate still counts its CPU.
3. Gate on foreign CPU on the benchmark CPUs: their busy time minus only the
   recorded workload cgroup's CPU over the interval. Do not subtract reaped-child
   CPU counters: they can include CPU used before the interval, so the result
   would understate foreign load. Cgroup CPU is not per CPU, so the subtraction
   holds only while the whole tree stays on the benchmark CPUs. Check every
   thread's effective affinity at the start and end of each batch and reject the
   batch if any ran elsewhere. Boundary checks miss a thread that widens and
   restores its affinity within the batch; when the workload can change its own
   affinity, confine the tree with a cpuset it cannot widen. In the same census,
   record every other permitted thread still eligible on the benchmark CPUs as
   unfenced. Report host-wide load as context.
4. At the phase boundary, restore the recorded threads after checking their birth
   ticks. Threads started during the window inherited the fence; give them the
   CPU set they would otherwise have inherited, usually all CPUs. A still-fenced
   thread can start another while you restore, so repeat the census until a full
   pass finds no permitted thread left fenced. Do not freeze processes to stop
   thread creation. Run this cleanup even when the phase fails.

Report results as constrained to the pinned setting, with the effective
affinities. Processes you cannot change (other users, system services) stay
unfenced; record them. In a virtual machine, guest affinity does not reserve
host cores; host activity, shared cache, memory bandwidth and power limits still
apply.

## Observer budgets

For a new protocol with a low-rate process or counter observer, use these
provisional collection budgets. A protocol already frozen keeps its own limits
and rejection verdicts.

| Cost               | Provisional budget                | Required accounting                                                                                                    |
| ------------------ | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| CPU                | At most 3% of workload CPU        | Sum collector and reader CPU on each platform over aligned envelopes; report milliseconds and average core-equivalent. |
| Resident memory    | At most 512 MiB combined peak     | Record peak resident memory per platform; a sum of lifetime peaks is conservative and may double-count shared pages.   |
| Logical log writes | At most 1 MiB/s during collection | Count persisted bytes over the recorded collection interval; measure attributable physical I/O separately.             |

These are engineering budgets, not calibrated interference thresholds. Record
setup cost separately and keep the free-memory reserve after the observers
start. Missing required cost fields leave qualification incomplete; list
indirect provider or writeback costs as unverified when they cannot be
attributed. The budgets neither raise the concurrent-work allowance nor certify
unaffected timing. A different workload or precision target needs its own
prospective qualification.
