# JavaScript and TypeScript measurement

Use built-in runtime profilers and oha from [the tool reference](tools.md).
TypeScript applications execute through a runtime; compiler timing and
application timing answer different questions.

## TypeScript measurement

Use [compiler diagnostics](https://www.typescriptlang.org/tsconfig/extendedDiagnostics.html)
for compiler phases and repeated whole-command timing for builds. For application
performance, record the executed artifact, build target, module format and source
maps. Use the same compiled JS artifact for an engine-only comparison; report
startup or transformation separately when it is part of the question.

[Node type stripping](https://nodejs.org/api/typescript.html) performs no type
checking and ignores `tsconfig.json`. A successful direct `.ts` execution does
not establish TypeScript correctness.

## Running under Bun versus Node

Confirm the runtime before comparing: print `process.execPath` or
`process.versions.bun` from inside the code under test, in worker threads too.
Verified on Bun 1.4.x:

- `bun x vitest` is not Bun. `bun x` honors the tool's `#!/usr/bin/env node`
  shebang and runs the whole suite under Node. Use `bun --bun x vitest run`.
- `node` can resolve to Bun. On Bun 1.4.3, a package script that calls `node` printed Bun's
  version under `bun --bun run` and Node's under plain `bun run`; a `Bun.spawnSync(['node', …])`
  reached real Node in both modes. The shim depends on Bun's `run.bun` setting, which defaults
  on only when `node` is absent from `PATH`. Check `process.versions.bun` in the spawned process,
  and filter `PATH` entries matching `/bun/i` when you need real Node.
- With no `node_modules` up the tree, `require.resolve` falls back to Bun's global
  install cache ([oven-sh/bun#42893](https://github.com/oven-sh/bun/issues/42893)).
  Pass `--no-install` for a hermetic "not installed" result.
- File-path and `{ eval: true }` workers both run under Bun, and `node:sqlite` and
  NAPI `.node` addons load.
- Many busy, allocating workers wait on each other's parallel GC marking
  ([oven-sh/bun#44186](https://github.com/oven-sh/bun/issues/44186)); with 8
  workers `BUN_JSC_numberOfGCMarkers=1` roughly halved wall time. Attribute with a
  profiler before concluding anything about worker scaling.
- Node 26.11 renamed its synchronous SQLite classes to `Database` and `Statement`
  (`DatabaseSync` and `StatementSync` stay as aliases) and caches common property
  keys in its SQLite bindings. Record the exact Node version beside SQLite
  results; an older baseline does not establish the gap on the new runtime.

## Event-loop and server-code measurement

A Node or Bun server has one thread that runs request handling, timers and
synchronous database calls. A slow call matters when it holds that thread, so
measure the hold, not only the duration. (M) marks a result measured on one
workload and host, not a benchmark.

- **Measure the longest stall, not wall time.** Run a 1 ms `setInterval` that
  records the largest gap between ticks while the call runs, after letting the
  loop settle first. Report it beside wall time. They differ: a snapshot read took
  79 ms of wall time and held the loop for 12.6 ms because the runtime yielded
  between steps (M). `perf_hooks.monitorEventLoopDelay` read a floor of about 1 ms
  in these harnesses, so use it for coarse trends, not for claims of a few ms.
- **Time the real function, not a copy.** A copied string-appending coalescer
  looked quadratic; the real one showed equal CPU and equal longest stall within
  noise, because V8 joins repeated concatenation lazily (M). A replica that leaves
  out framework overhead is only a lower bound. Run server code inside the
  project's own test runner with its in-memory test layer, write results to a file
  because runners often swallow `console.log`, and delete the temporary test
  afterwards.
- **Count volume when volume is the cost.** For code that emits events or
  messages, feed a fixed synthetic input through the real component and count the
  events and serialized bytes at several sizes. Counts are deterministic, so they
  need no repetitions; stall and wall time still do. One adapter emitted three
  events per streamed chunk, each carrying the whole reply so far: 15,003 events
  and 263.6 MB for 5,000 chunks of 10 characters, growing about 3.3 to 3.6 times
  per doubling, with a longest stall under 6 ms (M). That is a volume problem, not
  a stall.
- **Separate loop time from child-process time.** Work done by a spawned process
  uses CPU but does not hold the loop. Count a process spawn as loop cost only
  for its spawning and parsing.
- **Prove that work left the loop with a test that cannot pass otherwise.** Hold
  the main connection or thread busy (an open transaction blocked on a latch) and
  assert the moved work still completes. A speed measurement alone cannot show
  where the work ran. Moving one read off the loop took the longest stall from a
  median 165 ms to 2.5 ms over 12 runs per arm, with wall time unchanged (M).
- **Measure retention with forced garbage collection.** Run N synthetic sessions
  or turns, force a collection, and compare heap deltas with the suspect field
  kept and dropped, keeping the owner reachable to the end. Keeping only the two
  fields that were read took 61.45 MiB to 2.10 MiB over 30 sessions of 10 turns of
  200 KiB (M).
- **Time startup on the built artifact, interleaved.** Alternate arms over at
  least 10 runs on one build. An environment variable can stand in for an API
  call, but note what it changes (it also reaches child processes). A V8 compile
  cache took a CLI's `--help` from a 554 ms median to 381 ms over 11 runs (M).
- **Treat another researcher's numbers as leads.** Of three top candidates from a
  model's blind read-only pass, re-measuring left one refuted, one mostly covered
  by existing work and one real but small. Re-run a lead with the real function
  and the stall probe before acting on it.
