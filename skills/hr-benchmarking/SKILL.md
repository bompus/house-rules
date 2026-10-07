---
name: hr-benchmarking
description: Benchmark equivalent work with repeated timing, CPU and RSS.
---

# Benchmarking

Follow the repository and host's commands, resource limits, authorization and
landing rules. Reuse an existing workload and runner before building a harness.
Read [the tool reference](references/tools.md) when selecting a benchmark,
profiler or correctness check, or interpreting its measurements.

## Define the comparison

State the question, baseline, candidate, representative input and timed region.
Exercise ordinary supported inputs and cases that disable an optimization.
State any restrictions behind a performance claim.

For a requested candidate set, record its inventory and distinguish
configurations or capacity modes. Keep untested, invalid and unsupported
candidates visible with reasons. A subset comparison establishes results only
for its tested scope, not a winner across the full inventory.

Before running, list the selected engines, workloads, metrics, controls and
repetitions. Count the planned runs explicitly, including controls and stages;
state which decision each retained dimension helps make. Choose combinations
for that decision rather than automatically running every combination. Use a
broader matrix when its required coverage is stated.
Name the measurement unit: request, operation, batch or whole command. State
whether setup, startup, compilation, input loading, retries and cleanup count.

Record exact runtime, compiler, dependency and runner versions, build flags,
input identity and source revisions. Keep these fixed across repeated arms;
reject mixed versions when resuming a checkpoint. Compare runtime knobs within
the same build. Use equivalent outputs, release settings and comparable tuning.
An untuned arm compares configurations rather than implementations.

Keep warm and cold conditions explicit. Reset state or use fresh processes
where the question requires independence. Record warmup and cache conditions.
A reused service needs equivalent state across arms, not an arbitrary restart.

## Confirm the work

These validity checks adapt [pstack's benchmark checklist](https://github.com/cursor/plugins/blob/main/pstack/skills/benchmark-checklist/SKILL.md).

Validate outputs, consumed results and error counts outside the timed region
where practical. Confirm requests arrived and asynchronous work was awaited.
Include failures, timeouts and unresolved attempts in both arms' denominators.
A faster wrong result or skipped operation is not a performance improvement.

Identify the limiting resource from CPU versus wall time, resource counters or
a separate profile. Check that throughput is possible given the machine and
input. When the generator limits the result, report that limit.

## Measure without changing the experiment

Coordinate resource use under the host's rules. During isolated local performance
measurements, the measuring session only monitors. Other sessions may do light
work within the run's resource limits. Keep measured files, toolchains and
services unchanged.

Prefer removing competing work to raising priority. Record effective CPU and
I/O scheduling policies and memory protections; keep them equal across arms.
Use deployment settings for representative results. Treat a priority change as
a separate sensitivity pilot under the host's rules, with preset variation
criteria and retained raw results. Verify that the controls apply and that
dependencies and monitoring still progress before adopting them for the
declared experiment. Priority changes never replace admission checks, resource
caps or pressure rejection. Read [scheduling controls](references/tools.md#scheduling-controls)
before choosing them. For questions about negative, zero or positive nice values,
read the [recorded priority findings](references/priority-findings-20261006.md)
before proposing another experiment.

Classify the timed region against the host's budget for concurrent light work.
A local phase is heavy when measured or expected CPU, memory or I/O exceeds
that budget. When either is unknown, contact the active reservation owner or
host coordinator. If neither is identified, ask the operator. Launch only after
recording agreement on a bounded trial with CPU, memory and I/O limits, or an
exclusive run window.

Reserve the host only for heavy local phases or deliberately isolated local
performance measurements. Remote model
inference, light CLI/API work and remote waits need no exclusive slot; a
memory cap or elapsed-time record alone does not establish heavy work. For
remote agent/model evaluations, record the timing regime and concurrent local
work. Apply the local admission and pressure rules below when measuring local
performance, rather than treating every model call as a CPU benchmark.

Before each arm, inspect CPU outside the measuring scope, memory headroom and
pressure, swap and competing CPU, memory or I/O jobs. Use the host's admission
limits; when it has none, declare the metrics and pass/fail thresholds before
collecting performance results. Start only when every admission condition passes.
During measurements, attribute CPU, load and resident memory to the recorded
benchmark process tree or resource scope before calling them competing work.
Expected benchmark utilization is not contention; total host CPU and load
average include it. Collect boundary counters adjacent to the measured work,
with unrelated probes outside that interval. Record sample times and observer
overhead. A counter interval extending past completion cannot by itself
establish overlap. Keep post-run observations diagnostic and use a fresh
settled interval before the next arm.

Reject a run when inputs change, competing work crosses a declared contention
limit, or a declared pressure condition fails. Before collecting performance
results, define pressure rejection using stall duration, swap activity and
memory-limit/OOM events; name any additional signals and their thresholds.
Set a stall-duration budget from the experiment's timing precision. Record
smaller stalls without rejecting them. Stalls exceeding the budget, swapping
or memory-limit/OOM events invalidate measurements even when the benchmark
causes them. Investigate uncertain overlap and repeat affected runs before
using them for a decisive comparison. A light session's presence alone is not
rejection evidence. Hold reservations during heavy local phases or declared
isolated local performance measurements. Release them during remote waits,
light work and reviews.

Screen correctness and quality first, then use one run per selected arm to
explore timing and resource behavior. Preserve screened-out results and their
reasons. Label screening exploratory; one run does not support a performance
claim. A correctness-only check can use one candidate run; report its coverage.

Before exploratory runs, define the decision-relevant signal for selecting
comparisons for confirmation. Choose comparisons that meet that signal, plus
decision-critical comparisons, for repeated confirmation; keep necessary controls.
Set the confirmation plan before its runs and update the explicit run count
when the scope changes. Repetition counts depend on the
decision and observed variation; there is no universal minimum.

For a performance claim, add alternating runs to assess run-to-run variation.
Before the first run used in that claim, set a repetition count or stopping
rule and a reproducible variation criterion (statistic and threshold).
Retain every result. Keep pilots that informed the plan separate from the
claim's sample. Capture raw results, exit status, elapsed time, CPU and memory
observations. Report admission and monitoring overhead separately from the
measured workload; batch compatible probes when they dominate elapsed time.
Report the selected repetition count or stopping rule, variation statistic and
threshold, sample count, median and range. Apply the preset
criterion and treat a gap within run-to-run variation as inconclusive. Profile
separately from the runs used to claim a speed difference.

Record memory by what it measures. Whole-process peak RSS includes startup,
inputs and dependencies. Heap snapshots describe retained objects; allocation
profiles describe allocation activity. Forced-GC probes are separate from
ordinary latency measurements. Match retention semantics and payloads when
comparing caches; equal requested capacities need not mean equal memory use.
For cache-retention probes, keep the cache owner reachable through the final
observation; otherwise collection of the owner can be mistaken for release by
the cache operation.
Batch latency percentiles describe batches, not individual requests.

## Report and decide

State the workload, versions, conditions, repetitions, output identity,
errors and measurement units beside the results. Name excluded costs and
coverage limits. A claimed difference with unknown limits, unequal work or
missing repetitions is unverified or inconclusive.

For agent, model, rule or skill comparisons, distinguish development cases
from held-out cases and report runs per case. Include a one-line instruction
control when claiming an improvement from a rule or skill. Keep helper,
setup and retry costs visible. Before collecting results, define a per-case
contribution threshold. If a case exceeds it, report results both with and
without that case.

For bug-review evaluations, freeze the supported input contract and label
procedure before calls. A passing reference suite does not certify a clean
control. Adjudicate additional findings against that contract. A confirmed extra
defect makes the affected specificity estimate unavailable; retain earlier
receipts and introduce a new control version. Leave disputed domains unresolved.

Report provider completion, output-format compliance and independently checked
artifact acceptance separately. Distinguish observed call time from verification
and rework time. Keep returned usage units separate from attributable account
charges; unknown attribution remains unknown.

Record every experiment, rejected ones included, with the observed result and
disposition. End with adopt, reject or inconclusive, and the evidence for that
decision. Any implementation or publication still follows the user's scope.
