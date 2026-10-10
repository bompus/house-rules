# Changelog

Notable changes to house-rules. Versions follow [semantic versioning](https://semver.org).

## Unreleased

- `hr-code-review` now has a panel setup procedure and a small dated recommendation
  catalog, loaded only when the user asks to set up a panel or for recommendations.
  Setup lists routes through the host's read-only interface, asks only open
  questions, previews the portable preferences and saves them only after
  confirmation, with no model calls. Catalog entries record model, effort, source,
  checked date, sample count, metric and limits, and write `unknown` for anything
  not recorded.
- `hr-what-next` now has a walk-through mode: when asked to go through the backlog
  item by item, it shows one visual of the ranked backlog grouped by what each
  item waits on, asks one group of questions per reply with one combined accept
  line, and records each answer before acting. A request to see the backlog adds
  the same visual beside the table. The shared reporting reference is unchanged.

- `panel-plan.mjs` now rejects a metered route under `meteredRoutes: included-only`
  (it was accepted, and an approval was never needed) and treats `included-only`
  as the stricter setting when layers combine, so a project or task layer can no
  longer loosen a user's `included-only` to `explicit-approval-required`. An alias
  such as `constructor` with no binding is now reported as unbound instead of
  resolving through the object prototype. A review panel found both.

- `hr-code-review` now bundles `scripts/panel-plan.mjs`, which resolves stored
  panel preferences and a user-owned bindings file into the seats a panel would
  run, with skipped candidates and named blockers, before any model is called.
  Project and task layers can only tighten the user's policy, and project
  preferences count only when approved by file revision. The preference
  validation moved from the package root into the skill so the installed skill
  carries it.

- The agent-work rule now treats each review finding as a claim: fix it when a
  reproduced failure or a cited requirement confirms it, with the smallest
  change that clears it, and answer an unconfirmed finding with the reason. A
  reviewer's proposed remedy counts as a suggestion. Before, only the
  pull-request follow-up skill said this; the rule for local model reviews said
  to fix findings.

- The `no-attribution` modifier and `hr-writing-pr` now make one exception:
  when a repository's contribution guidelines or pull request template ask for
  agent or model disclosure, give exactly what they ask for, where they ask for
  it. When models are asked for, the disclosure names each model that did the
  work; a model in a higher tier of the same provider's published tiers that
  reviewed or advised on another's work is named first, and models those tiers
  do not rank follow in the order they worked.
  Unrequested credit lines stay out. Before this, a template line such as
  "if you used an agent, end with the model and harness" conflicted with the
  rule and had to be skipped.

- The local-timezone rule now names the host clock zone (`date +%Z`, or
  `Get-TimeZone` on Windows) as part of the session environment and requires
  checking it before reporting UTC or saying the zone is unknown.

- The plan-files rule now keeps the ledger as a `## Ledger` section of item
  lines (open, deferred with a trigger, done with evidence, dropped with who
  dropped it), and `hr-what-next` gains `scripts/check-open-work.mjs`. The
  script lists open and deferred items, flags scratch directories and
  checkouts the session owns that no open item names, and its `--archive` flag
  moves a plan to the archive only when its status is completed and nothing is
  open. A measured scan found over half of archived plans had been archived
  with an open status, and the earlier wording relied on each agent checking by
  hand.
- `hr-agent-guidance-audit` gains a verdict method for deciding which
  skills, docs and scripts to retire or merge: one verdict per candidate with
  quoted evidence, separate verdicts for the shared source and a local
  install, and usage counts treated as supporting evidence only.

- The landing procedure now updates a default branch checked out in another
  worktree with `git merge --ff-only` to the fetched, verified remote head
  instead of `git pull --ff-only`. A concurrent fetch in a shared repository
  can rewrite `FETCH_HEAD` and make the pull fail.
- `hr-code-review` now covers what a change can break beyond its diff. It adds
  an Impact section, using the method that `hr-change-impact` held, when asked
  or when a diff touches stored shapes, outside readers, timing, configuration
  or pinned dependency behavior. `hr-change-impact` is removed.
- `hr-maintainability-review` also handles whole-repository over-engineering
  audits: it now checks for leftover scaffolding and tests suspect layers by
  imagining them deleted.
- `hr-design-exploration` gains a single-component mode: three variants on one
  design axis, compared in the real page.
- `hr-lean-plan` leaves out steps added only in case something goes wrong.

- Upgrade note: a config that lists `hr-change-impact` in `skills.include` now
  fails composition with "unknown shipped skill". Replace it with
  `hr-code-review`.

- New `hr-usage-report` skill: measure where Claude Code, Codex and OpenCode
  usage went by provider, model and role at list prices, and render model
  comparisons as self-contained HTML charts and verdict tables.

## 0.11.0 - 2026-10-09

- First npm publication of `@bompus/house-rules`, with the `house-rules` CLI
  and bundled rules, skills and docs. Later versions publish from a GitHub
  release through npm trusted publishing.

- Upgrade note: `--out` now also writes `house-rules-references/` beside the
  rules file, and the written rules link into it. Keep that directory with any
  copy of the rules file. Stdout keeps the procedures inline. Composition
  refuses overlapping output paths and will not overwrite modified or
  unrecognized files in that directory.

- Upgrade note: the sample `examples/person/house-rules.json` now selects no
  modifiers and eight skills through `skills.include`. Existing configs are
  unchanged and keep the full shipped skill set.

- Upgrade note: core gained a `## GitHub Actions` section. A personal-layer
  section with the same heading now fails composition; give it
  `replaces: GitHub Actions` frontmatter instead.

- Split the benchmarking collector notes and the variation criterion into
  shorter paragraphs so the newer notes stand on their own. The wording is
  unchanged.

- When a review bot spends a usage-limited review on each pushed head,
  hr-pr-followup runs the gates before the first push, sends one push per
  review round, waits for the running review unless a push fixes an
  independent blocker, and integrates the base only when the PR needs it.

- A short "next?" in hr-what-next now always covers unanswered questions from
  earlier offers, owned uncommitted files, unpushed commits and held
  checkouts, and the number of other live ledger items. It may not say that
  nothing is left or that nothing needs the user while any of them remain.
  The end-of-reply grader treats "nothing needs your input" as a completion
  claim and accepts a coded offer that re-presents a later question, such as
  Question 2, when its option codes use that question's number. A new scenario covers a "next?" with an unanswered question.

- Update the benchmarking tool notes for Hyperfine 2.0: commands run without a
  shell by default, peak memory is measured on Linux and macOS, hardware
  counters are opt-in with `--metrics` there, and the JSON export layout
  changed.

- Split the Reporting table paragraph so the before/after metric guidance stands
  on its own. The wording is unchanged.

- Before landing a changed benchmark evidence reader, run it over the saved
  archive after integrating the base branch and compare its accepted and
  excluded records with the frozen reader's.

- Add an optional fenced-core benchmark arm for shared hosts: with the user's
  authorization, move other threads the user may change off the benchmark CPUs
  for a finite phase, record processes that stay unfenced, gate on foreign CPU
  of those CPUs, and restore every moved thread afterwards. The Linux
  process-attribution collector now reports per-CPU busy cores (excluding
  steal time, also for the host total) and each process's reaped-child CPU,
  attributed to the parent that reaped it. Short or tail metrics get an
  absolute variation floor or a percentile or count metric, and automated stop
  rules use the acceptance analysis code. CPUs that go offline or online during
  a sample are reported as null instead of idle, and undecodable process names
  keep their attribution.

- Put performance results before lengthy verification details in pull requests.
  Keep required template sections, collapse supporting commands and avoid
  repeating result tables in prose. Prefer useful performance charts beside exact
  tables, with a preview before publishing a new visual style.

- Show percent or times benefit in before/after metric tables. Keep benchmark
  collector, scheduling and qualification details in measurement records unless
  they affect the claim or the reader requests them. Use a practical 3% no-clear-change
  reporting band, with measured variability still required for gain claims.

- Reconcile task and ledger records on resume, changed requests or results,
  phase completion, and before offers or handoffs. Preserve completion evidence,
  superseded history and unresolved user scope.

- Report progress during long work and show clock-time forecasts in the user's
  local timezone. The optional effort-estimates modifier includes whole-task
  and running-job forecasts with consistent numeric progress counts.

- Add optional versioned panel preferences through guarded configuration preview
  and save. Ordered aliases and policy are stored without discovering providers,
  changing existing presets or invoking models. Unrelated settings are preserved.

- Require review of the final diff before submitting pull requests to external
  upstream projects; owned repositories and maintained forks keep their policies.

- Add finite Linux and Windows process-attribution collectors to benchmarking
  tooling, with process birth identities and observer cost records.

- Keep routine reply lists focused while preserving complete inventories and
  required options. Check reply openings and endings for a clear answer and
  any required next action.

- Check blocked, paused and completed handbacks in the end-of-reply evaluator.
  Add replay cases for redundant approvals, missing offers and exact-source
  limits, plus an explicit boundary-record checker for opt-in host pilots.

- Review-helper diagnostics direct callers to inspect the review integration and
  repository policy instead of requesting a manual full review. Existing
  review gates remain required.

- Require full-session reconciliation and a saved completed state before saying
  a session is complete and can close. Preserve unfinished work when paused.

- Add GitHub Actions guidance for native parallel steps, shared runner resources,
  failure diagnosis and fork automation settings.

- Sort package fields and dependency maps with Oxfmt while preserving script order.

- Benchmarking guidance separates processing-worker limits from reported OS-thread
  counts and requires revised admission before relaxing a declared stop condition.

- Default ordinary benchmarks to normal scheduling and available CPUs. Keep
  scheduling restrictions explicit and historical protocols unchanged. Issue
  and pull request reproductions omit incidental execution wrappers while
  retaining material measurement conditions.

- Accept inspection as qualification for bounded repository work within host
  limits. Missing resource measurements alone no longer require a fresh
  benchmark-owner grant; required hooks, input freezes and specific user stops
  still apply.

- Check authored documentation and configuration files with Oxfmt; preserve
  exact-content test fixtures.

- Require bug reports to isolate underlying operations, verify their connection
  to the original symptom and distinguish causal evidence from runtime guesses.

- The plain-prose checker flags counts and measurement units joined to prose
  without spaces, while preserving literal identifiers in code spans. The
  writing recipe applies the check to outgoing agent messages.

- Require a remaining-work check before every reply ends, including completed
  phases, landed pull requests, status answers and external waits. Continue
  authorized work or automatically present the next ready decision; distinguish
  blocked or deferred work from an empty ledger.

- Clarify that benchmark locks do not block qualified non-heavy checks or pause
  other tasks. Classify actual commands and preserve measurement inputs, resource
  budgets and separate repository or installation write locks.

- Export detailed backlog reporting through a bundled `hr-what-next` reference,
  independently of skill selection. Keep general reporting and automatic completion
  duties inline, and preserve full inline output for default API and stdout callers.

- Add a bundled ACP v1 review client with terminal execution disabled, confined
  physical file reads, denied permissions and verified model, effort and read-only
  mode bindings. Provider selection and authorization stay with the caller.

- Export the enabled multi-agent modifier's complete delegation, review and cleanup
  procedure through rule references, retaining inline safeguards and full inline
  output for default API and stdout callers.

- Written rules now export core Landing and selected Squash landing procedures
  through independent references, retaining safety boundaries inline. Default
  composition and stdout retain full procedure bodies; personal replacements
  suppress the resources they replace.

- Export release-procedure references beside written rules independently of
  selected skills. Keep stdout and configuration previews inline, and protect
  exported references from overwriting modified or unrecognized files.

- Clarify checkout protection during integration and retain the guarded move
  after landing. Point release guidance to the full shared procedure, align the
  handoff picker with resumable handoffs and remove repeated palette wording.

- Add `hr-tdd` for requested test-first implementation, with bundled test and
  mocking examples. Keep red-green cycles separate from review-stage simplification
  and preserve fresh-install skill selections.

- Document the Reddit reader's announced November 13, 2026 RSS cutoff,
  potentially incomplete comment output and partial web-search fallback.

- Add optional GitHub review-feedback and single-thread resolution helpers to
  `hr-pr-followup`, with complete-read checks, dry-run resolution and
  lost-response verification.

- Keep unverified stale-text matches out of navigation ranking scores and detect
  missing-path diagnostics beyond result prefixes without counting source quotes.

- Start fresh installs with eight skills and no modifiers. Add explicit shipped
  skill selection while preserving existing configs and personal layers. Setup
  introduces relevant additions without requiring a catalog-wide decision.

- Require new guidance proposals to explain their need, existing alternatives,
  evidence, activation limits and setup or maintenance cost.

- Clarify that agent guidance audits cover the requested repository scope,
  including skill description accuracy.

- Extend navigation retrospectives to OpenCode JSON exports, Cursor CLI stream
  JSON and ACP v1 recordings. Include undated events by default, warn about
  missing tool evidence and require timestamps only for explicit date windows.

- Add dependency-free numbered setup for modifiers, skills and question
  preferences, with review, explicit save and stale-revision recovery.
  Saving changes configuration only; generated output and host connections
  remain separate steps.

- Add an explicit-only navigation retrospective with selected transcript inputs,
  repository-root mappings, supported Claude/Codex metrics and synthetic tests.
  Transcript discovery and sensitive findings stay with the host.

- Add an explicit-only project tracker setup skill that reuses existing issue,
  domain-term and ADR conventions without imposing unrelated setup.

- Notify affected sessions after agent-component updates and refresh subagent,
  configuration, script and tool discovery alongside deployed rules and skills.

- Clarify demand-based inspection of competing jobs, diagnostic uncalibrated
  activity counters and finite resource reservations with productive light work
  while waiting.

- Clarify that lean planning drafts and critiques plans in the conversation
  without changing files or writing code; preserve explicit-only invocation.

- Prefer useful visual explanations, comparable actual interface captures and
  accessible equivalents while labeling illustrations and respecting task scope.

- Add independently written PR splitting and follow-up skills, with recovery
  coverage, per-slice verification and existing-authority landing behavior.

- Clarify stock UI audit review versus cleanup triggers, and benchmark timing,
  memory and saved-evidence assessment; preserve invocation policies.

- Separate observer cost budgets from contention and pressure gates, account for
  all collectors, and require sensitivity evidence for claims of negligible
  observation effects. Record protocol versions before execution and preserve
  historical rejection verdicts. Retain over-budget runs outside accepted
  evidence; declare stop rules and replacement limits before execution. Record
  budget failures separately from foreign-load and pressure failures.

- Explicit maintainability reviews now support entire repositories and
  subsystems, account for coverage gaps, use maintenance-priority verdicts for
  those scopes, and distinguish structure from correctness, UI, tests and
  measured performance.

- Share review evidence assessment, weakened-test accounting and verification
  limits through the existing code-review skill.

- Share guidance-verification methods and research, lesson and override
  maintenance through the existing audit and refresh skills.

- Move pure source credit into distributed notices, carry notices in affected
  standalone skill bundles, and document notice carriage for rules-only exports.

- Six existing skills now clarify API field access and change reports, runnable
  impact evidence, explanation sources, planning blockers, structural review
  findings and stock UI candidates. Invocation metadata stays unchanged.

- Routine completion offers now focus on the next decision and owned landings;
  full backlog reviews list every live candidate. Deferring displayed proposals
  preserves other pending work and the latest valid offer in the ledger.

- Guidance authoring now assesses third-party adaptations within selected scope,
  preserving source ownership, licence requirements and provenance.

- The opt-in shared-load modifier now follows host-defined resource budgets
  instead of prescribing fixed concurrency, memory limits or platform commands.
  Without a host budget, get operator direction before whole-repository or
  parallel local work.

- Completion and blocked checkpoints now check the task ledger and offer the
  highest-priority ready next step without waiting for a "next?" prompt.

- Guidance refresh now discovers optional Swarmail update procedures through
  product instructions, CLI help and approved local documentation.

- Swarmail coordination now points to product-owned instructions, tool contracts
  and approved local documentation instead of copying operational recipes.
  Shared coordination rules retain independent checkout ownership checks.

- Benchmark guidance now freezes artifact and historical evidence identities,
  qualifies required observers, and bounds independent-case continuation and
  retries while preserving admission and pressure gates.

- Relay guidance now clarifies whether a handoff informs or requests work, names
  its action, repository and owner, and distinguishes source changes, installation
  and guidance additions while preserving verified authority and scope.

- Release batching now audits documentation, comparisons, performance claims,
  announcement materials and release notes against verified state before
  releases or public announcements.

- Add manual QA guidance for reproducible human checks after agent verification,
  and revisit related owned work when a correction disproves a shared assumption.

- Benchmark guidance now verifies saved run identities and qualification from raw
  evidence, and limits observer-induced retention in WeakRef memory probes.

- The benchmarking skill now links a dated priority experiment record, including
  positive, zero and negative nice results, inheritance behavior and scope limits.

- Cross-session selection guidance now binds relayed offer choices to verified
  source messages and exact scope instead of the receiving session's offer codes.

- Swarmail sender guidance now omits routine and courtesy mail, narrows resource
  notices to remaining dependencies, and uses supported quiet delivery for
  normal/low informational mail while preserving actionable wake delivery.

- Benchmark guidance now records candidate inventories and subset coverage,
  and keeps cache owners reachable through the final retention observation.

- Guidance refresh now checks approved deployed revisions at session boundaries,
  rereads affected rules and skills once, and distinguishes installed or delivered
  updates from loaded-context evidence while preserving frozen evaluations.

- Clarify dependency selection by comparing supported features, integration and
  maintenance costs, transitive requirements and shipped size; distinguish
  build-time generation from runtime compilation and measure performance
  uncertainty only when it could change the choice.

- Resolve GitHub guidance links with URL queries to their local file paths,
  including raw Markdown URLs, while preserving encoded filename characters.

- Explain-code and PR-writing guidance now choose compact code views and
  structural diffs when clearer than prose, preserving source references,
  guards, ordering, verification and uncertainty.

- Clarify benchmark evaluation contracts and labels, invalidate specificity
  estimates for defective clean controls, and separate completion, format and
  artifact acceptance from verification costs and attributable account charges.

- Strengthen API response checks for real caller/path cases and supported output
  schemas; require explain-code traces to identify runtime roles and guarded
  writes in both main and helper guidance. Change-impact checks now include
  relevant history, local dependency patches, supported surfaces and reverse
  operations. Lean plans check module coupling and shared-path feature leakage;
  API response reviews use the owning exposure skill and report its absence.

- Benchmarking guidance now requires justified run matrices and exploratory
  screening before preset repeated confirmation of selected comparisons.

- Clarify reporting guidance to use compact tables for multiple benefits,
  tradeoffs and differences from current behavior, one item per row, with
  evidence and uncertainty.

- Remove test fixtures after successful and failed tests, and support
  `HOUSE_RULES_TEST_TMP` across composer, configuration, installer and eval tests.

- Add `hr-design-exploration` for four ranked visual directions, top-two feedback
  and rounds retaining the two selections alongside one variation of each.

- Explain internal shorthand in ordinary language; require offers for decisions
  and for live candidates at task completion. Repeat estimates when requested,
  relevant or changed.

- Use loaded local submission guidance in PR and bug-report skills; add local-reference guidance and a source audit that catches GitHub pointers to known checkouts.

- Clarify that logic fixes permit a focused follow-up review without requiring
  one. Record its scope and round limit before starting; further fixes do not
  restart the limit or trigger another whole-change review.

- Search open and closed issues and pull requests before creating either; reuse
  applicable work or explain and link a distinct scope, regression or replacement.

- Give every `hr-` skill an explicit `HR: ` display label while preserving
  command identifiers and invocation policies.

- Clarify `hr-what-next` discovery for full-session tasks and unanswered or past
  questions.

- Keep task responsibility in the current conversation unless the user directs
  a transfer or a handoff rule triggers; historical sessions do not assign work.

- Add `hr-what-next` for scoped remaining-work reconciliation and prioritized
  decisions, including short next-work requests and full session audits. Full
  audits save the individual table in a durable report.

## 0.10.0 - 2026-10-05

- Add `hr-progress-report` for task activity, evidence-based milestone progress
  and remaining wall-clock time, with blockers, waiting conditions and unknowns.

- Use tables for comparisons and repeated records. Show scoped backlog and
  research items in priority order based on the task's goal, expected impact
  and decision value, with readiness and uncertainty stated separately.

- Add an opt-in `release-batching` modifier to batch approved compatible changes
  with a defined cutoff, preserve repository release requirements, and let
  urgent fixes ship without waiting for unfinished work.

- Add a configuration CLI for browsing and toggling modifiers and skills, choosing question preferences, and previewing validated changes before safe writes.

- Prefer isolation over elevated benchmark priority. Record effective scheduling
  settings equally across comparison arms, preserve deployment settings for
  representative results, and test priority changes in separate sensitivity
  pilots under the host's resource rules.
- Batch approved changes into releases instead of publishing a version for each
  pull request. Record changes under `Unreleased` until the batch is ready;
  urgent fixes can still ship independently. Review checks accept matching
  `Unreleased` entries.

## 0.9.2 - 2026-10-05

- Make text-only questions explicit: do not call question-card tools unless
  the question-cards modifier is enabled. Setup explains text-only and
  optional card formats before changing the configuration, including
  differences in availability and presentation across hosts, providers and models.
- Preserve complete text offers when cards are enabled, and remove the card
  modifier when a user changes to text only.

## 0.9.1 - 2026-10-05

- Observe compressed-swap activity and cgroup ownership when interpreting Linux
  benchmark pressure. Stable disk swap counters alone do not prove no swapping.

## 0.9.0 - 2026-10-05

- Rename all shipped skills with the `hr-` prefix. Update skill invocations,
  personal override directories and frontmatter names, exclusions and host
  links. Rule headings and modifier names are unchanged. No old-name aliases
  are shipped. See [the upgrade guide](docs/skill-names.md).
- Refuse legacy exclusion names and ambiguous personal override names before
  composition writes output. `skills.independent` records generic personal
  skills intentionally kept alongside their prefixed counterparts.

## 0.8.0 - 2026-10-05

- Add five web UI skills for accessibility, colors, layout, typography and
  interface writing, with their supporting references and discovery metadata.
- Preserve both upstream MIT notices and pinned provenance. Mobile browser
  checks distinguish device emulation from hardware verification, and
  `theme-color` guidance accounts for platform support.
- UI review verdicts fit within the host's completion rules.

## 0.7.3 - 2026-10-05

- Align resource-counter boundaries with measured work. Keep post-run
  observations diagnostic and report admission and monitoring overhead
  separately from workload time. Batch compatible probes when they dominate
  elapsed time.
- When a local phase has unknown resource use or budget, contact the reservation
  owner, host coordinator or operator and record agreed limits before launch.

## 0.7.2 - 2026-10-05

- Reserve shared machines only for heavy local phases or deliberately isolated
  local performance measurements. Remote inference, light CLI work and remote
  waits do not need an exclusive slot. Keep timing conditions visible when
  evaluating remote agents and models.

## 0.7.1 - 2026-10-05

- Swarmail priority guides when a receiver considers pausing its task.
  High or urgent mail can justify saving work, handling an authorized
  request and resuming. Normal or low priority leaves the pause decision
  to the receiver based on content. Priority grants no additional authority.

## 0.7.0 - 2026-10-05

- Handoffs now reconcile transcript records and linked task ledgers with an
  offline checker. The receipt records source counts and gaps, item outcomes,
  owned and dependency pull requests, and commits without pull requests.
- The checker reports complete, partial or invalid mechanical coverage.
  It cannot find promises hidden in records classified as context, discover
  unreported sources, or decide whether an outcome is supported semantically.
  An unfinished receipt never delays a low-quota stop.

## 0.6.5 - 2026-10-05

- Attribute benchmark CPU, load and resident memory before treating them as
  competing work. Expected own utilization does not reject a run; actual
  resource pressure still does. Use a settled fresh interval between arms and
  investigate uncertain overlap before a decisive comparison.

## 0.6.4 - 2026-10-05

- Benchmarking starts with one run per arm. Correctness-only checks can use
  one candidate run. Performance claims need repeated alternating runs to
  assess variation, with the run plan and variation criterion set before the
  first result used for the claim. Retain pilot results separately.
- Bug hunts use the current benchmark-backed model order. An unavailable
  primary falls back to the next eligible model, recording the model, effort
  and reason while preserving review independence and billing limits.

## 0.6.3 - 2026-10-05

- At task or session closeout, check for reusable lessons and save their
  condition, recommended action and evidence. Link existing rules or checks
  instead of duplicating them. No lesson entry is needed when none emerged.

## 0.6.2 - 2026-10-05

- Issues and pull requests with major or material changes now get a new,
  linked submission in every repository. Carry forward evidence and unresolved
  feedback, verify the replacement, then close the old submission as superseded.
  Routine corrections stay in place.

## 0.6.1 - 2026-10-05

- Portable bug reporting now lives in `diagnosing-bugs/references/reporting.md`: search existing reports, reduce and verify a case, preserve submission metadata, follow up with evidence, and verify fixes. Shared rules point to this guide; fix-scope guidance lives in `writing-pr`.
- Before filing a bug in any repository, reduce and run the smallest
  self-contained reproduction. Trace library failures to individual operations,
  preserve the original failure, and separate suspected causes from confirmed
  ones. If reduction fails, ask before submitting the broader case.

- Pull requests should try the simplest adequate fix first and use a focused,
  reviewable diff. Larger performance changes need measurements explaining why
  the simpler approach is insufficient.

## 0.6.0 - 2026-10-05

- New `benchmarking` skill: portable comparison methodology and a focused
  tool reference for timing, profiling, debugging and correctness checks.
  Keep workload identity, repetitions and measurement limits with results.
- Shared-host-load modifier: allow light work in other sessions during heavy
  jobs and measurements. Pause competing jobs rather than whole sessions;
  account for hooks and child processes, preserve the measured environment,
  and release reservations while waiting on remote work or reviews.

## 0.5.20 - 2026-10-05

- Before submitting a GitHub issue or pull request, read its templates and
  contribution guidelines and use the matching template. Preserve issue-form
  behavior and verify required labels and routing after submission.

## 0.5.19 - 2026-10-04

- Core § Implementation economy: replace rather than wrap. When nothing
  outside the change depends on the old shape, update every caller and keep
  no compatibility path, shim or migration. Delete what the change left
  unused and list it in the report.
- Core § Reporting: name each choice made in passing that costs the user
  something if missed, in words they would still recognize a week later.
  Prompted by the guidance in Claude Code's built-in "You should know" plugin.
- `plain-prose` § Make it easy to read gains four rules. Keep a step near 20
  words and a descriptive sentence near 25. Write each step as one command
  with its condition first. Use no names coined during the work. Make report
  headings state the takeaway. The length and step rules follow ASD-STE100,
  held loosely.
- `plain-prose` checker: flags a sentence over 30 words, counted across
  wrapped lines, skipping code and front matter.

## 0.5.18 - 2026-10-04

- `diagnosing-bugs` § Question the premise: after two fixes that rest on the
  same assumption fail the same check, write the assumption down and gather
  rerunnable evidence that would show it false before a third fix. Adapted
  from pstack's attack-the-premise principle.

## 0.5.17 - 2026-10-04

- Core § Implementation economy: when a change touches more than three places,
  or an analysis covers more than three files or records, write the script
  that does or proves it. Do the first unit by hand and confirm the script
  reproduces it. A second run must change nothing and repeat no external
  action. Adapted from pstack's build-the-lever principle.

## 0.5.16 - 2026-10-04

- Multi-agent modifier: the review-rounds rule from 0.5.15 is its own
  paragraph, so the paragraph before it fits a 900-character limit again.

## 0.5.15 - 2026-10-04

- Multi-agent modifier: after a model review's findings are fixed, review again
  only when a fix changed code logic. Fixes that touch only docs, comments,
  changelog text or tests ship on local checks, and the pull request says no
  further round ran. Before this change nothing said when to stop, and agents
  re-ran reviews after fixes to wording alone.

## 0.5.14 - 2026-10-04

- plain-prose checker: fewer false cues. A sweep of 378 tracked Markdown
  files in two repositories found six kinds. The word-table rows in SKILL.md
  no longer flag their own terms. A table row is skipped only when every term
  in its first cell is one of the skill's cue words.
  Straight double quotes that wrap onto the next line are skipped like
  one-line quotes. The colon after a list item's opening label (a phrase
  ending in a parenthesis or code, or up to six words with no linking verb)
  is no longer a colon reveal. An administrator ("elevated") shell on Windows
  and "elevation" as interface shadow depth no longer match the "elevate"
  cue. A dash between two code spans, as in a range of two code values, no
  longer reads as a spaced dash. A table cell holding only a dash is an empty
  cell, not prose. Code spans now count as words in the colon rule, which
  finds 11 reveals the earlier version missed. In that sweep the change
  removed 237 of 833 findings.

## 0.5.13 - 2026-10-04

- Swarmail modifier: a session whose register hook already named it at
  session start uses that name and does not call `macro_start_session` or
  `register_agent` for another. Elsewhere it registers with
  `macro_start_session`, passing its name as `agent_name` when it has one.
  Before this change the rule told every agent to call
  `macro_start_session` before its first edit, and agents that did so
  without the session tag got a second name.

## 0.5.12 - 2026-10-04

- plain-prose: `scripts/check.mjs` lists the spots in a draft the skill asks
  you to reread: em dashes and other dash stand-ins, colons between two
  clauses, curly quotes, filler phrases, and the words in the skill's two
  word tables, which it reads from SKILL.md. It skips code, URLs, text in
  straight double quotes, block quotations and kept passages, and exits 1
  when it finds anything. "Check the result" tells the agent to run it first.

## 0.5.11 - 2026-10-04

- Core § Writing: before a public name is settled (project, repository,
  package, command or MCP server), search the package registries it could
  publish to and GitHub, and for an MCP server the official MCP registry,
  Glama and awesome-mcp-servers. Exact and near matches are reported beside
  the candidate; the user picks. A near match, ignoring case and separators,
  differs by one letter or contains the candidate whole.

## 0.5.10 - 2026-10-04

- `writing-for-agents` § Pruning: a rule a check can enforce lives in the
  check. The document keeps the reason, the deliberate exceptions and the
  check's name. A new mechanical rule gets a check in the same change or is
  marked unchecked.
- `read-x-links`: a fourth step keeps a post's claims apart from what its
  linked source shows, reports what the tool actually does, and names claims
  with no evidence behind them.

## 0.5.9 - 2026-10-04

- LICENSE names the copyright holder as Aaron Queen instead of the GitHub
  handle bompus. The license terms are unchanged.

## 0.5.8 - 2026-10-04

- End-of-reply eval README: results of the first `--baseline` run on seven
  models, three runs each. The rules passed 62 of 63 replies, a one-sentence
  instruction 26 and no rules 21. The main README links the result.

## 0.5.7 - 2026-10-04

- End-of-reply eval: `--baseline` also runs every scenario with a
  one-sentence instruction in place of the rules and with no rules, prints
  each arm's passes, and warns about a scenario that passes in every arm.
  The rules arm alone sets the exit status. The idea of a no-skill arm comes
  from QingYunA/agent-html's eval runner; no code was copied.

## 0.5.6 - 2026-10-04

- Core § Implementation economy: the second time the same mistake or
  instruction comes up, it is encoded in structure before prose, in this
  order: a type, a lint rule, a test or check script, a shared helper, a
  runtime check. A written rule is the fallback when none of these would fail
  or block the mistake if it happened again.

## 0.5.5 - 2026-10-04

- Core § Reporting: the answer and anything the user must read or act on go
  in the reply's text after its last tool call. When a question card ends the
  reply, that text comes after every other tool call, right before the card.
  In one reply the requested links were written before a status
  check and never reached the user: the transcript held only a reasoning
  summary of them.

## 0.5.4 - 2026-10-04

- `question-cards`: no card when the choice depends on content only the text
  carries, such as images, tables, code, links or a long comparison. That
  offer goes as text alone. Each card option's description must stand on its
  own. On one host the card showed before the text written ahead of it, and
  the user had to answer without the screenshots the text held.

## 0.5.3 - 2026-10-04

- `question-cards`: asking the user to choose between options is an offer,
  even when the user asked to be asked, so it gets the full text offer on
  every host, with or without a card. A one-line question, a line saying the agent will ask, or no text
  does not count. Card labels keep the offer's codes, with an example. In a
  check where the user asked to be asked, three of five models sent little or
  no text before the card, and three used labels without codes.

## 0.5.2 - 2026-10-04

- `effort-estimates`: the first paragraph is split in two, so each stays
  under the 900-character paragraph limit some downstream configuration
  checks enforce. The wording is unchanged.

## 0.5.1 - 2026-10-04

- `effort-estimates`: a reply that moves an earlier quote shows the earlier
  figure beside the new one and names the evidence that moved it. The number
  of review and fix rounds comes from the comparable run, or from the task's
  own rounds so far, instead of assuming one. Asked how much time remains
  without a named scope, the agent answers for the whole task and gives any
  running benchmark, build, test suite or CI run its own labeled finish time.

## 0.5.0 - 2026-10-04

- New `question-cards` modifier. On hosts with a multiple-choice question
  tool, every offer is also sent as a question card, in the same reply right
  after the complete text offer. Without such a tool the text offer goes
  alone, and the agent does not look for a substitute. It also covers how an
  agent that delegates work answers a worker's card.
- `coded-offers`: a question card goes in the same reply, right after the
  text offer, instead of in its own later reply. In a check across agent
  hosts, a model given the old wording ended its reply after the text and
  never sent the card. Another section of the rules can now ask for a card,
  as well as a skill or plugin.
- `house-rules-setup` asks whether you run Swarmail and how offers should
  appear (plain, coded, or coded with a question card) before the remaining
  modifiers.

## 0.4.2 - 2026-10-03

- `effort-estimates`: the rule covers every estimate of work the session or its
  workers would do, in prose as well as in options. It never quotes human
  developer time (days, focused days, sprints) for that work. An estimate from
  a worker, doc or other model is converted to the session's wall-clock time
  with a comparable run, or dropped, never relayed as given. Workers are asked
  for scope (pieces, files, unknowns) rather than effort.

## 0.4.1 - 2026-10-03

- Core: before installing or enabling a third-party plugin, hook, skill that
  ships scripts or MCP server, check on a local copy what it can reach
  (commands, file writes, network hosts, skipped permission prompts, text added
  to the model's context). It uses the host's static listing where one exists,
  such as `claude plugin validate` for Claude Code mods from 2.1.287, and
  reads the scripts and server code the listing leaves out. Anything beyond
  the extension's stated purpose goes to the user before it is installed.

## 0.4.0 - 2026-10-03

- `install.ps1`: the installer for Windows 10 and 11
  (`irm .../install.ps1 | iex`), with the same runtime choice, environment
  variables and kept skills directory as `install.sh`. It runs under Windows
  PowerShell 5.1 and PowerShell 7. The checkout goes to
  `%LOCALAPPDATA%\house-rules`.
- `install.sh` and `install.ps1`: a run in the same second as the previous one
  keeps its own backup of the skills directory instead of nesting it inside the
  earlier backup.
- `.gitattributes` checks text files out with LF line endings on every
  platform.
- `stock-ui-audit`: findings name files with forward slashes on Windows too.
- CI also runs the tests on Windows.

## 0.3.0 - 2026-10-03

- `install.sh`: a one-line installer for Linux and macOS. It picks the newest
  Bun 1.4 or newer, otherwise the newest Node.js 22 or newer, clones or
  updates the checkout, creates a starter config when there is none and
  composes the rules file and skills. A previous skills directory is kept
  under a dated name, never deleted. The README quick start leads with it and
  keeps the manual steps for Windows and custom checkouts.

## 0.2.10 - 2026-10-03

- `effort-estimates`: the same rule in fewer words, so the paragraph stays
  under the 900-character ceiling a composing layer checks.

## 0.2.9 - 2026-10-03

- `effort-estimates`: before calling an estimate unmeasured, search for a
  comparable finished run (the same kind of work with the same waits) in logs,
  plan entries, pull request timestamps and earlier session transcripts, and
  say where you looked. An estimate is unmeasured only when no such run has
  both start and end times. A quote stays the same in later replies unless new
  evidence moves it.

## 0.2.8 - 2026-10-03

- Core: the end-of-task checkout check reads only your own branches
  (`git log <yours> --not --remotes`), since checkouts
  share branches and `--branches` or a bare `HEAD` can list another session's. The report covers
  your own leftovers; other sessions' work stays out of it unless it blocks
  yours.
- `squash-landing`: an app-managed checkout left on a landed branch is the
  app's to retire and goes unmentioned; a dirty or doubtful one is recorded
  where the task is tracked.

## 0.2.7 - 2026-10-03

- `plain-prose`: the description says it applies even to a short message or
  reply, so the skill loads when an agent drafts a Slack reply, an email or an
  issue comment for a person. In Claude Code routing tests it loaded for 14 of
  18 such prompts across two skill catalogs, up from 0 of 9 on one catalog
  before the change. It kept loading for closing reports and stayed off
  agent-instruction edits, quick answers and code.

## 0.2.6 - 2026-10-03

- `plain-prose`: the description names the final report on a task, so the
  skill loads when an agent writes it. In Claude Code routing tests on two
  skill catalogs, it loaded for 5 of 6 closing-report prompts, up from 0 of 6,
  and still stayed off agent-instruction edits, quick answers and code.

## 0.2.5 - 2026-10-03

- Core: keep a list of every checkout you touch, outside ones included, and
  check each before ending a task; name the owner of work you leave, or say it
  is unknown. When asked to send text through a channel you cannot reach, hand
  over the exact text instead of posting it another way.
- `coded-offers`: what calls for a closing offer, where its candidates come
  from, and that a candidate held by a "don't start until asked" safeguard
  stays listed as "(Not Recommended)".
- `plan-files`: check every `blocked-on-user` plan at session start, point at
  the plan or handoff that owns an item, and sweep other sessions' plans only
  when the user asks what is waiting on them.
- `scratch-on-disk`: a harness's pre-approved temp path does not override it;
  write in-progress receipts straight to their final location.
- `writing-for-agents`: how Claude Code's eval runner selects several cases and
  where its replies land.

## 0.2.4 - 2026-10-03

- New `multi-agent` modifier for work split across delegated workers and
  several agent hosts. A worker report with open items and no named blocker
  goes back as a checkpoint; implementers get only load-bearing constraints
  while style and judgment stay with the reviewer and anything checkable moves
  into tooling; cleanup checks every installed host's sessions, including idle
  and resumable ones, before deleting a branch, directory or worktree.

## 0.2.3 - 2026-10-03

- `squash-landing`: merge only after a review bot's check finishes and each
  finding is fixed or answered, including findings outside the diff that it
  posts in the review body instead of as threads. Landing never switches,
  resets or removes the session's own checkout; after the merge the checkout
  moves onto the fetched base (or detaches there when another worktree holds
  the base), and each landing updates the task list and any handoff before the
  task worktree is retired.

## 0.2.2 - 2026-10-03

- `plain-prose` covers more habits: no em dashes and no stand-in marks for
  them, colons only before a list or example, straight quotes, a list of
  overused words and abstract stand-in nouns with plain replacements,
  figurative prose, unnamed authorities, fake ranges, weak adverbs and
  judgment words without a baseline. It also checks for new uniform habits
  left by heavy editing, recurring replacement phrases and paragraph openers
  that read like a summary, allows an uneven quiet sentence, and leaves
  passages the author marks to keep.

## 0.2.1 - 2026-10-03

- `stock-ui-audit`'s scanner: a `)` inside a comment no longer ends a gradient
  early; an unclosed `gradient(` reads only its own line instead of borrowing
  colors from the rest of the file; a violet color after a gradient on its
  closing line is still reported; large files scan in linear time; and large
  `--json` output is no longer cut off when piped.

## 0.2.0 - 2026-10-03

- Eight new skills: `api-exposure-check`, `change-impact`, `explain-code`,
  `extract-shared-steps`, `lean-plan`, `maintainability-review`,
  `plain-prose` and `stock-ui-audit`. `stock-ui-audit` ships a
  dependency-free scanner (`scripts/scan.mjs`, Node.js 22+ or Bun) with its
  tests.

## 0.1.7 - 2026-10-03

- § Finishing work: the end-of-task checkout check is one command per
  checkout, run once. In a measured run, sessions spent two to six tool calls
  per small task on separate status and log checks.

## 0.1.6 - 2026-10-03

- The composer and eval runner need Node.js 22 or newer, or Bun 1.4 or newer;
  the README, setup skill and eval README now say so. CI also runs the tests
  and the example composition under Bun.

## 0.1.5 - 2026-10-02

- `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1). Reports go through the
  repository's private reporting form, so no address is published.

## 0.1.4 - 2026-10-02

- Issue forms for a rule an agent misread and for a script bug, and a pull
  request checklist.

## 0.1.3 - 2026-10-02

- `CONTRIBUTING.md`, and CI that runs the composer, grader and skill tests,
  oxlint and oxfmt on every push and pull request.
- Every version from 0.1.0 on is tagged `v<version>` with a GitHub release.
- README: the composer test command now lists its files, so it runs on
  Node 22 (`node --test test/` needs a newer Node).

## 0.1.2 - 2026-10-02

- `swarmail` modifier: when you won't act on a request, or can't yet, reply
  to the sender with the reason. Pausing your own work for another session
  is allowed when you can resume it; pause between steps instead of
  suspending a process, and tell the sender and the user.

## 0.1.1 - 2026-10-02

- `test-audit`: authoring-gate question 2 lists more production changes a
  test should catch: a wrong argument, an empty or default return, and a
  missing check for empty, nil, unauthorized or malformed input.

## 0.1.0 - 2026-10-02

First public release.

- Core rules (`rules/core.md`), led by the end-of-reply check that tells an
  agent when to keep working and when to stop and ask.
- Eleven opt-in modifiers: coded-offers, effort-estimates, land-when-done,
  low-quota-handoff, no-attribution, plan-files, scratch-on-disk,
  shared-host-load, solo-operator, squash-landing and swarmail.
- `compose.mjs` (Node 22 or later) builds one rules file and one skills
  directory from core, the enabled modifiers and your own layers.
- Thirteen skills, including `house-rules-setup`, which walks a user through
  choosing modifiers and installing the result for their agent hosts.
- An end-of-reply eval with its scenarios and grader, and example person and
  project layers.
