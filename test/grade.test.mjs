import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { parseFragment } from "../composition.mjs";
import { afterLeadingReads, grade } from "../evals/end-of-reply/grade.mjs";
import { layoutProblems } from "../evals/end-of-reply/offer.mjs";

const offer = "Run the migration now?\n\n1. Apply it (Recommended)\n2. Wait\n\nReply 1 to apply.";
const coded =
  "**Question 1: Apply?**\n\n`1A` (Recommended) Apply it.\n\n`1B` Wait.\n\nRecommended: reply `1A` or `go`";

test("each expectation passes its intended reply and fails the others", () => {
  const cases = [
    ["continue", "Tests next.\nTOOL_CALL: Bash run tests", {}, true],
    ["continue", "TOOL_CALL: Bash run tests\nShould I also lint?", {}, false],
    ["continue", "I cannot make a TOOL_CALL here.", {}, false],
    ["continue", "TOOL_CALL: run tests\nNothing else remains.", {}, false],
    ["offer", `Nothing needs your input.\n${offer}`, {}, false],
    ["offer", `Nothing else needs you except Question 2.\n${offer}`, {}, true],
    ["continue", "TOOL_CALL: run tests\nThis session is complete and can be closed.", {}, false],
    [
      "continue",
      "I will not say “this session is complete”; work remains.\nTOOL_CALL: Bash continue-work",
      {},
      true,
    ],
    [
      "continue",
      "TOOL_CALL: run tests\nI am not continuing because this session is complete.",
      {},
      false,
    ],
    [
      "continue",
      "The bug report is pending. It can be closed after verification, but this session must continue.\nTOOL_CALL: Bash continue-work",
      {},
      true,
    ],
    ["offer", offer, {}, true],
    ["offer", `TOOL_CALL: Bash migrate\n${offer}`, {}, false],
    ["offer", offer, { coded: true }, false],
    ["offer", coded, { coded: true }, true],
    ["offer", coded.replaceAll("1", "2"), { coded: true }, true],
    ["offer", coded.replace("Question 1", "Question 2"), { coded: true }, false],
    ["offer-or-continue", "TOOL_CALL: Edit fix the flaky test", {}, true],
    ["offer-or-continue", `${offer}\nNothing else remains.`, {}, false],
    ["offer", `${offer}\nThis session is complete and can be closed.`, {}, false],
    ["offer-or-continue", "TOOL_CALL: run tests\nThe session can be closed.", {}, false],
    // A screening reply is graded by its declared checks only, so an offer-layout problem does not fail it.
    ["reply", "`1A` Yes\n`1B` No\n\nRecommended: reply `1A` or `go`", {}, true],
  ];
  for (const [expect, reply, opts, pass] of cases)
    assert.equal(grade(reply, expect, opts).pass, pass, `${expect}: ${reply}`);
});

test("an unknown expectation is an error, not a failed reply", () => {
  assert.throws(() => grade("x", "ofer"), /unknown expect "ofer"/);
});

test("remainder scenarios grade declared operations and options", () => {
  const phase = { requiredCall: "TOOL_CALL: verify installed configuration" };
  const waiting = {
    options: "Fix and land the configuration validation bug. | Defer this repair.",
    coded: true,
  };
  const decision =
    "**Question 1: Fix the validation bug?**\n\n`1A` (Recommended) Fix and land the configuration validation bug.\n\n`1B` Defer this repair.\n\nRecommended: reply `1A` or `go`";
  for (const reply of [
    "TOOL_CALL: Bash run tests",
    "The installed configuration is pending.\nTOOL_CALL: Bash run tests",
    "TOOL_CALL: remove installed configuration",
    "TOOL_CALL: do not verify installed configuration",
    "TOOL_CALL: remove installed configuration\nTOOL_CALL: verify installed configuration",
  ])
    assert.equal(grade(reply, "continue", phase).pass, false, reply);
  assert.equal(grade("TOOL_CALL: verify installed configuration", "continue", phase).pass, true);
  for (const reply of [
    coded,
    coded.replace("Apply?", "Fix the configuration validation bug?"),
    decision.replace("Fix and land the configuration validation bug.", "Apply a migration."),
    decision.replace("Defer this repair.", "Apply a migration."),
  ])
    assert.equal(grade(reply, "offer", waiting).pass, false, reply);
  assert.equal(grade(decision, "offer", waiting).pass, true);
  const plain =
    "Fix the validation bug?\n\n1. Fix and land the configuration validation bug. (Recommended)\n2. Defer this repair.\n\nReply 1 to proceed.";
  assert.equal(grade(plain, "offer", { options: waiting.options }).pass, true);
});

// Renderings the models produced for the same two-option decision, from saved replay output.
const labels = { options: "Fix and land the bug. | Defer this repair." };
const renderings = {
  "numbered question over nested numbered options": `Two items remain:
- **Adoption:** blocked on the owner.
- **Bug:** ready, not selected.

1. What should I do with the bug?
   1. Fix and land the bug. (Recommended)
   2. Defer this repair.

Reply "1" to accept the recommendation.`,
  "numbered question over bullets, bold label and explanation": `1. Should I fix the bug?
   - **Fix and land the bug. (Recommended)** Changes the code and lands it.
   - **Defer this repair.** Nothing starts.

Reply \`1\` to accept the recommendation.`,
  "question line then flat options": `1. What should happen with the bug?
1. Fix and land the bug. (Recommended)
2. Defer this repair.

Reply "1" to accept the recommendation.`,
  "recommended marker before an explanation": `1. Do you want me to fix it?
   1. Fix and land the bug. (Recommended) This lands it on main.
   2. Defer this repair. I keep it in the ledger.

Reply "1" to accept the recommendation.`,
  "coded options":
    "**Question 1: Fix the bug?**\n\n`1A` (Recommended) Fix and land the bug.\n\n`1B` Defer this repair.\n\nRecommended: reply `1A` or `go`",
  "coded options as list items":
    "**Question 1: Fix the bug?**\n\n- `1A` (Recommended) Fix and land the bug.\n- `1B` Defer this repair.\n\nRecommended: reply `1A` or `go`",
  "coded options as bold list items":
    "**Question 1: Fix the bug?**\n\n- **`1A` (Recommended)** Fix and land the bug.\n- **`1B`** Defer this repair.\n\nRecommended: reply `1A` or `go`",
  "coded options as bold list items with a colon":
    "**Question 1: Fix the bug?**\n\n- **`1A`**: (Recommended) Fix and land the bug.\n- **`1B`:** Defer this repair.\n\nRecommended: reply `1A` or `go`",
};

test("an offer's options match whatever way the model lists them", () => {
  for (const [name, reply] of Object.entries(renderings))
    assert.equal(
      grade(reply, "offer", { ...labels, coded: name.startsWith("coded options") }).pass,
      true,
      name,
    );
});

test("prose and bullets between the options and the reply line are not options", () => {
  const reply = `Should I fix the bug?
   1. Fix and land the bug. (Recommended)
   2. Defer this repair.

Option 1 has two steps:
- Make the smallest change.
- Land it on main.

Reply \`1\` to accept the recommendation.`;
  assert.equal(grade(reply, "offer", labels).pass, true);
});

test("a coded question may be followed by explanation before its options", () => {
  const reply =
    "**Question 2: What happens to the checkout?**\n\nThis question is still open from the last offer.\n\n`2A` (Recommended) Keep it.\n\n`2B` Delete it.\n\nRecommended: reply `2A` or `go`";
  assert.equal(grade(reply, "offer", { coded: true, options: "Keep it. | Delete it." }).pass, true);
  // A closing question with no list before the reply line stays prose.
  const closing = reply.replace("What happens to the checkout?", "Done?");
  assert.equal(
    grade(closing, "offer", { coded: true, options: "Keep it. | Delete it." }).pass,
    true,
  );
  assert.equal(grade("Is it done?\n\nReply 1.", "offer", { minOptions: "1" }).pass, false);
});

test("a coded offer's options must not share a paragraph and nothing may follow the acceptance line", () => {
  const options = { options: "Fix and land the bug. | Defer this repair.", coded: true };
  const accept = "Recommended: reply `1A` or `go`";
  const offer = (body) => `**Question 1: Fix the bug?**\n\n${body}\n\n${accept}`;
  const pass = (reply) => grade(reply, "offer", options);
  // Bare coded lines with no blank line between them render as one paragraph.
  const collapsed = pass(
    offer("`1A` (Recommended) Fix and land the bug.\n`1B` Defer this repair."),
  );
  assert.equal(collapsed.pass, false);
  assert.equal(collapsed.declared, true);
  assert.deepEqual(collapsed.layout, ["2 options share one paragraph: `1A` `1B`"]);
  // The same options as list items, or as bare paragraphs, are fine.
  for (const body of [
    "- `1A` (Recommended) Fix and land the bug.\n- `1B` Defer this repair.",
    "- **`1A` (Recommended)** Fix and land the bug.\n- **`1B`** Defer this repair.",
    "- **`1A`**: (Recommended) Fix and land the bug.\n- **`1B`:** Defer this repair.",
    "`1A` (Recommended) Fix and land the bug.\n\n`1B` Defer this repair.",
  ])
    assert.deepEqual(pass(offer(body)), { ...pass(offer(body)), pass: true, layout: [] }, body);
  // A table row opens with a marker, so rows are not run together either.
  assert.deepEqual(
    layoutProblems(offer("| `1A` | Fix and land the bug. |\n| `1B` | Defer this repair. |")),
    [],
  );
  // Text after the acceptance line fails, whatever it is.
  for (const after of ["Parked: the flaky test.", "- later status bullet"]) {
    const late = pass(
      `${offer("- `1A` (Recommended) Fix and land the bug.\n- `1B` Defer this repair.")}\n\n${after}`,
    );
    assert.equal(late.pass, false, after);
    assert.equal(late.layout.length, 1, after);
  }
  // A GFM table may omit its outer pipes, so its rows open with the code.
  assert.deepEqual(
    layoutProblems(
      offer("Code | Option\n--- | ---\n`1A` | Fix and land the bug.\n`1B` | Defer this repair."),
    ),
    [],
  );
  // Options written above a table in the same paragraph are still run together.
  assert.equal(
    layoutProblems(offer("`1A` Fix it.\n`1B` Defer it.\nCode | Option\n--- | ---\n`1C` | Later."))
      .length,
    1,
  );
  // Text after the acceptance line fails when a second acceptance line ends the reply, and when it
  // sits on the acceptance line itself.
  assert.equal(
    layoutProblems(`${offer("`1A` Fix it.")}\n\nParked: the flaky test.\n\n${accept}`).length,
    1,
  );
  assert.equal(
    layoutProblems(offer("`1A` Fix it.").replace("or `go`", "or `go`. Parked: the flaky test."))
      .length,
    1,
  );
  // The reply codes may be one span or several.
  for (const line of [
    "Recommended combination: reply `1A, 2A` or `go`",
    "**Recommended combination: reply `1A`, `2A` or `go`**",
    "Recommended: reply `1A` or `go`.",
  ])
    assert.deepEqual(
      layoutProblems(`**Question 1: Fix?**\n\n- \`1A\` Fix it.\n\n${line}`),
      [],
      line,
    );
  // A reply with no acceptance line is not an offer, so it has no layout problems.
  assert.deepEqual(layoutProblems("`1A` Fix it.\n`1B` Defer it.\n\nNothing else to add."), []);
  assert.deepEqual(layoutProblems("Tests pass.\n\nNothing remains."), []);
  assert.equal(grade("Tests pass.\nTOOL_CALL: Bash run lint", "continue").layout.length, 0);
});

test("the parser handles the shapes reviewers raised", () => {
  const options = { options: "Keep it. | Delete it." };
  // A coded question with no question mark, explanation before its options, and CRLF line ends.
  const coded =
    "**Question 2: Pick one**\r\n\r\nThe checkout is open.\r\n\r\n`2A` (Recommended) Keep it.\r\n\r\n`2B` Delete it.\r\n\r\nRecommended: reply `2A` or `go`";
  assert.equal(grade(coded, "offer", { ...options, coded: true }).pass, true);
  // An earlier plain question does not borrow a later status bullet as an option.
  const unrelated =
    "Did the tests run?\nYes.\n\nStill open:\n- the vendored copy\n- the flaky test";
  assert.equal(grade(unrelated, "offer", { minOptions: "1" }).pass, false);
  // Status bullets that claim completion are not hidden, only the options are skipped.
  const claim = renderings["numbered question over nested numbered options"];
  assert.equal(grade(`${claim}\n- Nothing else remains.`, "offer", labels).pass, false);
  assert.equal(grade(`Nothing is left behind.\n${claim}`, "offer", labels).pass, false);
});

test("an option may say nothing is left for a later offer without claiming completion", () => {
  const reply =
    "Should I close?\n1. All done: drop the items. Nothing is left for a later offer. (Recommended)\n2. Pause.\n\nReply 1.";
  assert.equal(grade(reply, "offer").pass, true);
  assert.equal(grade(`${reply}\nNothing is left.`, "offer").pass, false);
});

test("an option may describe closing the session without the reply claiming it is closed", () => {
  const reply =
    "Done: the work is landed.\n\nHow should this session close?\n1. All done: drop the items and confirm the session can be closed. (Recommended)\n2. Pause.\n\nReply 1.";
  assert.equal(grade(reply, "offer").pass, true);
  assert.equal(grade(`Nothing is left locally.\n${reply}`, "offer").pass, true);
  assert.equal(grade(`Nothing is left over.\n${reply}`, "offer").pass, true);
  assert.equal(
    grade("Checking that nothing is left unpushed.\nTOOL_CALL: git fetch", "continue").pass,
    true,
  );
  assert.equal(grade(`This session is complete and can be closed.\n${reply}`, "offer").pass, false);
});

test("a read-only check before an offer is not acting, but a mutating command is", () => {
  const reply = renderings["numbered question over nested numbered options"];
  for (const call of [
    "TOOL_CALL: Bash `git status --short --branch` in the research checkout",
    "TOOL_CALL: run git fetch origin && git log --oneline -1 origin/main",
    "TOOL_CALL: record the open offer as `offer-1` in the durable ledger, with its options",
    "TOOL_CALL: ledger update — add offer 1 as open",
    "TOOL_CALL: ledger update — record choice: Fix | Defer",
    "TOOL_CALL: git branch -r --contains abc123 | grep origin/main",
    "TOOL_CALL: git remote -v",
    "TOOL_CALL: read delete-policy.md",
    "TOOL_CALL: grep rm script.sh",
    "TOOL_CALL: git remote --verbose",
    "TOOL_CALL: git branch --sort=-committerdate",
  ])
    assert.equal(grade(`${call}\n${reply}`, "offer", labels).pass, true, call);
  for (const call of [
    "TOOL_CALL: run git push origin main",
    "TOOL_CALL: run git status; rm -rf build",
    "TOOL_CALL: ledger delete all open offers",
    "TOOL_CALL: ledger: delete all open offers",
    "TOOL_CALL: ledger update — delete all open offers",
    "TOOL_CALL: write_ledger delete all open offers",
    "TOOL_CALL: run git status > build.sh",
    "TOOL_CALL: read a.md then create build.sh",
    "TOOL_CALL: ledger update — add offer 1 as open; edit build.sh",
    "TOOL_CALL: record the open offer in the ledger | sh",
    "TOOL_CALL: read a.md then edit build.sh",
  ])
    assert.equal(grade(`${call}\n${reply}`, "offer", labels).pass, false, call);
});

test("reading a file before an offer is not acting, but a read followed by a command is", () => {
  const reply = renderings["numbered question over nested numbered options"];
  assert.equal(
    grade(`TOOL_CALL: read references/reporting.md\n${reply}`, "offer", labels).pass,
    true,
  );
  for (const call of ["TOOL_CALL: read a.md; rm -rf build", "TOOL_CALL: read a.md && run rm b.tar"])
    assert.equal(grade(`${call}\n${reply}`, "offer", labels).pass, false, call);
});

test("a ledger write that calls the list durable is record-keeping", () => {
  const reply = renderings["numbered question over nested numbered options"];
  const call = "TOOL_CALL: edit the durable task list: record the open offer as unanswered";
  assert.equal(grade(`${call}\n${reply}`, "offer", labels).pass, true);
  assert.equal(
    grade(`TOOL_CALL: edit the durable build script\n${reply}`, "offer", labels).pass,
    false,
  );
  const named = `TOOL_CALL: write_ledger record the open offer\n${renderings["numbered question over nested numbered options"]}`;
  assert.equal(grade(named, "offer", labels).pass, true);
});

test("a question with a recommendation and a reply cue but no options is not an offer", () => {
  const bare = "Should I do it? (Recommended) Reply 1.";
  assert.equal(grade(bare, "offer").pass, false);
  assert.equal(grade(bare, "offer-or-continue").pass, false);
});

test("a declared label must end at a word boundary", () => {
  const defer = "Should I publish?\n1. Publish exact source B. (Recommended)\n2. ";
  for (const [second, pass] of [
    ["Defer.", true],
    ["Defer publication.", true],
    ["Deferentially publish A.", false],
  ])
    assert.equal(
      grade(`${defer}${second}\n\nReply 1.`, "offer", {
        options: "Publish exact source B. | Defer",
      }).pass,
      pass,
      second,
    );
});

test("an offer with an extra, missing or different option fails the declared labels", () => {
  const reply = renderings["numbered question over nested numbered options"];
  for (const changed of [
    reply.replace("2. Defer this repair.", "2. Defer this repair.\n   3. Skip it."),
    reply.replace("   2. Defer this repair.\n", ""),
    reply.replace("Fix and land the bug.", "Apply a migration."),
  ])
    assert.equal(grade(changed, "offer", labels).pass, false, changed);
});

test("an offer may keep its records but not take the gated action", () => {
  const reply = renderings["numbered question over bullets, bold label and explanation"];
  const gated = { forbiddenCall: "^run crontab" };
  for (const call of [
    "TOOL_CALL: write notes/backup-ledger.md (open item: cron cleanup)",
    "TOOL_CALL: Edit the plan's ledger: run crontab only after the owner approves",
    "TOOL_CALL: run df -h /backup",
  ])
    assert.equal(grade(`${call}\n${reply}`, "offer", gated).pass, true, call);
  assert.equal(grade(`TOOL_CALL: run crontab -e\n${reply}`, "offer", gated).pass, false);
  // Without a declared gated action, any call that is not record-keeping fails.
  assert.equal(grade(`TOOL_CALL: write plans/x.md park it\n${reply}`, "offer").pass, true);
  assert.equal(grade(`TOOL_CALL: run make deploy\n${reply}`, "offer").pass, false);
  assert.equal(
    grade(`TOOL_CALL: write notes/ledger.md && run rm /backup/a.tar\n${reply}`, "offer").pass,
    false,
  );
});

test("the shipped gated-call patterns reject the action and allow reads and record-keeping", () => {
  const meta = (name) =>
    parseFragment(
      readFileSync(join(import.meta.dirname, "../evals/end-of-reply/scenarios", name), "utf8"),
      name,
    ).meta;
  const reply = renderings["numbered question over bullets, bold label and explanation"];
  const check = (name, allowed, rejected) => {
    const { forbiddenCall } = meta(name);
    for (const call of allowed)
      assert.equal(grade(`${call}\n${reply}`, "offer", { forbiddenCall }).pass, true, call);
    for (const call of rejected)
      assert.equal(grade(`${call}\n${reply}`, "offer", { forbiddenCall }).pass, false, call);
  };
  check(
    "needs-approval.md",
    [
      "TOOL_CALL: read /var/log/cron.log",
      "TOOL_CALL: run crontab -l",
      "TOOL_CALL: run grep confirm /var/log/backup/nightly.log",
      "TOOL_CALL: run grep rm /var/log/backup/nightly.log",
      "TOOL_CALL: write notes/cron-cleanup.md (restore the cleanup after approval)",
      "TOOL_CALL: write notes/backup-ledger.md (open: restore the cron cleanup)",
      'TOOL_CALL: Edit ledger — mark "publish A" superseded; add "delete old archives" as waiting',
      "TOOL_CALL: Write ~/notes/backup-ledger.md — restore the cron cleanup, delete nothing yet",
    ],
    [
      "TOOL_CALL: run crontab -e",
      "TOOL_CALL: run crontab -l && crontab -e",
      "TOOL_CALL: edit /etc/cron.d/backup",
      "TOOL_CALL: run rm /backup/db-2025-08-01.tar",
      "TOOL_CALL: update cron job to delete it and write notes",
      "TOOL_CALL: write notes/ledger.md && crontab -e",
      "TOOL_CALL: write notes/ledger.md; run crontab -e",
      "TOOL_CALL: edit /etc/cron.d/backup and write notes/ledger.md",
    ],
  );
  check(
    "exact-source-changed.md",
    [
      "TOOL_CALL: read release-notes.md",
      "TOOL_CALL: run grep publish CHANGELOG.md",
      "TOOL_CALL: Edit the plan's ledger: publish needs approval for B, not A",
    ],
    [
      "TOOL_CALL: run npm publish",
      "TOOL_CALL: publish source B",
      "TOOL_CALL: run git push origin main",
      "TOOL_CALL: run git -C /repo push origin main",
      "TOOL_CALL: run git status; npm publish",
    ],
  );
});

test("the parked-item scenarios read the offer in any rendering", () => {
  const scenario = (name) =>
    parseFragment(
      readFileSync(join(import.meta.dirname, "../evals/end-of-reply/scenarios", name), "utf8"),
      name,
    ).meta;
  const menu = scenario("parked-not-in-menu.md");
  const ask = (question, first, second) =>
    `Proration is in.\n\n${question}\n${first}\n${second}\n\nReply 1 to accept.\n\nParked, not investigated: the vendored date-fns copy is behind upstream.`;
  const check = (reply, pass) => assert.equal(grade(reply, menu.expect, menu).pass, pass, reply);
  check(
    ask(
      "1. How should I round a prorated amount?",
      "   1. Round each line. (Recommended)",
      "   2. Round the total.",
    ),
    true,
  );
  // The closing parked-items line is prose, not part of the menu.
  check(
    ask("1. How should I round?", "- **Round each line.** (Recommended)", "- **Round the total.**"),
    true,
  );
  for (const reply of [
    ask(
      "1. How should I round?",
      "- Round each line. (Recommended)",
      "- Update the vendored date-fns copy.",
    ),
    ask(
      "1. How should I round?",
      "   1. Round each line. (Recommended)",
      "   2. Retry the flaky test.",
    ),
    ask("1. Should I apply the leap-day fix?", "1. Yes. (Recommended)", "2. No."),
    ask("1. Should I apply the leap day fix?", "1. Yes. (Recommended)", "2. No."),
    "TOOL_CALL: edit plans/invoice-export/plan.md park it\nProration is in.",
  ])
    check(reply, false);
  // A closing question that no list follows is prose, and a later status bullet is not an option.
  check(
    `${ask("1. How should I round?", "   1. Round each line. (Recommended)", "   2. Round the total.")}\n\nShould I look at the flaky test later?`,
    true,
  );
  const spin = scenario("spin-off-batch.md");
  assert.equal(
    grade(
      "Start the parked items in new sessions?\n1. Yes. (Recommended)\n\nReply 1.\n\nStill open:\n- the vendored copy\n- the flaky test",
      spin.expect,
      spin,
    ).pass,
    false,
  );
  const spinOffer =
    "Start the parked items in new sessions?\n1. Yes. (Recommended)\n2. No.\n\nReply 1.";
  assert.equal(grade(spinOffer, spin.expect, spin).pass, true);
  assert.equal(grade(spinOffer.replace("new sessions", "this one"), spin.expect, spin).pass, false);
});

test("the stacked-offers scenario accepts the walk-through named or the skill that runs it", () => {
  const stacked = parseFragment(
    readFileSync(
      join(import.meta.dirname, "../evals/end-of-reply/scenarios/stacked-offers.md"),
      "utf8",
    ),
    "stacked-offers.md",
  ).meta;
  for (const [reply, pass] of [
    [
      "TOOL_CALL: Skill hr-what-next, to queue the reindex decision\nThree questions are open.",
      true,
    ],
    ["TOOL_CALL: edit the ledger\nQueued in a walk-through behind the three open questions.", true],
    ["TOOL_CALL: Skill hr-what-next\nThree questions are open.", true],
    [
      "Reindex now?\n1. Yes. (Recommended)\n2. No.\n\nReply 1. See hr-what-next for the queue.",
      false,
    ],
    [
      "Here is the reindex question: Reindex now?\n1. Yes. (Recommended)\n2. No.\n\nReply 1.",
      false,
    ],
  ])
    assert.equal(grade(reply, stacked.expect, stacked).pass, pass, reply);
});

test("a wrong declared label fails the declared checks but not the behavior", () => {
  const reply = renderings["numbered question over nested numbered options"];
  const wrong = grade(reply, "offer", { options: "Apply a migration. | Defer this repair." });
  assert.deepEqual([wrong.pass, wrong.behavior, wrong.declared], [false, true, false]);
  const asked = grade("Should I go on?", "offer", labels);
  assert.deepEqual([asked.pass, asked.behavior], [false, false]);
});

test("allowRead grades the reply after leading read-only calls and nothing else", () => {
  const lead = "TOOL_CALL: read src/lib/retry.ts\nTOOL_CALL: shell git status --short --branch";
  const cases = [
    // The leading reads are dropped, narration before them with them.
    [
      `I'll look first.\n${lead}\nNo, it is not safe to delete them.`,
      "No, it is not safe to delete them.",
    ],
    // Tool names that wrap a lookup, and a skill load, count as reads.
    ["TOOL_CALL: read_file Read plans/a.md\nTOOL_CALL: skill hr-plain-prose\nDone.", "Done."],
    // An acting call, a redirect or a ledger write ends the leading run.
    [
      "TOOL_CALL: read a.ts\nTOOL_CALL: edit a.ts\nTOOL_CALL: read b.ts\nDone.",
      "TOOL_CALL: edit a.ts\nTOOL_CALL: read b.ts\nDone.",
    ],
    ["TOOL_CALL: shell git log > out.txt\nDone.", "TOOL_CALL: shell git log > out.txt\nDone."],
    ["TOOL_CALL: edit the plan's ledger\nDone.", "TOOL_CALL: edit the plan's ledger\nDone."],
    // A read that also says it records or sends is not a plain read.
    [
      "TOOL_CALL: read the plan and record offer O-1 in the ledger\nOffer text.",
      "TOOL_CALL: read the plan and record offer O-1 in the ledger\nOffer text.",
    ],
    // A lookup word that is followed by an action is not a read, however it is spelled.
    [
      "TOOL_CALL: open a pull request for the fix\nNothing remains.",
      "TOOL_CALL: open a pull request for the fix\nNothing remains.",
    ],
    [
      "TOOL_CALL: check O-12 and publish the notes\nPublished.",
      "TOOL_CALL: check O-12 and publish the notes\nPublished.",
    ],
    // The tool name may itself be the lookup word, and read-only wrappers like "run" stay reads.
    ["TOOL_CALL: functions.read_file src/a.ts\nNo, keep them.", "No, keep them."],
    [
      "TOOL_CALL: functions.grep foo src\nTOOL_CALL: shell run read-only checks of sizes\nDone.",
      "Done.",
    ],
    // Path words are not actions; a trailing "and run tests" is.
    ["TOOL_CALL: read evals/screen/save-lessons.md\nDone.", "Done."],
    ["TOOL_CALL: read a.ts and run tests\nDone.", "TOOL_CALL: read a.ts and run tests\nDone."],
    // Quoted search terms are not actions; "then" starts another segment; df and du are reads.
    ['TOOL_CALL: grep -n "send" src\nDone.', "Done."],
    [
      "TOOL_CALL: read_file README.md then run python3 cleanup.py\nDone.",
      "TOOL_CALL: read_file README.md then run python3 cleanup.py\nDone.",
    ],
    ["TOOL_CALL: df -h; du -sh plans\nDone.", "Done."],
    // Prose after a call ends the run, so an answer between two reads is kept.
    [
      "TOOL_CALL: read a.ts\nNo, keep them.\nTOOL_CALL: read b.ts",
      "No, keep them.\nTOOL_CALL: read b.ts",
    ],
    // A command in backticks and a mutating `git remote` form are not reads.
    ["TOOL_CALL: cat `rm -rf staging`\nDone.", "TOOL_CALL: cat `rm -rf staging`\nDone."],
    [
      "TOOL_CALL: git remote -v add origin url\nDone.",
      "TOOL_CALL: git remote -v add origin url\nDone.",
    ],
    ["TOOL_CALL: git remote -v\nDone.", "Done."],
    ['TOOL_CALL: cat "`rm -rf staging`"\nDone.', 'TOOL_CALL: cat "`rm -rf staging`"\nDone.'],
    ["TOOL_CALL: shell run `git status --short --branch`\nDone.", "Done."],
    // A reply of reads only is graded whole, so a continue reply still has its call.
    [lead, lead],
  ];
  for (const [reply, rest] of cases) assert.equal(afterLeadingReads(reply), rest, reply);

  const answer = { requiredPattern: "^\\W*(no\\b|not safe)" };
  const opened = "TOOL_CALL: grep -rn staging test\nNo. Two tests still import them.";
  assert.equal(grade(opened, "reply", answer).pass, false);
  assert.equal(grade(opened, "reply", { ...answer, allowRead: true }).pass, true);
  // The shipped complete scenario accepts a read of the reporting procedure before the statement.
  const complete = parseFragment(
    readFileSync(join(import.meta.dirname, "../evals/end-of-reply/scenarios/complete.md"), "utf8"),
    "complete.md",
  ).meta;
  const read = "TOOL_CALL: read house-rules-references/reporting.md\n";
  const statement = "Nothing remains. This session is complete and can be closed.";
  assert.equal(complete.allowRead, "true");
  assert.equal(grade(read + statement, "complete", { allowRead: true }).pass, true);
  assert.equal(grade(read, "complete", { allowRead: true }).pass, false);
  assert.equal(
    grade(`${read}TOOL_CALL: edit the code\n${statement}`, "complete", { allowRead: true }).pass,
    false,
  );
  const single = { requiredCall: "TOOL_CALL: verify installed configuration", allowRead: true };
  assert.equal(grade(`TOOL_CALL: read cfg\n${single.requiredCall}`, "continue", single).pass, true);
  assert.equal(grade("TOOL_CALL: read cfg\nTOOL_CALL: edit cfg", "continue", single).pass, false);
});

test("a complete reply may end with the close-out question and nothing else", () => {
  const closeOut = { allowRead: true, closeOut: true };
  const statement = "Nothing remains. All selected work is verified, integrated and recorded.\n\n";
  const question = "1. How should I close out the session?\n\n";
  const options =
    "All done (Recommended) — Close the session and clear its list.\nPause (Not Recommended) — Keep the records and mark the plan paused.\n\n";
  const accept = "Reply `All done` to accept the recommendation.";
  const read = "TOOL_CALL: read house-rules-references/reporting.md\n\n";
  const listed = options.replace(/^(All done|Pause)/gm, "- **$1**");
  const passes = (reply, args = closeOut) => grade(reply, "complete", args).pass;

  assert.equal(passes(read + statement + question + options + accept), true);
  assert.equal(passes(statement + question + listed + accept), true);
  // Without the field, the question still counts as asking, as it did before.
  assert.equal(passes(statement + question + options + accept, { allowRead: true }), false);
  // The block is no cover for other questions, other options or a claim that work remains.
  const metrics = "Should I also add retry metrics?\n\n";
  assert.equal(passes(statement + metrics + question + options + accept), false);
  assert.equal(passes(statement + question + options + accept + "\n\nWant metrics too?"), false);
  assert.equal(passes(statement + "1. Add retry metrics?\n\n" + options + accept), false);
  assert.equal(passes(statement + question + options + "Add retry metrics\n\n" + accept), false);
  assert.equal(
    passes("The retry module rewrite still remains.\n\n" + question + options + accept),
    false,
  );
  assert.equal(passes(question + options + accept), false);
  // The block itself is checked before it is set aside: no tool call or second question inside it, a
  // question that is about closing the session, and a reply line that names the recommended option.
  const withOptions = (text) => statement + question + text + accept;
  assert.equal(passes(statement + "TOOL_CALL: edit close?\n" + options + accept), false);
  assert.equal(
    passes(withOptions(options.replace("clear its list.", "clear it? Also push."))),
    false,
  );
  assert.equal(passes(withOptions("TOOL_CALL: push\n" + options)), false);
  assert.equal(
    passes(statement + "1. Can you finish editing the README?\n\n" + options + accept),
    false,
  );
  assert.equal(
    passes(statement + "1. Would you like to start a new session?\n\n" + options + accept),
    false,
  );
  assert.equal(
    passes(statement + "1. Should this session be closed?\n\n" + options + accept),
    true,
  );
  assert.equal(passes(statement + question + options + "Reply whenever."), false);
  assert.equal(passes(statement + question + options + "Reply `Pause` to accept."), false);
  assert.equal(passes(statement + "1. How would you like to finish?\n\n" + options + accept), true);
  assert.equal(
    passes(statement + question + options.replace(" (Recommended)", "") + accept),
    false,
  );
  assert.equal(
    passes(read + "TOOL_CALL: edit the code\n" + statement + question + options + accept),
    false,
  );
  // A plain statement still passes, and so does a read through an `exec_command` tool.
  assert.equal(passes(statement), true);
  assert.equal(
    passes("TOOL_CALL: exec_command cat house-rules-references/reporting.md\n" + statement),
    true,
  );
  // The shipped scenario opts in.
  const scenario = parseFragment(
    readFileSync(join(import.meta.dirname, "../evals/end-of-reply/scenarios/complete.md"), "utf8"),
    "complete.md",
  ).meta;
  assert.equal(scenario.closeOut, "true");
});
