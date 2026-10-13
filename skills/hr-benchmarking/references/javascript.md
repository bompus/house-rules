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
