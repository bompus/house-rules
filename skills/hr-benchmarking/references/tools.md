# Benchmarking and investigation tools

These defaults come from tools used in our work. Prefer a suitable runner
already used by the project. Check the official version's documentation before
relying on flags or interpreting output.

## Timing and resource measurement

| Task                               | Default and reason                                                                                                                                     | Limits to record                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Whole CLI commands                 | [Hyperfine](https://github.com/sharkdp/hyperfine): repeated runs with wall time, CPU time and peak memory, warmup/preparation and JSON output.         | Works across Linux, macOS and Windows. Declare warm/cold conditions. Since 2.0 commands run without a shell unless `-S` or `--shell` is given; 1.x needs `-N` for that. Peak memory and `--metrics` hardware counters are measured on Linux and macOS only; on Windows use another tool for memory. Check `schema_version` before reading exported JSON; 2.0 changed its layout. |
| JavaScript operations              | [Tinybench](https://github.com/tinylibs/tinybench), directly or through the project's benchmark runner: warmup and task latency/throughput statistics. | The unit is a task invocation. For 1,000-operation batches, batch p99 divided by 1,000 is the p99 of batch-average costs, not mean operation cost or individual-operation p99.                                                                                                                                                                                                   |
| HTTP load, including JS/TS servers | [oha](https://github.com/hatoo/oha): a native load generator with concurrency/rate controls, latency distributions and JSON output.                    | Declare protocol, connections, rate, deadlines, keepalive and error handling. Check generator CPU/network limits. For fixed-rate load, `--latency-correction` corrects coordinated omission; it is ignored unless `-q` is set.                                                                                                                                                   |
| Command CPU and memory             | [GNU time](https://www.gnu.org/software/time/manual/time.html), commonly `/usr/bin/time -v`: wall time, CPU and maximum RSS.                           | GNU options differ from shell `time` and BSD/macOS tools. RSS is a lifetime high-water mark for the observed process; it does not isolate retained cache memory.                                                                                                                                                                                                                 |
| Host or process contention         | Linux [mpstat/pidstat](https://github.com/sysstat/sysstat): processor utilization and process CPU, memory and I/O observations.                        | Sampling can miss short bursts; some counters need kernel support. These explain interference, not application latency.                                                                                                                                                                                                                                                          |

On Linux with compressed swap enabled, observe compressed-swap activity as
well as disk swap I/O. Unchanged `pswpin`/`pswpout` counters do not establish
absence of swapping. For [zswap](https://www.kernel.org/doc/html/latest/admin-guide/mm/zswap.html),
record available `zswpin`/`zswpout`/`zswpwb` deltas from the benchmark cgroup's
`memory.stat` over the measured interval. Label host-wide deltas as system-wide;
they cannot attribute activity to the workload.

Host-wide swap page-ins (`pswpin`, `zswpin`) can move by a few pages while CPU,
memory pressure and I/O are quiet. Record them as a diagnostic; do not reject a
run on them alone. Reject a run on swap-outs or writeback (`pswpout`, `zswpout`,
`zswpwb`), on growth of the workload cgroup's own `memory.swap.current` or
`memory.zswap.current`, or on cgroup high, max or OOM events. A stricter
criterion declared in the run plan still applies.

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

Each interval reports `cpuBusyCores` per logical CPU. Busy CPU excludes idle,
iowait and steal time. A CPU brought online or offline during the interval
reports `null`.
The collector uses its own `/proc/self/status` `VmHWM` for peak RSS;
`ru_maxrss` can retain a launcher's inherited high-water mark.
It records observer CPU and scan duration. Report those costs beside the results; no
negligible-impact claim follows from successful collection.

On Windows, `scripts/process-attribution.ps1` accepts mandatory `OutputPath`
and `StopPath` arguments. It saves process PID, start time, name and cumulative
CPU, plus host activity and observer CPU/working set. Match PID and start time
before computing deltas. It stops when the stop file exists or after 120 samples;
choose a fresh stop path. Use the host's approved PowerShell invocation without
changing execution policy.

Neither collector stops jobs or changes any setting. Boundary samples
miss processes that start and exit between them; unreadable processes are counted
as missing. CPU contributors explain observed activity, not whether it changed
application latency.

## Continuous observer for one unit

`scripts/unit-observer.py` watches one measured unit (a timed run or a phase) that runs inside a
single cgroup, and says whether the unit may count. Start the unit in a transient scope, start the
observer from a process in that scope, wait for `<output>.ready`, run the unit, then send the
observer SIGTERM and read its exit status (0 clean, 1 not) and summary:

```sh
systemd-run --user --scope -p MemoryMax=2G bash -c '
  python3 scripts/unit-observer.py --workload-cgroup auto --output /disk/path/unit.json & obs=$!
  while [ ! -e /disk/path/unit.json.ready ]; do sleep 0.2; done
  ./run-the-unit
  kill -TERM $obs; wait $obs'
```

It samples once a second and applies the host admission limits through the whole unit: available
memory, host and workload memory and I/O pressure, host swap-out and zswap activity, unbroken
coverage (monotonic clock, no gap over 2.5 s), and competing CPU as host busy cores minus the
workload cgroup's own CPU (mean over the run, at most 4). For the workload cgroup it also rejects
growth of `memory.swap.current` or `memory.zswap.current`, any change of `zswpin`, `zswpout` or
`zswpwb`, any increment of `memory.events` high, max, oom or oom_kill, a replaced directory and
unreadable counters. Without PSI the unit is not clean. `--host-only` checks the host limits alone
and records `"scope": "host-only"`. The summary records the observer's identity, own CPU time and
the first and last sample times; its cost is part of the unit's CPU, so report it beside the
results and make no negligible-impact claim from a clean summary. A unit that spans several
transient scopes (one per child) has no single cgroup to watch; put the whole phase in one scope.

## Scheduling controls

These Linux controls change resource allocation under competition; they do not
establish isolation. Check support for the actual kernel, controller and I/O
path. Record effective values and unavailable controls for every arm; requesting
a setting does not prove it took effect.

| Control                                                                          | Effect and limit                                                                                                                                                                    |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Nice level](https://man7.org/linux/man-pages/man2/nice.2.html)                  | Lower numeric values raise fair CPU scheduling priority. Permissions and autogroup policy affect the result. This does not reserve a core.                                          |
| CPU affinity (`taskset`)                                                         | Restricts available CPUs and can affect worker counts and parallelism. It does not reserve exclusive cores. Use it for a declared CPU configuration, not automatic noise reduction. |
| [CPU and I/O cgroup weights](https://docs.kernel.org/admin-guide/cgroup-v2.html) | Adjust relative shares among active sibling groups. Parent limits and controller/device support still apply; a higher weight is not a capacity guarantee.                           |
| [Process I/O priority](https://man7.org/linux/man-pages/man2/ioprio_set.2.html)  | Depends on the supporting I/O scheduler and path. Process-specific priority does not cover asynchronous writes.                                                                     |
| [Memory protection](https://docs.kernel.org/admin-guide/cgroup-v2.html)          | `memory.low` and `memory.min` protect against reclaim, not memory-bandwidth competition. Excessive hard protection can cause OOM. Memory caps remain limits, not reservations.      |

In a virtual machine, guest affinity does not reserve host cores; host
activity, shared cache, memory bandwidth and power limits still apply.

Count CPUs with `nproc --all`, which ignores a cgroup CPU quota. Some other
counters follow the quota and disagree about fractions. Under a quota of 1.5 CPUs on a
16-CPU host, Node 26 and Bun `os.availableParallelism()` read 1, uutils `nproc`
0.10.0 read 2, and GNU `nproc` 9.7 read 16. Record which counter produced a
worker or job count.

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

### Native and JavaScript CPU profiles

Keep native symbols in the diagnostic build. For a Rust release build, use
`CARGO_PROFILE_RELEASE_DEBUG=line-tables-only CARGO_PROFILE_RELEASE_STRIP=none`.
For Node JIT frames under `perf`, add `--perf-basic-prof`. A runtime CPU profile
may attribute a native addon's work to its JavaScript caller; use native samples
to see inside that call. Node `--cpu-prof` writes separate files for worker threads;
retain them alongside the main-thread profile.

If `perf report` stalls while expanding a large binary's inline frames, try
`perf report --stdio --no-inline`. This omits inline-call expansion, so record
that limit when attributing samples.

### Viewing profiles

[speedscope](https://github.com/jlfwong/speedscope) opens profiles locally as
interactive flame graphs, including Node CPU profiles and Linux `perf` captures.
It has been used to inspect JavaScript and native stacks across worker threads.
To import a `perf` capture, write `perf script > profile.perf` without a custom
`-F` field list; a partially recognized format can display one stack without an
import error. Check that the expected threads and stacks appear.

The npm CLI opens the default browser with `speedscope <profile>`. When using a
controlled browser, serve its packaged `dist/release/` directory and the profile
over loopback HTTP, then open `index.html#profileURL=<URL-encoded-profile-url>`.
Use `encodeURIComponent(profileUrl)` for the value so query parameters remain
part of the profile URL. Choose a free port and keep private captures on the
local host. Follow the host's browser rules.

### Allocation and waiting-time limits

`heaptrack` unwinds a stack on each native allocation. Start with a small input:
millions of allocations can make instrumentation dominate runtime. Treat that
runtime as diagnostic overhead, and verify improvements with uninstrumented runs.

On-CPU profiles omit time spent off CPU. Use a separate
[bpftrace](https://bpftrace.org/docs) scheduler trace when a thread's wall time
greatly exceeds its CPU time. Track the target and its descendants, and aggregate
time between switch-out and switch-in. Off-CPU time includes both blocked time
and time runnable threads wait for a CPU; sums across threads can exceed wall time.
Kernel tracepoints, PID namespaces and privileges affect attribution, so verify
the target's identity and that probes attached before starting it.

Node `--heap-prof` samples allocation activity. Bun's documentation describes
a full V8-format heap snapshot at exit, not the same sampled allocation history;
its accepted interval flag does not add allocation sampling. Record which kind
of artifact was captured and verify semantics for the version used.

For a concrete crash, hang or event-tracing question, use the available
[debugger](https://www.sourceware.org/gdb/documentation/) or
[system tracing tool](https://bpftrace.org/docs). They are optional diagnostic
tools, not benchmark prerequisites; platform and permissions affect availability.

For TypeScript compiler versus application timing, and for Bun-versus-Node pitfalls, read [the language reference](javascript.md).

### Off-CPU tracing under WSL2

`bpftrace` needs `sudo`. Check available tracepoints before attaching. The
distro's PID namespace differs from the kernel namespace used by scheduler
tracepoints. The `pid` and `tid` builtins can also fail with EINVAL from
`get_ns_current_pid_tgid`, and a `/proc` PID filter can silently match nothing.

Start tracing before the target execs. Seed from a uniquely named executable
symlink and follow `sched_process_fork`, using only tracepoint PIDs. Keep the
symlink's absolute path at most 60 bytes because bpftrace's default string
capture is 64 bytes. Replace `<unique executable path>` below with that path.
Store the script and capture in the task's disk-backed scratch directory.

```bpftrace
tracepoint:sched:sched_process_exec
/ strncmp(str(args->filename), "<unique executable path>", 60) == 0 /
{ if (@main == 0) { @main = args->pid; } @tracked[args->pid] = 1; }

tracepoint:sched:sched_process_fork / @tracked[args->parent_pid] /
{ @tracked[args->child_pid] = 1; }

tracepoint:sched:sched_switch
{
  if (@tracked[args->prev_pid]) {
    @start[args->prev_pid] = nsecs;
    @name[args->prev_pid] = args->prev_comm;
    @stack[args->prev_pid] = kstack(3);
  }
  $next = args->next_pid;
  if (@start[$next]) {
    @off_us[@name[$next], @stack[$next]] = sum((nsecs - @start[$next]) / 1000);
    delete(@start[$next]); delete(@stack[$next]);
  }
}

tracepoint:sched:sched_process_exit / @tracked[args->pid] /
{
  delete(@tracked[args->pid]); delete(@start[args->pid]);
  delete(@name[args->pid]); delete(@stack[args->pid]);
  if (args->pid == @main) { exit(); }
}
interval:s:25 { exit(); }
```

Run `sudo -n bpftrace <script>` and wait for `Attached` on stderr before
starting the target through the unique symlink. `Attaching` on stdout is too
early. Retain stderr and verify that `@main` was set. The script exits when the
main process exits or after 25 seconds; record which limit ended the capture.
bpftrace 0.25 prints "Return value discarded" warnings for the `delete` calls.
They do not change the result.

The totals include runnable time waiting for a CPU as well as blocked time.
They omit intervals still open when tracing stops. Thread-name groups combine
multiple threads, so their sums can exceed wall time. A three-frame kernel stack
shows scheduler wait reasons; use deeper stacks when caller attribution matters.

## Correctness and audit evidence

Use the repository's lint, type checks, focused tests and relevant static or
security analysis. These establish intended behavior and detect defects; passing
them does not establish speed or memory use. State their coverage limits.

Add a tool after using it successfully on a real task. Record the question it
answered, why it helped, its platform and measurement limits, and the official
documentation. Keep untried candidates in research notes until then.
