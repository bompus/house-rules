---
name: hr-benchmarking
description: Benchmark equivalent work with repeated timing, CPU and memory measurements under stated inputs and controls, and check whether saved results support a performance claim. Use when asked to benchmark, to measure which option is faster or uses less memory, or to time agent or model runs. Public model leaderboard research is outside this measurement workflow.
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
input identity and source revisions. Freeze copied quality and control artifacts;
record their hashes and the executed artifact's identity. Agreement across
runtimes alone does not verify the intended artifact. Keep these fixed across
repeated arms; reject mixed versions when resuming a checkpoint.

Compare runtime knobs within the same build. Use equivalent outputs, release
settings and comparable tuning. An untuned arm compares configurations rather
than implementations.

Keep warm and cold conditions explicit. Reset state or use fresh processes
where the question requires independence. Record warmup and cache conditions.
A reused service needs equivalent state across arms, not an arbitrary restart.

## Confirm the work

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
Use normal scheduling and all available CPUs for ordinary measurements. Omit
automatic `nice` and `taskset` wrappers; verify inherited priority and affinity
rather than assuming their omission resets either. Use restricted affinity or
changed priority only for representative deployment settings, an explicit resource
agreement or a stated sensitivity question. Record the reason and effective values.
Preserve frozen protocols and report constrained results within their tested scope.
Treat a priority or affinity change as
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
that budget. Inspect the command, its hooks, wrappers and children before calling
demand
unknown. Inspection can qualify bounded ordinary work within that budget;
missing resource samples alone does not require a trial. When inspection leaves
potentially incompatible demand unresolved, contact the active reservation owner
or host coordinator. If neither is identified, ask the operator. Launch that
workload only after recording agreement on a bounded trial with CPU, memory and
I/O limits, or an exclusive run window. Resolve input and authorization conflicts
separately; resource admission does not override them.

For an unknown competing job, record a preset time or query limit, then inspect
its process identity, actual demand and access to measured inputs. Stop at that
limit. A cap, service name or active state alone does not establish incompatible
work. Keep unresolved overlap or observer gaps unqualified; input mutation remains
incompatible even at low demand.

A retained benchmark lock does not pause other sessions or reserve every phase
of their tasks. Qualified non-heavy checks, edits and coordination proceed without
acquiring that lock while staying within the concurrent-work budget and preserving
measured inputs. Classify actual commands and children, including hooks; reuse
qualification only for comparable inputs, runtimes and worker counts. When
inspection leaves demand unresolved, identify the missing evidence and arrange
the bounded qualification above. Defer only the incompatible phase, naming its
resource or input conflict;
do not use lock ownership alone to block qualified non-heavy work. Keep repository
integration and installation write locks separate from benchmark admission.

Reserve the host only for heavy local phases or deliberately isolated local
performance measurements. Remote model
inference, light CLI/API work and remote waits need no exclusive slot; a
memory cap or elapsed-time record alone does not establish heavy work. For
remote agent/model evaluations, record the timing regime and concurrent local
work. Apply the local admission and pressure rules below when measuring local
performance, rather than treating every model call as a CPU benchmark.

Before collecting results, declare required observers, their measurement interval
and coverage criteria. Require successful execution and recorded coverage that
meets those criteria. Preserve observer exit status, errors and missing samples;
reject evidence with unexplained observer failures or insufficient coverage.
Require empty stderr only when the observer's declared contract requires it;
documented harmless diagnostics alone do not invalidate observation.

Declare observer CPU, resident-memory and I/O budgets separately from foreign-load
and pressure gates. Include every collector and reader, with process birth
identities and aligned intervals. Record CPU time, average core-equivalent use,
workload-relative CPU, resident peaks, logical log bytes and attributable storage
I/O. Separate setup from collection; disclose missing platform counters and
shared provider or writeback costs. A log-byte count is not physical disk I/O.
Retain over-budget runs with an over-budget status and exclude them from accepted
performance evidence. Declare any stop rule and replacement limit before
execution. Record budget failures separately from foreign-load and pressure
failures.

Choose budgets for the host, workload duration and decision precision; there is
no universal workload-relative CPU percentage. A budget permits collection but
does not prove unchanged latency. Before claiming negligible observer impact or
a small decisive gain, test sensitivity to observation separately with balanced
controls and a preset precision criterion. Retain inconclusive controls; do not
subtract observer CPU from workload wall time. Assign and record each run's
protocol version before execution. A changed observer budget creates a new
protocol version. Keep historical rejection verdicts with their original version.

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

Keep uncalibrated activity counters diagnostic. Before using an activity cutoff
to reject measurements, establish its relevance through separate sensitivity
evidence with comparison conditions and an interference criterion set before
analysis. Retain raw observations and inconclusive outcomes. Preserve declared
pressure and observer checks; distinguish a conservative limit from evidence
that interference occurred.

Reject a run when inputs change, competing work crosses a declared contention
limit, or a declared pressure condition fails. Before collecting performance
results, define pressure rejection using stall duration, swap activity and
memory-limit/OOM events; name any additional signals and their thresholds.
Set a stall-duration budget from the experiment's timing precision. Record
smaller stalls without rejecting them. Stalls exceeding the budget, swapping
or memory-limit/OOM events invalidate measurements even when the benchmark
causes them. Resource rejection invalidates the measurement; it alone does not
establish an implementation defect. Investigate uncertain overlap and repeat
affected runs within authorized retry budgets before a decisive comparison.
A light session's presence alone is not rejection evidence.

Declare per-case retry budgets before attempts; a budget grants no retry
authority. Retain rejected attempts outside accepted samples. A later qualifying
attempt neither erases a rejection nor relaxes its gates. After rejecting a case,
continue other independently selected cases only when their admission passes
and the failure cannot invalidate shared controls. Otherwise hold affected cases.

Hold reservations during heavy local phases or declared isolated local performance
measurements. Release them during remote waits, light work and reviews.
Declare finite phase boundaries or stopping conditions, release at those
boundaries and seek fresh admission for the next phase. While waiting, keep the
blocked phase in the ledger and advance already-authorized independent light
work within the active measurement's allowance. Preserve measured inputs;
backlog presence does not authorize new implementation.

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

When using saved evidence for a performance claim, bind archived inputs, source,
cohort and results to their recorded identities and artifact hashes. Validate
historical reports against that frozen archive; later changes in the live
checkout alone do not invalidate historical evidence. Verify run identities and
stages against the declared plan.

Recompute qualification from recorded raw counters and preset limits; an accepted
summary or changed label is insufficient. Reject missing, duplicate or
misclassified required observations. When an evidence reader exists, put these
checks and focused corruption regressions there.

Record memory by what it measures. Whole-process peak RSS includes startup,
inputs and dependencies. Heap snapshots describe retained objects; allocation
profiles describe allocation activity. Forced-GC probes are separate from
ordinary latency measurements. Match retention semantics and payloads when
comparing caches; equal requested capacities need not mean equal memory use.
For cache-retention probes, keep the cache owner reachable through the final
observation; otherwise collection of the owner can be mistaken for release by
the cache operation.

For WeakRef-based retention probes, use bounded allocation batches and calibrated
collection boundaries after creating or dereferencing targets. Avoid observer
arrays or locals that keep measured values strongly reachable; preserve the
intended owner lifetime. Report live payload, cache occupancy and process RSS
separately. Keep this collection protocol outside ordinary latency runs; yielding
or forced collection alone does not guarantee that a target is reclaimed.

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
