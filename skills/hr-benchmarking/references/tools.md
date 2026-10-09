# Benchmarking and investigation tools

These defaults come from tools used in our work. Prefer a suitable runner
already used by the project. Check the official version's documentation before
relying on flags or interpreting output.

## Timing and resource measurement

| Task                               | Default and reason                                                                                                                                     | Limits to record                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Whole CLI commands                 | [Hyperfine](https://github.com/sharkdp/hyperfine): repeated runs with wall time, CPU time and peak memory, warmup/preparation and JSON output.         | Works across Linux, macOS and Windows. Declare warm/cold conditions. Since 2.0 commands run without a shell unless `-S` or `--shell` is given; 1.x needs `-N` for that. Peak memory and `--metrics` hardware counters are measured on Linux and macOS only; on Windows use another tool for memory. Check `schema_version` before reading exported JSON; 2.0 changed its layout. |
| JavaScript operations              | [Tinybench](https://github.com/tinylibs/tinybench), directly or through the project's benchmark runner: warmup and task latency/throughput statistics. | The unit is a task invocation. For 1,000-operation batches, batch p99 divided by 1,000 is the p99 of batch-average costs, not mean operation cost or individual-operation p99.                                                                                                                                                                                                   |
| HTTP load, including JS/TS servers | [oha](https://github.com/hatoo/oha): a native load generator with concurrency/rate controls, latency distributions and JSON output.                    | Declare protocol, connections, rate, deadlines, keepalive and error handling. Check generator CPU/network limits. Latency correction requires rate limiting with `-q`.                                                                                                                                                                                                           |
| Command CPU and memory             | [GNU time](https://www.gnu.org/software/time/manual/time.html), commonly `/usr/bin/time -v`: wall time, CPU and maximum RSS.                           | GNU options differ from shell `time` and BSD/macOS tools. RSS is a lifetime high-water mark for the observed process; it does not isolate retained cache memory.                                                                                                                                                                                                                 |
| Host or process contention         | Linux [mpstat/pidstat](https://github.com/sysstat/sysstat): processor utilization and process CPU, memory and I/O observations.                        | Sampling can miss short bursts; some counters need kernel support. These explain interference, not application latency.                                                                                                                                                                                                                                                          |

On Linux with compressed swap enabled, observe compressed-swap activity as
well as disk swap I/O. Unchanged `pswpin`/`pswpout` counters do not establish
absence of swapping. For [zswap](https://www.kernel.org/doc/html/latest/admin-guide/mm/zswap.html),
record available `zswpin`/`zswpout`/`zswpwb` deltas from the benchmark cgroup's
`memory.stat` over the measured interval. Label host-wide deltas as system-wide;
they cannot attribute activity to the workload.

Use [cgroup swap and zswap accounting](https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html)
(`memory.swap.current`, `memory.zswap.current`) to distinguish the workload
from other jobs. These occupancy values do not measure activity by themselves.
Record missing counters and preserve the run plan's declared pressure criteria.

## Process attribution

Prefer `pidstat -u -r -d -p ALL 1 20` for the standard Linux process view.
For receipts that retain PID birth identity, use the bundled collector:

```sh
python3 scripts/process-attribution.py --seconds 20 --output /disk/path/receipt.json
```

Run from the skill directory. Linux receipts contain raw one-second snapshots
and CPU deltas ranked by busy cores, with process name, parent PID, birth ticks,
RSS pages and unmatched boundary counts. They omit command arguments.
Each row also reports `reapedChildCores`: CPU of children the process reaped
during the interval, attributed to that parent. It shows which process ran
commands too short-lived to appear in a snapshot, not the commands themselves,
and can include CPU the children used before the interval started.
Each interval reports `cpuBusyCores` per logical CPU for pinned runs (see
[fenced-core arm](#fenced-core-arm)). Busy CPU excludes idle, iowait and steal
time.
The collector uses its own `/proc/self/status` `VmHWM` for peak RSS;
`ru_maxrss` can retain a launcher's inherited high-water mark.
It records observer CPU and scan duration. Include those costs in the declared
measurement budget; no negligible-impact claim follows from successful collection.

On Windows, `scripts/process-attribution.ps1` accepts mandatory `OutputPath`
and `StopPath` arguments. It saves process PID, start time, name and cumulative
CPU, plus host activity and observer CPU/working set. Match PID and start time
before computing deltas. It stops when the stop file exists or after 120 samples;
choose a fresh stop path. Use the host's approved PowerShell invocation without
changing execution policy.

Neither collector stops jobs, takes a lock or grants admission. Boundary samples
miss processes that start and exit between them; unreadable processes are counted
as missing. CPU contributors explain observed activity, not whether it changed
application latency. Keep host/resource gates and owner coordination separate.

## Scheduling controls

These Linux controls change resource allocation under competition; they do not
establish isolation. Check support for the actual kernel, controller and I/O
path. Record effective values and unavailable controls for every arm; requesting
a setting does not prove it took effect.

| Control                                                                          | Effect and limit                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Nice level](https://man7.org/linux/man-pages/man2/nice.2.html)                  | Lower numeric values raise fair CPU scheduling priority. Permissions and autogroup policy affect the result. This does not reserve a core.                                                                                   |
| CPU affinity (`taskset`)                                                         | Restricts available CPUs and can affect worker counts and parallelism. It does not reserve exclusive cores. Use it for a declared CPU configuration or a [fenced-core arm](#fenced-core-arm), not automatic noise reduction. |
| [CPU and I/O cgroup weights](https://docs.kernel.org/admin-guide/cgroup-v2.html) | Adjust relative shares among active sibling groups. Parent limits and controller/device support still apply; a higher weight is not a capacity guarantee.                                                                    |
| [Process I/O priority](https://man7.org/linux/man-pages/man2/ioprio_set.2.html)  | Depends on the supporting I/O scheduler and path. Process-specific priority does not cover asynchronous writes.                                                                                                              |
| [Memory protection](https://docs.kernel.org/admin-guide/cgroup-v2.html)          | `memory.low` and `memory.min` protect against reclaim, not memory-bandwidth competition. Excessive hard protection can cause OOM. Memory caps remain limits, not reservations.                                               |

### Fenced-core arm

On a shared host where brief bursts from other sessions keep failing host-wide
admission, a fenced-core arm keeps other work off chosen CPUs for a finite phase. It is a
declared sensitivity arm that needs the user's authorization, because it changes
other sessions' CPU placement:

1. Choose the benchmark CPUs as whole physical cores (include SMT siblings) and pin
   every arm, its browser or runtime and its children to them.
2. Move every other thread you are permitted to change off the benchmark CPUs.
   Record each thread's identity (PID, thread ID, birth ticks) and original
   affinity. Stop and signal nothing.
3. Gate on foreign CPU on the benchmark CPUs: their busy time (`cpuBusyCores`)
   minus the CPU of the benchmark's own process tree. Process CPU is not
   per-CPU, so the subtraction holds only while the whole tree stays on the
   benchmark CPUs: check every thread's effective affinity at the start and end
   of each batch, and reject the batch if any ran elsewhere. Report host-wide
   load as context.
4. At the phase boundary, restore recorded threads after checking their birth
   ticks. Threads started during the window inherited the fence; give them the
   CPU set they would otherwise have inherited, usually all CPUs. Verify no thread remains fenced, including when the
   phase fails.

Report results as constrained to the pinned setting with the effective
affinities. Processes you cannot change (other users, system services) stay
unfenced; record them. In a virtual machine, guest affinity does not reserve
host cores; host activity, shared cache, memory bandwidth and power limits
still apply.

Avoid realtime [CPU](https://man7.org/linux/man-pages/man7/sched.7.html) or
[I/O](https://man7.org/linux/man-pages/man1/ionice.1.html) classes for generic
benchmark noise reduction; they can starve dependencies or monitoring.
Preserve the host's scheduling policy unless it authorizes a different regime.

## Profiling and debugging

Use a separate diagnostic run; instrumentation changes the work it observes.

| Question                                    | Tool and reason                                                                                                                                                                                                                                       | Limits to record                                                                                                                          |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Where does JavaScript CPU time go?          | Runtime CPU profiler: [Node](https://nodejs.org/api/cli.html#--cpu-prof) or [Bun](https://bun.com/docs/project/benchmarking#cpu-profiling).                                                                                                           | Match runtime/version and profile settings. Samples locate hotspots; verify improvements with unprofiled runs.                            |
| Which JS objects are allocated or retained? | Runtime allocation profiles and heap snapshots: [Node](https://nodejs.org/api/cli.html#--heap-prof), [Bun](https://bun.com/docs/project/benchmarking#heap-profiling).                                                                                 | Matching flags do not guarantee matching metrics; see the distinction below.                                                              |
| Where does native/kernel CPU work go?       | Linux [perf stat](https://github.com/torvalds/linux/blob/master/tools/perf/Documentation/perf-stat.txt) and [perf record](https://github.com/torvalds/linux/blob/master/tools/perf/Documentation/perf-record.txt): counters, samples and call graphs. | Permissions, hardware/kernel support, symbols and stack unwinding affect evidence. Frame-pointer unwinding needs compatible binaries.     |
| Which system calls fail or wait?            | Linux [strace](https://github.com/strace/strace/blob/master/doc/strace.1.in): syscall results, errors and ordering.                                                                                                                                   | Interception changes execution; summaries are not ordinary throughput. Traces may contain sensitive paths or payloads.                    |
| Which native allocations churn?             | Linux [heaptrack](https://github.com/KDE/heaptrack): allocation counts, temporary allocations and allocation stacks.                                                                                                                                  | Symbols improve attribution. Pool allocators need annotations; native allocation traces do not identify individual GC-managed JS objects. |

Node `--heap-prof` samples allocation activity. Bun's documentation describes
a full V8-format heap snapshot at exit, not the same sampled allocation history;
its accepted interval flag does not add allocation sampling. Record which kind
of artifact was captured and verify semantics for the version used.

For a concrete crash, hang or event-tracing question, use the available
[debugger](https://www.sourceware.org/gdb/documentation/) or
[system tracing tool](https://bpftrace.org/docs). They are optional diagnostic
tools, not benchmark prerequisites; platform and permissions affect availability.

For TypeScript compiler versus application timing, read [the language reference](javascript.md).

## Correctness and audit evidence

Use the repository's lint, type checks, focused tests and relevant static or
security analysis. These establish intended behavior and detect defects; passing
them does not establish speed or memory use. State their coverage limits.

Add a tool after using it successfully on a real task. Record the question it
answered, why it helped, its platform and measurement limits, and the official
documentation. Keep untried candidates in research notes until then.
