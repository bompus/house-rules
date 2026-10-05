# JavaScript and TypeScript performance tools

Use built-in runtime profilers as the default. These alternatives answer
specific diagnostic questions. Verify maintenance and exact runtime/platform
support before adopting one. TypeScript applications execute through a runtime;
compiler timing and application timing answer different questions.

## Profiling and HTTP load

Use oha for HTTP load, including JavaScript/TypeScript servers. Consider
another generator only when a required workload capability is missing or the
project requires its existing harness. Check protocol and workload equivalence
before comparing generators.

| Need | Tool and reason | Limits to record |
|---|---|---|
| Rich profile reports and source maps | [Platformatic Flame](https://github.com/platformatic/flame) captures pprof profiles and generates interactive HTML and Markdown with source-map translation. | Verify its Node engine requirement and native profiler dependency against the tested platform. Read sample types and units, not just filenames. |
| Node flamegraphs | [0x](https://github.com/davidmarkclements/0x) samples stacks and produces an interactive flamegraph; it can visualize existing CPU profiles. | Check the selected release's documentation when its README and package engine floor disagree. Validate exact Node support. Native tracing can miss optimized JS frames. |
| Profiles for services already managed by Watt | [Watt pprof](https://github.com/platformatic/platformatic/blob/main/docs/reference/wattpm/cli-commands.md) starts and stops profiling for selected services; Flame visualizes its artifacts. | Requires Watt. Preserve the service state and inspect profile sample types. Do not adopt a new application runtime merely to profile it. |
| Live metrics and shareable service recordings | [Watt Admin](https://github.com/platformatic/watt-admin) records resource and application metrics alongside optional profiles in a standalone HTML report. | Requires a Watt application; it does not attach to arbitrary Node processes. Declare recorded metrics, sampling and profiling overhead. |
| Existing or specifically required Node HTTP harnesses | [autocannon](https://github.com/mcollina/autocannon) supports JS request sequences, HTTPS and pipelining. | oha is the default. Retain this only for a required existing harness or a demonstrated missing capability. Its Node client can saturate CPU; observe generator capacity independently. |

Platformatic Flame's [preload](https://github.com/platformatic/flame/blob/main/preload.js)
uses `pprof.time` for the artifact named CPU. The [underlying profiler](https://github.com/DataDog/pprof-nodejs)
describes that API as wall-time profiling. Inspect the sample type and units
before interpreting widths as on-CPU time. Heap sampling is allocation evidence,
not whole-process RSS or a full retained-object snapshot.

These tools primarily target Node. Keep Bun profiling on Bun-supported tools
for engine comparisons. The service recording tools do not document automatic
bottleneck classification or an asynchronous causality diagram. Diagnose those
questions with runtime metrics, profiles and focused probes.

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
