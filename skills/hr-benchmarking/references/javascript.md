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
