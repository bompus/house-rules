# Changelog

Notable changes to house-rules. Versions follow [semantic versioning](https://semver.org).

## Unreleased

- New `evals/skill-fires/`: ten `claude plugin eval` cases that check whether `hr-audit-choices`,
  `hr-code-review`, `hr-diagnosing-bugs`, `hr-explain-code`, `hr-extract-shared-steps`, `hr-plain-prose`
  and `hr-test-audit` fire on realistic requests, and that the replies meet each skill's contract.
  `prepare.mjs` builds the throwaway plugin directory the runner needs. One case was run end to end
  (the skill fired and the reply passed); no results ship with the cases.
- Composing rules inline (without `--out`) no longer drops four core rules. Landing and Reporting
  are replaced by their reference text in that mode, and the references lacked the leave-alone-a-checkout-
  another-session-uses rule, the version-bump audit paragraph, the five-items-per-list line and the
  benefit-column paragraph. The references now carry them, and a test fails when a core section's
  short text has a paragraph its reference lacks. Core no longer repeats "never bypass required
  checks" in Landing.
- New optional rule `model-default-questions` and preset `--questions default`: house-rules gives
  no instruction about how to ask questions, so the model and host ask their usual way. Without it,
  core rules still say text only. Setup now asks the question at install in plain words (Model
  default, Text only, Clickable choices when available), with a separate yes/no for short reply
  codes under Text only, and the interactive screen calls modifiers "optional rules". The
  modifier keeps the rest of Offers (recommendation, scope of each option, phases, the three-open-offer
  limit) and cannot combine with `coded-offers` or `question-cards`.
- `hr-usage-report` no longer undercounts Claude Code responses. A response is written once per
  streamed block, and the report kept the first line, which has a few output tokens and no advisor
  call. It now keeps the line with the most output tokens and the advisor calls from whichever line
  has them. On eight days of one machine's transcripts that adds 2.3M output tokens (6.5%) and 6
  of 23 advisor calls.
- `hr-usage-report` counts Claude Code sessions run with a separate `CLAUDE_CONFIG_DIR`. It reads
  `projects` under `~/.claude` and every other `~/.claude_*` or `~/.claude-*` directory, a linked
  directory once; `--claude-projects <dir,dir>` replaces the list.
- `hr-benchmarking` adds three method points. Attribute time to a suspected component in the real
  workload before changing it, and time the change inside that workload, because a standalone gain
  can vanish there. Include an A/A arm, which runs the same variant twice in the alternation, when the
  workload's variation is not already known from equivalent earlier runs, so the comparison's noise
  floor is measured. Check each case in an agent or model comparison for a ceiling, report cases every arm
  already passes apart from the rest, and report any metric they do not saturate on its own.
- New skill `hr-sqlite`: a checklist for code that opens, configures, queries or copies a SQLite
  database, and for "database is locked", slow queries and WAL growth. Each item says whether it
  was measured, comes from the SQLite documentation or is unconfirmed. References hold the
  measured evidence and the engine and driver decisions with what would reopen them. A read-only
  script (`scripts/inspect-sqlite.py`) reports a file's journal mode, statistics, FTS tables, WAL
  size and mount options. With `--source` it scans source text for each `journal_mode` mention with no earlier
  `busy_timeout` in the same file; it does not establish run order.
- Before the first publish step of any version bump (tag, package publish, GitHub release or
  announcement), the release procedure runs two audits and lands their corrections first. The
  changelog audit covers every repository, public or private. Each pending entry is checked against
  the code that will ship and kept plain and brief. Entries that iterate on one concern merge into
  one, and entries a user must act on stay whole. The public-materials audit covers every public
  repository. READMEs, graphics and visuals with their alt text, registry and marketplace listing
  text, documentation, release notes and the announcement are checked for old versions and figures.
  `rules/references/release-batching.md` holds both audits. The `release-batching` modifier,
  `AGENTS.md`, `docs/npm-release.md` and one line in `rules/core.md` point to it. An urgent release
  may limit only the materials review.
- `hr-what-next`'s open-work check (`scripts/check-open-work.mjs`) reads the item lines of a plan's
  `## Ledger` section and reports what is still open. It lists open and deferred items, and the
  scratch directories and checkouts the session owns that no open item names. `--archive` moves a
  plan to the archive only when its status is completed and nothing is open. `--app-managed <path>`
  reports a checkout an app retires as a warning, not a finding. It also lists items whose named
  pull requests or issues are all merged or closed (skipped without `gh` or with `--offline`). It
  lists `recheck: YYYY-MM-DD` dates that are past or within a week, and waiting items that have no
  date. It lists follow-ups written as prose outside the ledger and answered offers that do not say
  what happened to the other options. It lists deferred items whose only trigger is the user's own
  selection as "awaiting your yes/no" (`awaitingUser` in `--json`). It warns when a plan has no
  `Purpose:` line. Output gains `unanswered offers: N`, a row for each and an `unansweredOffers`
  list in `--json`, and warns at three without changing the exit code. An offer is one ID (capitals
  and digits joined by hyphens, such as `ABC-12`) written right after the word "offer" on an open
  `- [ ]` line. It stops counting when any line naming it is dropped, says it was selected, chosen,
  picked or answered, or says what happened to the other options. An ID after "by", "into" or "with"
  is a replacement and is not closed by that line. A pending offer ("awaiting user reply") stays
  unanswered. Deferred and done lines are never counted, and plans that number offers without an ID
  are not counted.
- **Breaking for configs that list it:** the `swarmail` modifier is removed. It only told an agent
  where to find one coordination product's own instructions, so it was not general guidance. A
  `house-rules.json` that still lists `swarmail` under `modifiers` now fails. `compose.mjs`, the
  installer, `config status`, `config catalog`, `config preview`, `config set` for any other change
  and `setup --json` stop with `unknown modifier "swarmail"` and write nothing. The existing
  `rules.md` and `composed-skills` stay as they were. To repair the config, run `config set` with
  `--disable-modifier swarmail`, review the preview, then repeat it with
  `--apply --expect <revision>`. The interactive `house-rules setup` screen lists `swarmail` as an
  unavailable modifier and removes it when toggled. The README row, the setup skill's offer of it
  and the configuration guide's example are gone.
- `rules/core.md` § Landing says to leave alone a checkout another session or job uses, or whose use
  you cannot tell. An agent that does not open the linked procedure still gets the running-job and
  unknown-use cases. The landing procedure updates a default branch checked out in another worktree
  with `git merge --ff-only` to the fetched, verified remote head instead of `git pull --ff-only`. A
  concurrent fetch in a shared repository can rewrite `FETCH_HEAD` and make the pull fail. The
  squash-landing reference says to let an enabled automatic review begin instead of commenting to
  request one. When none starts, check the integration's status rather than tagging the bot again. A
  config file in the repository does not show the bot is enabled. An existing check on the head must
  report completion before merging; for CodeRabbit that is a successful status whose description
  starts with "Review completed". The `low-quota-handoff` modifier says five-hour limits do not
  trigger a handoff and a usage reading must never cost model turns or read credentials.
- Wording written for one setup, or that read as jargon, was rewritten for any user. Each rule's
  meaning is unchanged. The core rules, `coded-offers`, `plan-files` and five skills say "decision"
  and "what was decided about each" where they said "disposition". The `## Ledger` section and
  `trigger:` markers that scripts read are unchanged. The core rules no longer name one host's
  version, command or notification term, or point at a modifier a fresh install lacks. `plan-files`
  and `upstream-contributions` declare the skills they name, so composing warns when one is missing.
  `hr-what-next` and `hr-handoff` name no host tools. The README and the end-of-reply eval README
  cite one 2026-10-11 replay with its limits and the revision it ran at, and the overview image
  carries no eval figures. `hr-read-reddit` states that Reddit's RSS support ends November 13, 2026.
  Long guidance paragraphs are split at sentence boundaries, and eight skill descriptions are
  shorter with their triggers kept. `docs/npm-release.md` stays out of the npm package.
- Offers (`rules/core.md` § Offers, and the `coded-offers` modifier, which replaces that section)
  recommend the option that finishes the work properly and holds up over time, not the quickest one.
  Dependent steps are separate options labeled "(Recommended, phase 1)" and "(Recommended, phase
  2)". A required step is never an optional alternative, and an alternative that drops required work
  is marked "(Not Recommended)". An option that produces a change names what it changes, the steps
  it includes (such as pull request, review, landing and cleanup) and what it leaves for a later
  offer. An option that creates a rule, skill, document or script also names the owning repository,
  whether any project could use it unchanged, and what was searched. With `coded-offers`, the
  acceptance line keeps its exact form with nothing after it, and `go` covers phase 1 only. Each
  option is a list item of a line or two, so consecutive options cannot run together into one
  paragraph. The acceptance line follows the list as a plain paragraph, and a parked-item note or
  any other closing line the rules ask for goes before the offer. An offer visual (a rendered page
  beside the complete text offer) is made only when the user asks and the host can render one. When
  three or more offers are open and unanswered, a new decision is queued in a `hr-what-next`
  walk-through instead of presented as another offer.
- `hr-benchmarking` keeps the portable method. It covers defining and confirming the comparison,
  isolation and normal scheduling with the effective priority recorded. It also covers screening,
  repetition against a variation criterion, saved evidence, memory measurement and reporting with
  the 3% band. One short paragraph says to reject a run on competing load, swapping or an
  out-of-memory event, using criteria set before the run. The admission, pressure, observer and
  fenced-core procedures, the benchmark lock and the nice-value experiment record described one
  machine's setup. They now live with the host that uses them, and
  `references/priority-findings-20261006.md` is deleted. For three or more variants, a short table
  picks the chart from the question (dot plot of every run, grouped bars, sorted bars, per-resource
  bars or a line chart). The skill also names the axis, zero-baseline and no-clear-change labelling
  to apply. A pull request's headline chart still comes from `hr-writing-pr`.
- `hr-agent-guidance-refresh` and `shared-host-load` are trimmed to what holds on any host. The
  skill rereads changed instructions, skills, subagent definitions, configuration and the tools it
  relies on. It holds the update while an evaluation fixes its context, and treats a reread as no
  proof that injected context or tool discovery changed. Its deployed-versus-source and
  pending-notice steps moved out, and its name, path and `references/verification.md` are unchanged.
  The modifier follows the host's declared budgets and checks load before resource-intensive work.
  Without a budget it gets operator direction before parallel workers or whole-repository commands.
  It constrains memory-hungry work and checks pressure evidence before a larger retry. Its name and
  position are unchanged, so existing configurations still resolve, but its exclusive-slot,
  reservation and light-work-allowance text is gone.
- Text that only makes sense with parallel sessions or coded offers left the core rules. The
  cross-session relay paragraph and the notice after an authorized push that changes guidance or
  tooling are in the opt-in `cross-session-relay` modifier, which declares
  `hr-agent-guidance-refresh`. Anyone with `multi-agent` enabled who wants those two paragraphs
  enables `cross-session-relay` as well. The sentence about offer IDs and `go`/`continue` is in
  `coded-offers`. The core rules declare the skills they name, and composing warns when one is
  missing from the composed set. A test checks that the declared list matches the skills the core
  text names and that all of them are in the fresh-install set. Another test caps the fresh
  install's composed rules (`FRESH_INSTALL_CEILING_BYTES` in `test/compose.test.mjs`), so growth in
  what every new session loads needs a reason stated in the change that raises the cap. The fresh
  install enables no modifier.
- New skill `hr-forgotten-work-audit` is a read-only audit of a project's past sessions, plans,
  handoffs and pull requests. It looks for work that was asked for, promised or deferred and then
  dropped from every live list. It gives a brief template for each slice of the history and five
  verdicts (done, tracked, dropped, forgotten, unclear). It also gives a result format with a
  coverage row per slice and a last-audit record at `audits/<project>/last-audit.json` in the notes
  directory. The open-work check warns when a plan with a `Project: <name>` line has no such record,
  an unreadable one, or one older than 30 days. Thirty days is a default, not a measured interval. A
  shorter one needs evidence that it surfaces more lost work.
- Two new opt-in modifiers cover messages during long jobs. With `periodic-updates`, a job expected
  to run longer than about 10 minutes (or one that has run that long with no estimate) posts a
  status update on its own schedule. The interval is 5 minutes unless the user names another; that
  is a default, not a measured value. Each update is one line with completed/total or a percent, the
  ETA with its basis or "unmeasured", and findings so far, posted even when nothing changed. A
  milestone, failure, stall or forecast change goes in full. Where the host has a background watcher
  or timer the agent arms it, and otherwise it posts at the first natural checkpoint after each
  interval. With `quiet-watchers`, a watcher event or timer that changes nothing gets at most one
  line. A milestone, failure, stall, forecast change or the run's completion gets a full report, and
  a watcher is armed to emit only those. The two fit together, and `quiet-watchers` supplies the
  brevity of routine ticks. Both were tried in small single-model trials with scenarios written by
  the rules' author, which show a direction, not a rate. The results are in PRs #269 and #270.
- New skill `hr-research-shared-links`. When a session opens with a shared link, or the user asks
  what to borrow from one, the agent follows it to its primary source and reads past the README. It
  checks the claims and searches the user's own rules and past decisions. It rates each idea adopt,
  consider or skip with evidence on both sides, and routes what is worth keeping. It also searches
  the repository's open issues and security disclosures for the shared claim and each idea it may
  recommend. It checks every hit against the current code, reads the latest release notes and
  records the terms it searched. Its description selects on link-and-ideas requests, not on requests
  to implement what an article describes.
- `hr-code-review` can set up, plan and adjudicate a review panel, and its description covers those
  requests so the procedure loads for them. Setup (`references/panel-setup.md`) lists routes through
  the host's read-only interface and asks only open questions. It previews the portable preferences
  and saves them only after confirmation, with no model calls. A small dated recommendation catalog
  (`references/panel-recommendations.json`) records model, effort, harness, route, source, checked
  date, run count, metric, list cost, wall time and limits, and writes `unknown` for anything not
  recorded. It has no `quick` or `deep` entry because no recorded evidence tests those shapes.
  `scripts/panel-plan.mjs` resolves stored preferences and a user-owned bindings file into the seats
  a panel would run, with skipped candidates and named blockers, before any model is called. Project
  and task layers can only tighten the user's policy. `meteredRoutes: included-only` rejects a
  metered route and wins when layers combine. An alias with no binding is reported as unbound, and
  project preferences count only when approved by file revision. After a panel answers,
  `references/panel-adjudication.md` explains how to read the replies and which claims count as
  corroborated. It also covers comparing competing implementations, breaking a tie and the receipt
  header every panel report opens with. `scripts/check-receipts.mjs` checks the `path:line`
  citations in the panel's logs against the repository. A citation that names an identifier must
  show it on the cited lines, and a file named by basename must resolve to exactly one file.
- The reporting rule says the answer must come after the last tool call, because some hosts fold
  every message of a finished turn except the last behind a summary row. Finish bookkeeping first,
  repeat the whole answer if a tool call must follow it, and never end on a short closing line after
  a tool call. The rule also names the host clock zone (`date +%Z`, or `Get-TimeZone` on Windows) as
  part of the session environment. Check it before reporting UTC or saying the zone is unknown.
- The core rules have a Visuals in issues, discussions and comments section that points to
  `references/thread-visuals.md`. Add an image, chart or diagram only where it shows a spatial
  interface state, a before/after comparison, a trend across measurements or a branching flow. Keep
  the exact facts in text beside it with alt text, and check the capture for private paths and
  credentials. Attach it with `gh ... --attach` (`gh issue create`, `edit`, `comment` and
  `gh pr comment`). Where `gh` has no attach route (`gh discussion`) or refuses the upload, try a
  browser signed in to the user's GitHub account and its upload field. Hand the user the text and
  the file only when the host has no such browser or the upload fails there. The bug-reporting
  reference says to submit a YAML issue form through the form in that browser, and to use
  `gh issue create` only for repositories with no issue form. The visuals reference says how to
  attach an image in a browser form and to replace the default alt text.
- `hr-better-accessibility` asks for an `id` on each inline SVG `<title>` and `<desc>` that is
  unique on the page, and for a `<desc>` that says what the figure shows rather than how it is
  drawn. Two SVGs on one page that both use `id="title"` otherwise both resolve to the first one.
- `hr-writing-pr` opens a pull request, issue or discussion that reports a measured result with the
  benefit. The first sentence gives the figure and workload (or, for a bug, who hit it and what now
  works). The title uses the words of the person who feels the change. A qualified result outside
  the reporting band also gets a headline chart from `scripts/benefit-chart.py`. The script draws a
  dark PNG and prints alt text. With `--table` it prints the same values as a Markdown table,
  because every value in a visual must also appear as body text. A measured speedup stays out of a
  squash-merged pull request title unless the repository's convention asks for it. A change too big
  to read in file order gets a numbered reading order with the mechanical files last and a line on
  what was checked in them. A "Decisions for you" list appears only when the reviewer has a call
  tests cannot make. A "Not covered" line names adjacent work left out on purpose. A stacked pull
  request opens with its parent, describes only its own layer and names other layers by number. The
  evidence line names the head commit the checks ran against.
- The end-of-reply eval (`evals/end-of-reply/`) reads an offer's options in any rendering (coded,
  numbered or bulleted, bare or as list items, with a numbered question above them). It checks a
  scenario's declared `options` by label. It ignores a prose bullet list between an offer's options and its reply line.
  It reads a coded `Question N` line that has explanation before its options or no question mark. It
  does not take "the session can be closed" inside an option as a claim that the work is done. An
  offer scenario fails only on the tool call named in `forbiddenCall`. A read-only check (`read`,
  `git status`, `ls`) or a write to the durable ledger or task list before an offer is not acting.
  An offer with a `Recommended: reply …` or `Recommended combination: reply …` acceptance line
  fails when two or more bare coded option lines share a paragraph. It also fails when anything
  follows that line or shares it. The result lists these in `layout`. `parked-not-in-menu` and `spin-off-batch` read the offer with the shared parser
  (`minOptions`, `forbiddenInOffer`). Each run reports whether the turn was right apart from the scenario's
  declared checks, and `--baseline` prints a `behavior only` line. The `parked-finding`,
  `parked-not-in-menu`, `spin-off-batch`, `stacked-offers` and `passed-over-options` scenarios cover
  the parked-work, stacked-offer and passed-over-option rules, with `forbiddenPattern` and
  `requiredPattern` scenario fields.
- Finishing work and the ledger (`rules/core.md` § Finishing work, `plan-files`, `coded-offers`).
  Before asking the user to do something, the agent checks the actual state and does what it can do
  itself. It asks only for what the check shows it cannot do, says what it checked, and does not
  assume whether the user is present. A no is decided and dropped, even when the user names what
  would make them reconsider. Only work the user wants done later is deferred. Options the user
  passes over are dropped as "not selected" in that step. Ideas the agent generated stay in the
  report unless the user asked for them or the agent owes the work. The session-completion gate
  counts only items someone owes work or a decision on. A reply such as `go` that accepts a deferral
  the session recommended is recorded as deferred on recommendation with `trigger: user decides`. An
  offer never recommends deferring, pausing or closing while the session purpose has a ready next
  step. Routine offers word the no-option "decline or defer", and `All done` drops every listed
  candidate unless the user asks for some to be done later. A session that has finished and landed
  its own work ends with a close-out question that recommends `All done`, or `Pause` keeping only an
  item the user asked to be done later. Work filed upstream or handed to another owner is closed as
  moved, with the owner and link. It stays open if the session still owes a step or its own work
  waits on the result. A checkout an app retires is reported but does not block completion.
- Rebuilding a ledger, inventory or handoff from an earlier plan carries every open or deferred line
  over. The plan-files rule, `hr-handoff` and `hr-what-next` say so. `hr-handoff`'s reconciliation
  checker reads a predecessor `plan.md` directly, one record per `## Ledger` item line. It rejects a
  context-only reason such as "the rest, reopen only if asked" for an open or deferred line. An item
  that absorbs several of them needs a `merges` reason.
- The always-on Writing rule says to write plainly in every reply, status note and question, for a
  reader who has not seen your working notes. Name a thing by what it is or does, not by a label you
  coined, a file or section name, or a term from a tool, repository or rule set. When the user must
  find, run or check the exact name, give it with a plain-words explanation the first time in the
  conversation. Explain a coined label again before reusing it. `hr-plain-prose` has the full
  procedure.
- New opt-in `upstream-contributions` modifier. A measured optimization, fix or defect found in a
  third-party project is offered for submission to that project once the evidence is complete. The
  channel is the one its contribution guide names (comment, issue, discussion or pull request). The
  user sees the exact text once before it is posted, unless they have waived that for a named kind
  of submission and set of projects. A discussion or issue about a measured speedup names the
  headline result and its workload in the title. It does so only when the figure clears the
  `hr-benchmarking` bar, and the caveats stay in the body. A defect is titled by what the person
  sees, and the title and opening lines are updated when a later measurement moves the headline.
  `hr-writing-pr` keeps the figure out of a squash-merged pull request title and carries it in the
  opening body sentence.
- `hr-handoff` covers what the host binds to the thread being handed off. A handoff that moves work
  to another thread inventories scheduled tasks, linked pull requests and PR watches, and the
  agent-mail registration. It moves each one or records why it stays. Where the host lets only the
  receiving thread bind an item, the handoff names the receiver's exact call. Every move is read
  back, and any thread-switch checklist is listed. The outgoing registration stays until the user
  closes the old thread, and the receipt gets a row per bound item. The low-quota stop is unchanged.
- `hr-what-next` sorts every open item by what it waits on: actionable now, needs your decision, or
  waiting on others with their trigger and owner. It does not recommend a waiting item before its
  trigger fires. A deferral whose only trigger is the user's selection counts as undecided. Invoking
  the skill asks for the backlog, so those items are presented as an offer, or as a walk-through
  when three or more questions are open. Each answer is recorded as yes, no (dropped) or defer with
  a trigger other than the user's selection. A backlog visual appears whenever any item remains. The
  visual's groups are ordered so the items that can move sit last, next to the offer. It is rendered
  with the host's own preview or rendering tool where one exists. The walk-through mode is used when
  asked to go through the backlog item by item, or when three or more offers are open and
  unanswered. It shows one visual of the ranked backlog and asks one group of questions per reply
  with one combined accept line. It asks first the group whose answers unblock the others and looks
  up facts a read-only call can answer before asking. A later offer joins the queue with one line.
  Each answer is recorded before acting, and the walk-through stops when no decision remains that
  the user can make now.
- The core rules have a Session purpose section. The session states its purpose in one sentence, and
  work that serves or blocks it stays. Anything else found (here, in another repository or upstream)
  is parked as one deferred ledger line instead of being investigated. Parked items are mentioned
  once after the answer and stay out of offers until the user asks for the backlog or the purpose is
  finished. They are then offered together as separate conversations. The plan-files rule adds a
  `Purpose:` header line.
- The agent-work rule treats each review finding as a claim. Fix it when a reproduced failure or a
  cited requirement confirms it, with the smallest change that clears it, and answer an unconfirmed
  finding with the reason. A reviewer's proposed remedy counts as a suggestion.
- The `no-attribution` modifier and `hr-writing-pr` make one exception. When a repository's
  contribution guidelines or pull request template ask for agent or model disclosure, give exactly
  what they ask for, where they ask for it. When models are asked for, the disclosure names each
  model that did the work. A model in a higher published tier of the same provider that reviewed or
  advised on another's work is named first. Models those tiers do not rank follow in the order they
  worked. Unrequested credit lines stay out.
- `hr-agent-guidance-audit` has a verdict method for deciding which skills, docs and scripts to
  retire or merge. Each candidate gets one verdict with quoted evidence, the shared source and a
  local install get separate verdicts, and usage counts are supporting evidence only.
- `hr-code-review` covers what a change can break beyond its diff. It adds an Impact section, using
  the method in `references/impact.md`, when asked or when a diff touches stored shapes, outside
  readers, timing, configuration or pinned dependency behavior. `hr-change-impact` is removed; see
  the upgrade note below.
- `hr-maintainability-review` also handles whole-repository over-engineering audits. It checks for
  leftover scaffolding and tests suspect layers by imagining them deleted.
- `hr-design-exploration` has a single-component mode: three variants on one design axis, compared
  in the real page.
- `hr-lean-plan` leaves out steps added only in case something goes wrong.
- Upgrade note: a config that lists `hr-change-impact` in `skills.include` now fails composition
  with "unknown shipped skill". Replace it with `hr-code-review`.
- New `hr-usage-report` skill: measure where Claude Code, Codex and OpenCode usage went by provider,
  model and role at list prices, and render model comparisons as self-contained HTML charts and
  verdict tables.

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
