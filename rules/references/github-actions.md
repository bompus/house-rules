## GitHub Actions

Inspect the current workflows, run logs and effective repository policies before
changing CI. Distinguish runner startup or action-policy failures from test
failures, timeouts and missing credentials. Preserve checks and assertions;
qualify timeout changes with the actual failing operation and comparable runs.
Give jobs finite timeouts. Cancel an older pull-request run only when a newer
run for the same pull request covers the same required checks; preserve required
default-branch and release evidence.

### Cancel superseded pull-request runs

Key the `concurrency` group on the workflow and the pull request number, and
cancel only for pull-request events:

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.sha }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
```

- Concurrency groups are shared by every workflow in the repository, so keep a
  value unique to the workflow in the key. `github.workflow` is the workflow's
  name, so it is unique only while workflow names are; otherwise use a fixed
  prefix. Without a unique value, one workflow's run can cancel another's.
- Keep the pull-request key stable across pushes: never a commit SHA or run ID
  for a pull-request run, which differs on every push, so nothing is cancelled.
  A workflow that runs only on pull requests can use `cancel-in-progress: true`.
  A reusable workflow inherits the caller's `github.workflow`, so give caller and
  callee different keys.
- Cancellation needs a newer run in the same group. When a path filter means a
  push starts no run, the older run finishes. Add a cleanup workflow only when
  run history shows older runs finishing after pushes that started no
  replacement; it must not check out pull-request code.
- To skip checks on draft pull requests, add `github.event.pull_request.draft != true`
  to each check job's `if`, including reusable-workflow callers and aggregate
  jobs. A job guard stops a runner being allocated; a step guard does not. Add
  `ready_for_review` and `converted_to_draft` to the `pull_request` types, so
  checks start when review begins and a replacement run can cancel old work.
  Use this only when the repository's policy says draft pull requests do not
  need these checks.

### Choose the concurrency boundary

Independent jobs can run on separate runners. A job's steps normally run in
sequence, but GitHub also supports native parallel steps. Confirm current
[workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idstepsparallel)
before using it; older model knowledge may omit this capability.

- A `parallel` group starts its steps together and waits for the group.
- `background: true` starts a step without waiting. Use its `id` with `wait` or
  `cancel`, or use `wait-all` to wait for every active background step, as the
  dependency and failure policy requires.
- Parallel steps share a runner, workspace and resource budget. Inspect writes,
  caches, outputs and prerequisites before overlapping commands. Install shared
  dependencies first. Do not infer a speedup without measurements.
- Workflow `concurrency` controls overlapping runs; it does not parallelize steps.

Keep failure propagation and required evidence intact. More parallelism can
increase contention or duplicate work. Prefer the smallest independent group
that addresses a measured or operational need.

### Publishing to a package registry

A package registry can show a version late after a publish that succeeded. A
workflow that publishes to one skips a version the registry already has (once
its bytes match the artifact), waits after publishing until the version is
visible, and runs every later step that reads the registry after that wait.
Release batching, where it is installed, states the same rule for any publish
method. For npm, end the publish job with:

```yaml
- name: Verify the version is on the registry
  run: |
    name=$(jq -r .name package.json)
    version=$(jq -r .version package.json)
    for i in $(seq 1 30); do
      if npm view "$name@$version" version --fetch-retries=0 --fetch-timeout=5000 >/dev/null 2>&1; then
        echo "verified $name@$version"
        exit 0
      fi
      echo "waiting for $name@$version to appear ($i of 30)"
      sleep 10
    done
    echo "::error::$name@$version never appeared on the registry"
    exit 1
```

The loop waits about five minutes, and under 8 even when the registry keeps
failing, because each call has no retries and a 5-second timeout (npm's default
retries can take over a minute per call); raise the job's timeout when the steps
before it leave less than that. Query the registry the publish used: a
`publishConfig.registry` or a `--registry` given to `npm publish` does not apply
to `npm view`, so pass it there too.

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
