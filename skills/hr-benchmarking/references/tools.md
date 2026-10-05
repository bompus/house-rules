# Benchmarking and investigation tools

These defaults come from tools used in our work. Prefer a suitable runner
already used by the project. Check the official version's documentation before
relying on flags or interpreting output.

## Timing and resource measurement

| Task | Default and reason | Limits to record |
|---|---|---|
| Whole CLI commands | [Hyperfine](https://github.com/sharkdp/hyperfine): repeated wall-time runs, warmup/preparation and JSON output. | Works across Linux, macOS and Windows. Declare warm/cold conditions. For short commands, `--shell=none` avoids the calibrated shell layer. |
| JavaScript operations | [Tinybench](https://github.com/tinylibs/tinybench), directly or through the project's benchmark runner: warmup and task latency/throughput statistics. | The unit is a task invocation. For 1,000-operation batches, batch p99 divided by 1,000 is the p99 of batch-average costs, not mean operation cost or individual-operation p99. |
| HTTP load, including JS/TS servers | [oha](https://github.com/hatoo/oha): a native load generator with concurrency/rate controls, latency distributions and JSON output. | Declare protocol, connections, rate, deadlines, keepalive and error handling. Check generator CPU/network limits. Latency correction requires rate limiting with `-q`. |
| Command CPU and memory | [GNU time](https://www.gnu.org/software/time/manual/time.html), commonly `/usr/bin/time -v`: wall time, CPU and maximum RSS. | GNU options differ from shell `time` and BSD/macOS tools. RSS is a lifetime high-water mark for the observed process; it does not isolate retained cache memory. |
| Host or process contention | Linux [mpstat/pidstat](https://github.com/sysstat/sysstat): processor utilization and process CPU, memory and I/O observations. | Sampling can miss short bursts; some counters need kernel support. These explain interference, not application latency. |

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

## Profiling and debugging

Use a separate diagnostic run; instrumentation changes the work it observes.

| Question | Tool and reason | Limits to record |
|---|---|---|
| Where does JavaScript CPU time go? | Runtime CPU profiler: [Node](https://nodejs.org/api/cli.html#--cpu-prof) or [Bun](https://bun.com/docs/project/benchmarking#cpu-profiling). | Match runtime/version and profile settings. Samples locate hotspots; verify improvements with unprofiled runs. |
| Which JS objects are allocated or retained? | Runtime allocation profiles and heap snapshots: [Node](https://nodejs.org/api/cli.html#--heap-prof), [Bun](https://bun.com/docs/project/benchmarking#heap-profiling). | Matching flags do not guarantee matching metrics; see the distinction below. |
| Where does native/kernel CPU work go? | Linux [perf stat](https://github.com/torvalds/linux/blob/master/tools/perf/Documentation/perf-stat.txt) and [perf record](https://github.com/torvalds/linux/blob/master/tools/perf/Documentation/perf-record.txt): counters, samples and call graphs. | Permissions, hardware/kernel support, symbols and stack unwinding affect evidence. Frame-pointer unwinding needs compatible binaries. |
| Which system calls fail or wait? | Linux [strace](https://github.com/strace/strace/blob/master/doc/strace.1.in): syscall results, errors and ordering. | Interception changes execution; summaries are not ordinary throughput. Traces may contain sensitive paths or payloads. |
| Which native allocations churn? | Linux [heaptrack](https://github.com/KDE/heaptrack): allocation counts, temporary allocations and allocation stacks. | Symbols improve attribution. Pool allocators need annotations; native allocation traces do not identify individual GC-managed JS objects. |

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
