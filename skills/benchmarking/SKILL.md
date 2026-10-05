---
name: benchmarking
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

Coordinate resource use under the host's rules. The measuring session only
monitors during the timed region. Other sessions may do light work within the
run's resource limits, with measured files, toolchains and services unchanged.
Record observed contention; reject runs affected by competing work, memory
pressure, swap or changed inputs. A light session's presence alone is not a
reason to reject a run. Release reservations between jobs while awaiting
remote work or a review; do not release an active measured run.

Start with one run per arm. A correctness-only check can use one candidate run;
report its coverage and make no performance claim.

For a performance claim, add alternating runs to assess run-to-run variation.
Before the first run used in that claim, set a repetition count or stopping
rule and a reproducible variation criterion (statistic and threshold).
Retain every result. Keep pilots that informed the plan separate from the
claim's sample. Capture raw results, exit status, elapsed time, CPU and memory
observations. Report the selected repetition count or stopping rule, variation
statistic and threshold, sample count, median and range. Apply the preset
criterion and treat a gap within run-to-run variation as inconclusive. Profile
separately from the runs used to claim a speed difference.

Record memory by what it measures. Whole-process peak RSS includes startup,
inputs and dependencies. Heap snapshots describe retained objects; allocation
profiles describe allocation activity. Forced-GC probes are separate from
ordinary latency measurements. Match retention semantics and payloads when
comparing caches; equal requested capacities need not mean equal memory use.
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

Record every experiment, rejected ones included, with the observed result and
disposition. End with adopt, reject or inconclusive, and the evidence for that
decision. Any implementation or publication still follows the user's scope.
