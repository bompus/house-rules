## GitHub Actions

Inspect the current workflows, run logs and effective repository policies before
changing CI. Distinguish runner startup or action-policy failures from test
failures, timeouts and missing credentials. Preserve checks and assertions;
qualify timeout changes with the actual failing operation and comparable runs.
Give jobs finite timeouts. Cancel superseded pull-request runs when appropriate;
preserve required default-branch and release evidence.

### Choose the concurrency boundary

Independent jobs can run on separate runners. A job's steps normally run in
sequence, but GitHub also supports native parallel steps. Confirm current
[workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idstepsparallel)
before using it; older model knowledge may omit this capability.

- A `parallel` group starts its steps together and waits for the group.
- `background: true` starts a step without waiting. Use its `id` with `wait`,
  `wait-all` or `cancel` as required by the dependency and failure policy.
- Parallel steps share a runner, workspace and resource budget. Inspect writes,
  caches, outputs and prerequisites before overlapping commands. Install shared
  dependencies first. Do not infer a speedup without measurements.
- Workflow `concurrency` controls overlapping runs; it does not parallelize steps.

Keep failure propagation and required evidence intact. More parallelism can
increase contention or duplicate work. Prefer the smallest independent group
that addresses a measured or operational need.

### Forks and notifications

Establish whether a fork is maintained independently or only hosts contributions
upstream. Honor that purpose before enabling workflows, publishing or changing
automation settings. Inspect repository Actions permissions separately from
workflow triggers and notification subscriptions.

Disabling repository Actions stops ordinary workflows, but enabled Dependabot
can still run on Actions. Check dependency-update automation separately when
investigating continuing runs. Keep security alerts and notification preferences
distinct from update automation; do not silence unrelated failures.

Sources: [parallel-step announcement](https://github.blog/changelog/2026-06-25-actions-steps-can-now-be-run-in-parallel/),
[Actions settings](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository),
[Dependabot on Actions](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-on-actions).
