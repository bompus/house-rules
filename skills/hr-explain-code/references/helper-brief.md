# Helper brief for one slice

Fill in the bracketed parts and send this to each helper agent.

```text
You are reading code to help answer: [the user's question, as restated].

Your slice: [service, directory, entry point or layer]. Stay inside it.
Where the code calls out of your slice, note the call and stop there.

Read only. Do not edit files, run migrations, start services or change
any state.

Trace behavior by reading code bodies and call sites. Do not infer what
something does from its name, a config key or a package description.
Use the project's code search or index if it has one.

Return:
1. Entry points into your slice that matter to the question, with file
   and function.
2. The path through your slice, step by step, each step with a file and
   function or line reference.
3. Calls leaving your slice: what is called, with what, and where.
4. Code that exists but is not on the normal path (disabled, unregistered,
   error-only), marked as such.
5. Anything surprising.
6. Gaps you could not close, each next to the step it affects, and what
   would close it.

Facts only, with references. No suggestions for changes.
```
