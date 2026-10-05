# JavaScript and TypeScript performance tools

Use built-in runtime profilers as the default. These alternatives answer
specific diagnostic questions. Verify maintenance and exact runtime/platform
support before adopting one. TypeScript applications execute through a runtime;
compiler timing and application timing answer different questions.

## Profiling and HTTP load

| Need | Tool and reason | Limits to record |
|---|---|---|
| Rich profile reports and source maps | [Platformatic Flame](https://github.com/platformatic/flame) captures pprof profiles and generates interactive HTML and Markdown with source-map translation. | Verify its Node engine requirement and native profiler dependency against the tested platform. Read sample types and units, not just filenames. |
| Node flamegraphs | [0x](https://github.com/davidmarkclements/0x) samples stacks and produces an interactive flamegraph; it can visualize existing CPU profiles. | Validate exact Node support. Native stacks depend on platform/tracing support; optimized JS frames can be incomplete. |
| Programmable HTTP/1.1 workloads | [autocannon](https://github.com/mcollina/autocannon) supports JS request sequences, HTTPS and pipelining. | Its Node client can saturate CPU. Observe the generator independently and verify rate/latency-correction semantics. Native oha remains suitable for general load. |

Platformatic Flame's [preload](https://github.com/platformatic/flame/blob/main/preload.js)
uses `pprof.time` for the artifact named CPU. The [underlying profiler](https://github.com/DataDog/pprof-nodejs)
describes that API as wall-time profiling. Inspect the sample type and units
before interpreting widths as on-CPU time. Heap sampling is allocation evidence,
not whole-process RSS or a full retained-object snapshot.

## Clinic.js

The [Clinic.js README](https://github.com/clinicjs/node-clinic) warns that the
suite is no longer actively maintained and may produce inaccurate results due
to its reliance on Node internals. Its older minimum-Node statement does not
establish compatibility with a modern release. Use it only after validation
against the exact runtime and corroborate findings with supported tools.

| Tool | Implementation and purpose | Limits |
|---|---|---|
| [Doctor](https://github.com/clinicjs/node-clinic-doctor) | Process sampling and Node trace events classify CPU, memory and event-loop symptoms. | Recommendations are diagnostic hypotheses, not controlled benchmark results. |
| [Flame](https://github.com/clinicjs/node-clinic-flame) | Wraps 0x for sampled stacks and flamegraph visualization. | The wrapper shares Clinic's maintenance caveat; check 0x support independently. |
| [Bubbleprof](https://github.com/clinicjs/node-clinic-bubbleprof) | Injects async-hooks collection and stacks to visualize asynchronous activity. | Instrumentation changes execution. Its collector lacks source-map support for transpiled code. |
| [HeapProfiler](https://github.com/clinicjs/node-clinic-heap-profiler) | Wraps a sampling heap profiler to visualize allocation activity. | Samples differ from RSS and full heap snapshots. |

## TypeScript measurement

Use [compiler diagnostics](https://www.typescriptlang.org/tsconfig/extendedDiagnostics.html)
for compiler phases and repeated whole-command timing for builds. For application
performance, record the executed artifact, build target, module format and source
maps. Use the same compiled JS artifact for an engine-only comparison; report
startup or transformation separately when it is part of the question.

[Node type stripping](https://nodejs.org/api/typescript.html) performs no type
checking and ignores `tsconfig.json`. A successful direct `.ts` execution does
not establish TypeScript correctness.

## Further reading

Matteo Collina's [analysis of router fast paths](https://adventures.nodeland.dev/archive/workskipping-is-a-great-technique-what-happens/)
shows why ordinary supported inputs and cases that bypass an optimization belong
in a workload. Evaluate each tool's maintenance, compatibility and evidence for
the task; an author's reputation alone does not establish a benchmark result.
