# Changelog

Notable changes to house-rules. Versions follow [semantic versioning](https://semver.org).

## Unreleased

- The `hr-what-next` open-work check (`check-open-work.mjs`) has a new group, "possibly resolved by a later
  done line". It lists open or deferred items whose `recheck:` date has passed and that share a pull
  request, issue, commit, `mcp:` thread id or offer ID with a later done line. The result was probably
  logged as a new line instead of closing the old one. A token that more than 8 ledger lines name is too
  common to count, and a bare pull request number is read as `--repo`'s. The group reads only the plan
  text, runs on a plan that fails its lint, and does not change the exit code.

## 0.16.0 - 2026-10-17

- The `periodic-updates` modifier now says to arm the status watcher in the step that launches the job.
  The watcher posts a line every interval even when nothing changed, so one that fires only on milestones
  does not satisfy it. The modifier also says to wait on the job through the watcher, not in one long
  blocking call. The launch reply gives the total ETA, and gives it again when it changes, including when
  more rounds are queued.
- `check-pr-review.ts`, and so `merge-pr.sh`, now refuses while any check on the head commit is
  unfinished, failed, cancelled or timed out. It used to look only at CodeRabbit and cubic, so a
  pull request with a red CI check could merge. Neutral and skipped check runs still pass, a head
  commit with no checks passes, and `--wait` polls while another check runs. The gate does not tell
  required checks from optional ones, so a failing optional check also blocks the merge.
- The headline in `docs/assets/overview.png` now reads "Working rules for coding agents". It still said
  "Always-on", which the README and the banners dropped in 0.14.2.
- Repository only (not in the npm package): a new end-of-reply screening scenario, `periodic-launch`, grades
  the launch reply of a long job. The reply must give the update interval and either an ETA with its basis
  or the word "unmeasured". It fails when it blocks on one `sleep` or `timeout` of 10 minutes or more.
- Repository only (not in the npm package): the end-of-reply eval wrapper `claude.sh` accepts `EOR_KEEP_ENV`.
  It is a space-separated list of `CLAUDE*` or `ANTHROPIC*` variable names to keep, so a run can use a login
  that lives in the environment. The default is unchanged, and every such variable is still unset.
- Repository only (not in the npm package): the end-of-reply eval grader no longer drops a reply's opening
  prose when a scenario allows reads. A reply with a status line, a read-only call and an acting call, and
  no prose after them, is now graded whole. Its required patterns can match the status line.

## 0.15.2 - 2026-10-17

- The plan-source paragraph in the `hr-handoff` reconciliation reference is split in two, so no paragraph
  in the `hr-handoff` skill exceeds 900 characters. The wording is unchanged.

## 0.15.1 - 2026-10-17

- The `hr-handoff` reconciliation checker no longer ignores item lines outside a plan's `## Ledger`
  section, done and dropped ones included. It counts them and reports a gap naming the first five (the open
  or deferred ones, when there are any). The receipt is then partial, and a receipt that claims complete
  coverage is invalid. A plan with every item line in its ledger section reports as before.
- The `hr-what-next` open-work check keeps running the checks that read only the plan text when the plan
  fails its lint. Offers, re-check dates, the Purpose line and the open markers outside the ledger are
  reported next to the lint errors, and the result is still invalid input. The checks that read the host
  (scratch, checkouts, the audit record, GitHub) wait for a valid plan. Every unchecked box outside the
  ledger is listed; prose labels such as "Deferred:" are listed up to five, with a count of the rest.
- The successor-thread reference says a thread that holds no offer writes its offer list as "none".
- The header comments of `verify-landed.sh` and `merge-pr.sh` say exactly what the deprecated
  `--idle-primary` and `--preflight` flags do in each script.

## 0.15.0 - 2026-10-17

- Landing no longer waits on, or asks the user about, a local checkout. The landing rule, the landing and
  squash-landing references and the squash-landing modifier drop "leave alone a checkout another session or
  job uses, or whose use you cannot tell" and the stop on doubtful ownership. A checkout of the default branch
  that is strictly behind and has no uncommitted changes to tracked files is fast-forwarded with
  `git merge --ff-only <sha>`, regardless of who has it open. A dirty, diverged or mid-operation one is skipped
  and reported with its path and reason. Removing a worktree still waits on use.
- `verify-landed.sh --ff` and `merge-pr.sh` fast-forward the checkout that holds the default branch themselves.
  Sessions, processes and roster entries are never inputs, and untracked files do not block the sync unless
  a fast-forward would overwrite one. A checkout they skip is reported as `sync skipped at <path>: <reason>`,
  and both scripts then exit 3: landed, local sync pending. A caller that treats every non-zero exit as a failed landing must treat 3 as landed. A
  checkout whose Git state cannot be read is skipped, never updated. Both scripts accept
  `--idle-primary <path>` and ignore it with a note on stderr. It takes the next argument as its path unless
  that argument is missing or starts with `-`. `verify-landed.sh` also accepts `--preflight`. Without
  `--commit` and `--branch`, it prints a note and `preflight skipped: it no longer gates landing`, checks
  nothing and exits 0. With either one it exits 2. `merge-pr.sh` rejects `--preflight` as an unknown argument
  with exit 2. Both legacy options will be removed in a later release.
- A new opt-in modifier, `compression-codecs`, prefers zstd, then brotli, then gzip for data a project writes
  itself, using the first one that every writer and reader of the data supports. It limits zstd to runtimes
  that have it and negotiates browser responses by `Accept-Encoding`. It keeps gzip where another tool reads
  the file, keeps WebSocket compression on `permessage-deflate`, and gives starting levels for hot, cold,
  dynamic and static data.
- Repository work now says to read the default branch of the repository the change will land in before
  creating a branch or worktree. The agent fetches it and bases the work on its tip. That repository is your
  fork when the change lands there and upstream when a pull request targets upstream. A branch name shown by a
  tool or harness is not evidence of the default branch. A base named by the repository's own guidance still
  wins. The upstream-contributions modifier lists this step before submitting a pull request.

## 0.14.2 - 2026-10-17

- The README banner images no longer say "Always-on". Their tagline now matches the README alt text and
  the repository description: "Working rules and skills for AI coding agents".
- The repository has a security policy (`SECURITY.md`). It says what the installer and skill scripts do,
  asks for vulnerabilities to be reported through GitHub's private vulnerability reporting, and states that
  only the latest release gets fixes. The file is not part of the npm package.

## 0.14.1 - 2026-10-17

- The GitHub Actions reference now covers cancelling superseded pull-request runs (a stable group key,
  cancelling only on pull-request events, the path-filter caveat) and skipping checks on draft pull requests.
- The squash-landing procedure no longer quotes CodeRabbit's status text. It says an existing review
  check on the head must report completion and that a skipped or cancelled review is not a
  completed one. The CodeRabbit status test ("Review completed") stays in the `hr-pr-followup`
  review helpers reference, where the gate applies it.

## 0.14.0 - 2026-10-16

- The `hr-pr-followup` review gate (`skills/hr-pr-followup/scripts/check-pr-review.ts`) now treats
  the check named `cubic · AI code reviewer` on the head commit like CodeRabbit's. A running check
  refuses, and `--wait` polls it. A completed one must conclude SUCCESS, so a NEUTRAL or skipped
  result, which means cubic did not review the head, also refuses until someone comments
  `@cubic review` or its limit clears. A head commit with no cubic check is not blocked, and
  `--wait` does not wait for one to appear, so in a repository that uses cubic, confirm its check
  has posted before landing. The `.coderabbit.yaml` missing-check test still looks only for
  CodeRabbit.
- The release procedure (`release-batching` reference) now says to check every package for commits
  past its latest release tag before any decision to publish. When there are any, it recommends a
  new release first. This covers public and private packages and republishing an existing tag, which
  ships the tagged content without the later commits. A package that has never been tagged has no
  baseline, so the check says so and treats the publish as its first release. The recommendation
  does not permit tagging, publishing or announcing.
- The README header now reads the latest GitHub release and the npm version from badgen, which
  replaces the Shields release badge that failed with a token-pool error. A text link under the
  badges opens each of the banner's four feature chips: core rules, opt-in modifiers, your own
  layer and a project's `AGENTS.md`. The banner's alt text names the project and what it is.

## 0.13.0 - 2026-10-16

- **Breaking for saved chart specs:** `skills/hr-writing-pr/scripts/benefit-chart.py` now requires
  the spec's top-level `band`, the variation criterion declared before the first run, as a finite
  non-negative fraction of the baseline (for example `0.04`). It used to default to 0.03, so a spec
  saved without `band` now exits with a message; add one. A change at or inside the band is labeled
  "no clear change".
- **Breaking for hosts that check the reply boundary:** `checkBoundary(reply, state, context)` in
  `scripts/continuity-boundary.mjs` (a repository script, not part of the npm package) now accepts
  only version-2 handback records. The host passes the current plan text, session id and turn id in
  `context`. It also copies in the receipt that the `hr-what-next` open-work check prints for that
  plan, session and turn (`--json --session <id> --turn <id>`; both flags together, never with
  `--archive`). Every open item needs an explicit classification, ready actions and unsent results
  block handback, and each ready decision must appear as a presented offer option. A host's own
  stop, hold, pause or low-quota signal (`context.stopReason`) passes the check without validating
  the record, even when it is absent. A producer's `paused` disposition alone does not. Without that
  signal, version-1 records and two-argument calls fail; `evals/end-of-reply/README.md` ("Adapter
  migration") describes the records.
- Decision questions now explain what would change and why it matters before recommending an option,
  in every offer format. Coded options no longer limit reasons to when the user asks. The Writing
  rule and the plain-prose skill prefer ordinary names before identifiers, and the plain-prose skill
  adds that a question says what each answer authorizes. A new `evals/skill-fires` scenario checks
  the explanation, and its grader rejects a reply that performs or presumes a check the user has not
  selected.
- Add the opt-in `web-image-formats` modifier. It prefers WebP for supported raster images when it
  saves bytes at acceptable quality, preserves other format requirements, and checks delivered
  derivatives before claiming savings.
- `hr-handoff` gains a reference for handing work to a successor thread. A successor keeps the base
  title and ends it with ` v<N>`. The first thread counts as `v1` and is renamed at the handoff.
  Threads are found by registry row, project and thread id, never by title. Stale injected guidance
  warrants replacing a session only when the change is session-critical (an always-on rule, a safety
  rule, the catalog entry of a skill it uses, a subagent definition). Skill bodies and docs need
  only the reread. A replacement never happens mid-turn, mid-evaluation that fixed its guidance, or
  with an external action pending, and only when the session is idle with its ledger reconciled. The
  handoff names each open offer by ID so a bare `go` cannot select the wrong one. The outgoing
  thread is marked settled with a pointer to the successor. The successor re-points each registry
  row, scheduled task, pull request watch and messaging name that the host lets it bind. Items it
  cannot bind stay with the outgoing thread, with a recorded reason.
- `hr-benchmarking` no longer has a 3% default band for "no clear change". There is no minimum gain
  size. A favorable difference counts as a gain when the outputs are identical and it lies outside
  the variation criterion. The criterion is declared before the first run and is the comparison's
  own run-to-run spread, from its A/A arm or already-known variation. A worse difference outside the
  criterion is a regression, labeled worsening. When the criterion cannot support a percentage, the
  result is kept separate and unsupported differences are labeled inconclusive. A gap inside the
  criterion is still "no clear change", and memory and CPU costs are reported beside the gain.
  `hr-writing-pr`, the thread-visuals reference and the `upstream-contributions` rule now point at
  the declared variation criterion instead of a "reporting band".
- `hr-benchmarking` now gives a default stopping rule for performance claims, in place of "no
  universal minimum". Run 3 alternating runs per arm. Add 2 more per arm only when the arms' ranges
  overlap or the gap is within the variation criterion, for a cap of 5. If 5 runs per arm leave the
  comparison unresolved, it is reported as inconclusive. Another count is used only when the user
  asks for it or a run is too long to repeat 3 times. It is declared with its reason before the
  first run. Results always carry the run count and range, never a bare average. The expected
  wall-clock time is stated before the first run. The JavaScript reference no longer asks for at
  least 10 runs when timing startup. `hr-agent-guidance-audit` keeps its pass/fail rule screening (4
  or more runs, 9 per arm for a smaller gap) as a deliberate exception to this default.
- `hr-benchmarking` now says to test the newest stable release of each candidate. If the installed
  or deployed version differs, the results say so. The agent asks which to test when the request
  does not settle it. When told to use an older version, it uses that and offers the newest as an
  alternative.
- `hr-benchmarking` supports fast component feedback through real production entry points, comparing
  each piece with its immediate predecessor. Integration milestones compare the integrated workload
  with its predecessor and original baseline and check caller costs; isolated gains do not establish
  application gains. Metric selection follows the question, with memory, storage I/O and cache-state
  limits made explicit.
- `hr-benchmarking` adds JavaScript performance hunt guidance: count repeated work, check growth and
  resource lifetimes, and compare synchronous work with async I/O, yielding and workers. It covers
  queueing and transfer costs, runtime-specific measurements, and responsiveness versus total CPU
  cost.
- `hr-benchmarking` adds local profile viewing with speedscope, native/JavaScript CPU attribution,
  the `perf report --no-inline` workaround, heaptrack overhead and off-CPU tracing limits. Its oha
  guidance names `--latency-correction` and the required `-q` rate limit.
- The `hr-code-review` panel recommendations gain an entry for Muse Wonder Full 1.0 on the Bug Hunt
  board: two runs each at xhigh (41.5 of 105) and max (42.0). It has no published price and is
  reachable only through a Muse Code subscription plan. The existing Opus 5.5 and Sonnet 5.5 entries
  were checked against the same board data again and their figures are unchanged.

## 0.12.0 - 2026-10-14

- **Breaking for configs that list it:** the `swarmail` modifier is removed. It only told an agent
  where to find the instructions of one agent-mail product, so it was not general guidance. A
  `house-rules.json` that still lists `swarmail` under `modifiers` now fails. `compose.mjs`, the
  installer, `config status`, `config catalog`, `config preview`, `config set` for any other change
  and `setup --json` stop with `unknown modifier "swarmail"` and write nothing. The existing
  `rules.md` and `composed-skills` stay as they were. To repair the config, run `config set` with
  `--disable-modifier swarmail`, review the preview, then repeat it with
  `--apply --expect <revision>`. The interactive `house-rules setup` screen lists `swarmail` as an
  unavailable modifier and removes it when toggled.
- **Breaking for configs that list it:** the `hr-change-impact` skill is removed; `hr-code-review`
  covers its method. A config that lists `hr-change-impact` in `skills.include` now fails
  composition with "unknown shipped skill". Replace it with `hr-code-review`.
- Upgrade note: text that only matters with several parallel sessions or coded offers (numbered
  questions with options like 1A, 1B) left the core rules. The cross-session relay paragraph and the
  notice after an authorized push that changes guidance or tooling were always on in 0.11.0. They
  are now in the opt-in `cross-session-relay` modifier (it declares `hr-agent-guidance-refresh`);
  enable it if you want them back. The sentence about offer IDs and `go`/`continue` is in
  `coded-offers`. The `shared-host-load` modifier keeps its name and position, so existing configs
  still resolve, but its exclusive-slot and reservation text is gone.
- New skills:
  - `hr-sqlite` is a checklist for code that opens, configures, queries or copies a SQLite
    database, and for "database is locked", slow queries and WAL growth. Each item says whether it
    was measured, comes from the SQLite documentation or is suspected or reported by one source. A
    read-only script (`scripts/inspect-sqlite.py`) reports a file's journal mode, statistics, FTS
    tables, WAL size and mount options, and with `--source` scans source text for each
    `journal_mode` mention with no earlier `busy_timeout` in the same file; it does not establish
    run order. One item covers running reads on a worker connection with a synchronous driver.
  - `hr-usage-report` measures where Claude Code, Codex and OpenCode usage went by provider, model
    and role at list prices, and renders model comparisons as self-contained HTML charts and
    verdict tables (it runs with Bun). For Claude Code it keeps the transcript line with the most
    output tokens for each streamed response and reads `projects` under `~/.claude` and every other
    `~/.claude_*` or `~/.claude-*` directory, a linked directory once; `--claude-projects <dir,dir>`
    replaces the list.
  - `hr-forgotten-work-audit` audits a project's past sessions, plans, handoffs and pull requests
    for work that was asked for, promised or deferred and then dropped from every live list. It
    reads the history and writes only what is named here: workers write their own result file, the
    coordinator writes the consolidated report and a last-audit record at
    `audits/<project>/last-audit.json` in the notes directory, and the step that turns results
    into decisions may add owed items to a plan the session owns.
    It gives five verdicts (done, tracked, dropped, forgotten, unclear) and a coverage row per
    slice of history. The `hr-what-next` open-work check warns when a plan with a
    `Project: <name>` line has no such record, an unreadable one, or one older than 30 days (a
    default, not a measured interval).
  - `hr-research-shared-links`: when a session opens with a shared link, or the user asks what to
    borrow from one, the agent follows it to its primary source, checks the claims and searches
    the user's own rules and past decisions. It rates each idea adopt, consider or skip with
    evidence on both sides and records the terms it searched. It selects on link-and-ideas
    requests, not on requests to implement what an article describes.
- New optional rules:
  - `backlog-visual` adds a dark panel of every open item, grouped by what it waits on, to a
    backlog report, with the same groups as a Markdown outline where the host cannot render the
    panel; `backlog-outline` adds the outline alone. With neither, a backlog report is the ranked
    table. They cannot be enabled together, and `hr-house-rules-setup` asks which to use.
  - `model-default-questions` (setup preset `--questions default`) gives no instruction about how to
    ask questions, so the model and host ask their usual way. Without it, the core rules say text
    only. Setup asks at install, in plain words (Model default, Text only, Clickable choices when
    available), with a separate yes/no for short reply codes under Text only. It keeps the other
    offer rules (recommendation first, what each option changes) and cannot be combined with
    `coded-offers` or `question-cards`.
  - `periodic-updates`: a job expected to run longer than about 10 minutes (or one that has run
    that long with no estimate) posts a one-line status update every 5 minutes unless the user
    names another interval (a default, not a measured value). Each update gives completed/total or
    a percent, the ETA with its basis or "unmeasured", and findings so far, and is posted even when
    nothing changed. A milestone, failure, stall or forecast change goes in full. Where the host
    has a background watcher or timer the agent arms it, and a watcher event that changes nothing
    gets at most one line.
  - `upstream-contributions`: a measured optimization, fix or defect found in a third-party project
    is offered for submission to that project once the evidence is complete, through the channel
    its contribution guide names (comment, issue, discussion or pull request). The user sees the
    exact text once before it is posted, unless they waived that for a named kind of submission and
    set of projects.
  - `cross-session-relay` (see the upgrade note above).
- `hr-what-next` sorts every open item by what it waits on (actionable now, needs your decision,
  waiting on others with a trigger and owner) and does not recommend a waiting item before its
  trigger fires. Invoking it asks for the backlog: undecided items are offered, or walked through in
  groups when three or more questions are open, and each answer is recorded as yes, no (dropped) or
  defer with a trigger. Its new open-work check (`scripts/check-open-work.mjs`) reads the
  `## Ledger` section of a plan. It lists open and deferred items, scratch directories and
  checkouts the session owns that no item names, items whose pull requests or issues are all
  merged or closed, past or due `recheck: YYYY-MM-DD` dates, and waiting items with no date. It
  also lists follow-ups written as prose outside the ledger, answered offers that omit what
  happened to the other options, and `unanswered offers: N` (a warning at three). It warns when a
  plan has no `Purpose:` line. `--archive` moves a plan to the archive only when it is completed
  and nothing is open. `--app-managed <path>` reports a checkout an app retires as a warning, not
  a finding.
- Core rules:
  - They are about 5% smaller by size when composed with every optional rule off (26,324 to 24,912
    bytes against 0.11.0, measured with `--out`), in more direct wording. The cross-session relay
    text and the offer-ID sentence moved out (see the upgrade note), and the entries below add
    requirements.
  - Before a close-out (ending the session), pause or end of work, the agent gives closure: what was
    done, the overall findings with their key numbers, what was learned and what remains. It adds a
    visual of the findings when the work produced measurements, comparisons or decisions and the
    host can render one.
  - Session purpose: the session states its purpose in one sentence. Anything else it finds is
    parked (noted, not investigated) as one deferred line in the ledger, the list of open items kept
    in the session's plan or another durable list. The agent mentions it once after the answer and
    keeps it out of offers until the user asks for the backlog or the purpose is finished. The
    `plan-files` rule adds a `Purpose:` header line.
  - Offers recommend the option that finishes the work properly and holds up over time, not the
    quickest one. Dependent steps are separate options labeled "(Recommended, phase 1)" and
    "(Recommended, phase 2)", and a required step is never an optional alternative. An option that
    produces a change names what it changes and the steps it includes; one that creates a rule,
    skill, document or script also names the owning repository and what was searched. With three or
    more offers open and unanswered, a new decision is queued in an `hr-what-next` walk-through (the
    open questions asked a few at a time). With `coded-offers`, each option is a list item of a line
    or two, nothing may follow the acceptance line, and an offer visual is made only when the user
    asks and the host can render one.
  - Finishing work and the ledger: before asking the user to do something, the agent checks the
    actual state and does what it can itself. A no is dropped, as are options the user passes over;
    only work the user wants done later is deferred. A session that has finished and landed its own
    work ends with a close-out question that recommends `All done`. Work filed upstream or handed
    to another owner closes as moved, with the owner and link, unless the session still owes a step
    or waits on its result. The `plan-files` rule adds that
    rebuilding a ledger from an earlier plan carries every open or deferred line over;
    `hr-handoff`'s reconciliation checker rejects an open line carried only as context, and an item
    that absorbs several open lines without saying why.
  - Reporting explains why the answer must come after the last tool call (some hosts hide earlier
    text behind a collapsed summary line). It says to finish bookkeeping first and to repeat the
    whole answer if a tool call must follow, and it points to the host clock (`date +%Z`) as a
    source for the user's local timezone. The always-on Writing rule asks for plain language in
    every reply, naming a thing by what it is, not by a label the agent coined (`hr-plain-prose` has
    the procedure).
  - The `multi-agent` modifier treats each review finding as a claim. A reproduced failure or a
    cited requirement confirms it and it gets fixed; otherwise the agent answers with the reason.
    A reviewer's remedy is a suggestion.
  - Issue, discussion and comment visuals (`references/thread-visuals.md`) are added only where
    they show a spatial interface state, a before/after comparison, a trend across measurements or
    a branching flow. The exact facts stay in text beside the visual, with alt text, and the
    capture is checked for private paths and credentials. Attach with `gh ... --attach` where your
    `gh` version supports it; otherwise use a browser signed in to the user's GitHub account. The
    bug-reporting reference says to submit a YAML issue form through that form in the browser.
  - Landing and review. The agent also leaves alone a checkout that another session or job uses, or
    whose use it cannot tell (0.11.0 covered only another session's checkout). When it may update a
    default branch checked out elsewhere (it knows no session or job uses that checkout, as in
    0.11.0), it now runs `git merge --ff-only` with the fetched head instead of
    `git pull --ff-only`, which another process's fetch can make fail. The `squash-landing` modifier
    lets an enabled automatic review begin instead of requesting one, and merges only after an
    existing review check reports completion. The `low-quota-handoff` modifier says five-hour limits
    do not trigger a handoff and a usage reading must never cost model turns or read credentials.
  - `no-attribution` and `hr-writing-pr` give agent or model disclosure exactly as a repository's
    contribution guidelines ask, where they ask for it, and nothing else.
  - Composing rules inline (without `--out`) no longer drops three core rules. Sections that point
    to a reference (Landing and Reporting among them) are replaced by the reference text in that
    mode, and in 0.11.0 the Landing and Reporting references lacked the leave-alone-a-checkout rule,
    the five-items-per-list line and the benefit-column paragraph. They now carry them.
  - Wording written for one setup, or that read as jargon, was rewritten for any user with the
    requirements unchanged except where noted above ("decision" for "disposition"; the
    `## Ledger` section and `trigger:` markers that scripts read are unchanged), and the core rules
    no longer name one host's version or command. The `hr-read-reddit` description now states that
    Reddit's RSS support ends November 13, 2026 and that output can omit comments.
- Release procedure: before the first publish step of any version bump (tag, package publish,
  GitHub release or announcement), two audits run and their corrections land first. The changelog
  audit covers every repository: each pending entry is checked against the code that will ship,
  iterations of one concern merge, and entries a user must act on stay whole. The factual accuracy
  audit covers every public repository: READMEs, graphics with their alt text, listing text,
  documentation, release notes and the announcement are checked for old versions and figures.
  `rules/references/release-batching.md` holds both, and the `release-batching` modifier points to
  it.
- Setup and installer:
  - `install.sh` stops on an unknown option instead of running a full install, says what to check
    when the repository cannot be downloaded, and no longer names a partial skills directory that
    does not exist. A re-run whose composed skills match the installed ones says "The skills are
    unchanged" and keeps no extra `composed-skills.previous-<date>` directory. Status lines use `~`
    like the closing text. `install.ps1` gets the same changes except the unknown-option check,
    which only `install.sh` has.
  - An invalid or empty config names the file in the error, and an unknown modifier says to remove
    it from `modifiers` (`config set --disable-modifier <name>` for a stored one). The compose
    summary reads "composed N lines of rules from N optional or personal rule file(s)".
  - Setup is easier on a first run. Skill descriptions no longer start with a stray quote, and a
    fresh configuration lists every optional rule on the first screen instead of "No matches"
    (likewise skills). In the interactive `setup`, enabling a rule that expects a skill (for
    example `cross-session-relay` and `hr-agent-guidance-refresh`) also selects that skill, so the
    warning no longer repeats. After `save`, setup prints the one command that applies the
    selection: the installer again for a checkout (naming `HOUSE_RULES_DIR` or
    `HOUSE_RULES_CONFIG_DIR` when not the defaults), or `house-rules --config` for the npm package.
- `hr-code-review` covers what a change can break beyond its diff. It adds an Impact section
  (`references/impact.md`) when asked or when a diff touches stored shapes, outside readers,
  timing, configuration or pinned dependency behavior. `references/reviewer-role.md` is a
  host-neutral brief for a standing reviewer or a read-only review sub-agent (`PASS` or
  `BLOCK: N`, findings by severity, verification limits reported separately).
  - It can also set up, plan and adjudicate a review panel (several independent model reviewers; a
    seat is one reviewer). `references/panel-setup.md` asks only
    open questions and saves portable preferences after confirmation, stored in the config's
    `panel` object (`config set --panel-file`).
  - `scripts/panel-plan.mjs` resolves preferences and a bindings file (which gives each model alias
    in your preferences its launch settings and, optionally, its model family and whether it is
    pay-per-use) into the seats a panel would run before any model is called. Project and task
    layers can only tighten the user's policy, and `meteredRoutes: included-only` rejects a
    pay-per-use route.
  - `scripts/acp-panel-client.mjs` is an Agent Client Protocol (ACP) client over stdio for panel
    seats (`references/acp-client.md`). `references/panel-adjudication.md` says which claims count
    as corroborated, and `scripts/check-receipts.mjs` checks the `path:line` citations in a panel's
    logs.
  - A small dated catalog (`references/panel-recommendations.json`) records what was measured and
    writes `unknown` for anything not recorded.
- `hr-handoff` covers what the host binds to the thread being handed off. Scheduled tasks, linked
  pull requests and watches, and any agent-mail or messaging registration are each moved or
  recorded as staying. The skill names the receiver's exact call where only the receiver can bind
  an item, and reads each move back (for a handoff that is not a low-quota stop).
- `hr-benchmarking` adds three method points: attribute time to a suspected component in the real
  workload and time the change inside that workload, run an A/A arm (the same variant twice) when
  the workload's variation is unknown, and check agent or model comparisons for a ceiling.
  Procedures for one machine (taking a benchmark lock and fencing CPU cores for a run) left the
  skill, and `references/priority-findings-20261006.md` is deleted. The JavaScript reference lists
  verified findings on running under Bun versus Node and now covers server code. It says to measure
  the longest event-loop stall next to wall time, time the real function, count events and bytes
  when volume is the cost, prove moved work with a test that holds the main connection busy, and
  treat another researcher's numbers as leads.
- `hr-agent-guidance-refresh` is trimmed to what holds on any host: it rereads changed instructions,
  skills, subagent definitions, configuration and the tools it relies on, holds the update while an
  evaluation fixes its context, and treats a reread as no proof that injected context changed. Its
  name and path are unchanged. `shared-host-load` follows the host's
  declared budgets and checks load before resource-intensive work.
- `hr-pr-followup` ships three landing helpers under `scripts/`. `merge-pr.sh` (needs Bun)
  squash-merges a pull request and deletes only its remote head. `verify-landed.sh` checks that the
  default branch contains the commit and fast-forwards a clean default checkout. `check-landing.py`
  reports by content whether a checkout's work landed and lists processes still using it. A
  repository that lands by fast-forward push is named in the `HR_PUSH_LANDED` environment variable.
- `hr-writing-pr` leads with the measured benefit. The first sentence gives the figure and
  workload (for a bug, who hit it and what now works), and a qualified result gets a headline
  chart from `scripts/benefit-chart.py`. The script needs matplotlib, draws a dark PNG and prints
  alt text, and `--table` prints the same values as a Markdown table. A change too big to read in
  file order gets a numbered reading order.
- `hr-diagnosing-bugs` requires every issue to offer or link the pull request
  (`scripts/check-pr-offer.mjs` fails a draft that does neither). `hr-better-accessibility` asks
  for a unique `id` on each inline SVG `<title>` and `<desc>`, with a `<desc>` that says what the
  figure shows.
- Smaller skill changes: `hr-agent-guidance-audit` has a verdict method for deciding which skills,
  docs and scripts to retire or merge and `references/prune-workflow.md` for shrinking always-loaded
  guidance. `hr-maintainability-review` also handles whole-repository over-engineering audits.
  `hr-design-exploration` has a single-component mode (three variants on one design axis).
  `hr-lean-plan` leaves out steps added only in case something goes wrong.
- Repository only (not in the npm package): the end-of-reply eval was extended to screen
  other agents and the optional rules, and `evals/skill-fires/` is new; see their READMEs.

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
