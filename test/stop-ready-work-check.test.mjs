import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decide, evaluate } from "../scripts/stop-ready-work-check.mjs";

const plan = (/** @type {string} */ ledger, status = "active") =>
  `Owner: test\nStatus: ${status}\n## Ledger\n${ledger}\n`;
const READY = plan("- [ ] Write the next step\n- [x] Done; evidence: checked");
const WAITING = plan(
  "- [ ] Write the next step\n- [ ] Land the change; waiting on CI run 12, recheck: 2026-11-01",
);
const DEFERRED_ONLY = plan(
  "- [~] Later work; trigger: user decides\n- [x] Done; evidence: checked",
);
const PATH = "/x/plans/a/plan.md";

const WAITING_LINE = "Checks are running. Waiting.";
const OFFER =
  "**Question 1: Next step?**\n\n- `1a` (Recommended): Land it.\n- `1b`: Drop it.\n\nRecommended: reply `1a` or `go`";

/** @param {...any} lines */
const jsonl = (...lines) => lines.map((line) => JSON.stringify(line)).join("\n");
/** @param {any[]} content */
const assistant = (content) => ({ type: "assistant", message: { role: "assistant", content } });
/** @param {string} text */
const text = (text) => ({ type: "text", text });
/** @param {string} name @param {any} input */
const tool = (name, input) => ({ type: "tool_use", name, input });
const user = { type: "user", message: { role: "user", content: "go" } };

/** @param {Record<string, string>} files */
const reader = (files) => {
  const byPath = new Map(Object.entries(files).map(([path, body]) => [resolve(path), body]));
  return { read: (/** @type {string} */ path) => byPath.get(resolve(path)) };
};

const TODAY = "2026-10-29";
const check = (/** @type {string} */ reply, planText = READY) =>
  decide({ reply, planPath: PATH, planText, today: TODAY });

test("a waiting-line reply with ready work blocks and names the open items", () => {
  const result = check(WAITING_LINE);
  assert.equal(result.block, true);
  assert.match(result.reason ?? "", /1 open item/);
  assert.match(result.reason ?? "", /L4 - \[ \] Write the next step|L4 Write the next step/);
});

test("a coded offer, a stated blocker or trigger, and a handback claim each pass", () => {
  assert.equal(check(OFFER).block, false);
  for (const reply of [
    "Blocked on the user's login; I cannot proceed until it exists.",
    "Blocker: the upstream fix is not released. Reopens when it ships.",
    "The next step needs your decision on the branch name.",
    "Trigger: the 2026-11-01 recheck.",
    "Blocker: CI run 12 is still running.",
    "Awaiting your answer about the deployment region.",
    "Recheck on 2026-11-01 when the release is out.",
    "Landed. Nothing remains.",
    "Handed back to the Manager for the adoption step.",
  ]) {
    assert.equal(check(reply).block, false, reply);
  }
});

test("a bare waiting or status line is not a stated blocker", () => {
  for (const reply of [
    "The trigger handler is implemented. Waiting.",
    "I will recheck the build output next.",
    "Still waiting for CI.",
    "Working on it, 3 of 5 files done.",
    "Waiting for the next event.",
  ]) {
    assert.equal(check(reply).block, true, reply);
  }
});

test("an open item that carries a wait, or a plan with only deferred items, passes", () => {
  assert.equal(check(WAITING_LINE, WAITING).block, false);
  assert.equal(check(WAITING_LINE, DEFERRED_ONLY).block, false);
  assert.equal(check(WAITING_LINE, plan("- [x] Done; evidence: checked")).block, false);
  for (const wait of [
    "trigger: reply",
    "blocked-by: #12",
    "owner: another session",
    "awaiting the maintainer",
    "recheck: 2026-11-02",
  ]) {
    assert.equal(check(WAITING_LINE, plan(`- [ ] Item; ${wait}`)).block, false, wait);
  }
});

test("work the plan's own owner holds, or whose re-check is already due, is ready work", () => {
  for (const item of [
    "Item; owner: test",
    "Item; owner: Test",
    "Item; recheck: 2026-10-29",
    "Item; recheck: 2020-01-01",
  ]) {
    assert.equal(check("Working on it.", plan(`- [ ] ${item}`)).block, true, item);
  }
});

test("a plan that is not active passes", () => {
  for (const status of ["paused", "blocked-on-user", "completed"]) {
    assert.equal(
      check(WAITING_LINE, plan("- [ ] Write the next step", status)).block,
      false,
      status,
    );
  }
});

test("a reply that only quotes a satisfying phrase does not pass, and one that quotes a claim is not exempt", () => {
  assert.equal(check('I would say "blocked on the user" here, but no.').block, true);
  assert.equal(check('The checker sees "Question 1" in `1a (Recommended)` text.').block, true);
  assert.equal(check('Quote: "nothing left". Still waiting.').block, true);
  assert.equal(check('Quote: "nothing left". Blocked on CI.').block, false);
  const example = "Example reply:\n```\n" + OFFER + "\n```\nWaiting.";
  assert.equal(check(example).block, true);
});

test("an empty reply, an unparseable plan and a missing plan pass", () => {
  assert.equal(check("").block, false);
  assert.equal(check("   \n").block, false);
  const bad = check(WAITING_LINE, "no header here\n- [ ] item\n");
  assert.equal(bad.block, false);
  assert.match(bad.note ?? "", /does not parse/);
  assert.equal(
    decide({ reply: WAITING_LINE, planPath: undefined, planText: undefined }).block,
    false,
  );
});

test("evaluate blocks once and lets the continuation through", () => {
  const transcript = jsonl(
    user,
    assistant([tool("Edit", { file_path: "/x/plans/mine/plan.md" })]),
    assistant([text(WAITING_LINE)]),
  );
  const files = reader({ "/t.jsonl": transcript, "/x/plans/mine/plan.md": READY });
  const first = evaluate({ transcript_path: "/t.jsonl" }, files);
  assert.equal(first.block, true);
  const second = evaluate({ transcript_path: "/t.jsonl", stop_hook_active: true }, files);
  assert.equal(second.block, false);
});

test("evaluate prefers the hook input's message and passes when the plan cannot be read", () => {
  const transcript = jsonl(
    user,
    assistant([tool("Edit", { file_path: "/x/plans/mine/plan.md" })]),
    assistant([text(OFFER)]),
  );
  const withPlan = reader({ "/t.jsonl": transcript, "/x/plans/mine/plan.md": READY });
  assert.equal(
    evaluate({ transcript_path: "/t.jsonl", last_assistant_message: WAITING_LINE }, withPlan).block,
    true,
  );
  assert.equal(evaluate({ transcript_path: "/t.jsonl" }, withPlan).block, false);
  const noPlan = reader({ "/t.jsonl": transcript });
  assert.equal(
    evaluate({ transcript_path: "/t.jsonl", last_assistant_message: WAITING_LINE }, noPlan).block,
    false,
  );
  assert.equal(evaluate({ last_assistant_message: WAITING_LINE }, reader({})).block, false);
  assert.throws(() =>
    evaluate(
      { transcript_path: "/t.jsonl" },
      {
        read: () => {
          throw new Error("EIO");
        },
      },
    ),
  );
});

test("evaluate treats an empty message in the hook input as an empty reply", () => {
  const transcript = jsonl(
    user,
    assistant([tool("Edit", { file_path: "/x/plans/mine/plan.md" })]),
    assistant([text("Checking the next step.")]),
    assistant([text("")]),
  );
  const files = reader({ "/t.jsonl": transcript, "/x/plans/mine/plan.md": READY });
  assert.equal(
    evaluate({ transcript_path: "/t.jsonl", last_assistant_message: "" }, files).block,
    false,
  );
  assert.equal(evaluate({ transcript_path: "/t.jsonl" }, files).block, true);
});

test("evaluate checks the plan the session touched last and ignores a plan it only read", () => {
  const transcript = jsonl(
    user,
    assistant([tool("Edit", { file_path: "/x/plans/old/plan.md" })]),
    assistant([tool("Edit", { file_path: "/x/plans/new/plan.md" })]),
    assistant([tool("Read", { file_path: "/x/plans/other/plan.md" })]),
  );
  const files = reader({
    "/t.jsonl": transcript,
    "/x/plans/old/plan.md": READY,
    "/x/plans/new/plan.md": DEFERRED_ONLY,
    "/x/plans/other/plan.md": READY,
  });
  assert.equal(
    evaluate({ transcript_path: "/t.jsonl", last_assistant_message: WAITING_LINE }, files).block,
    false,
  );
});

test("run as a program it blocks once, then passes the continuation, a corrupt transcript and bad input", () => {
  const dir = mkdtempSync(join(process.env.HOUSE_RULES_TEST_TMP || tmpdir(), "stop-ready-"));
  try {
    const path = join(dir, "plans", "demo", "plan.md");
    mkdirSync(join(dir, "plans", "demo"), { recursive: true });
    writeFileSync(path, READY);
    const transcript = join(dir, "t.jsonl");
    writeFileSync(transcript, `${jsonl(user, assistant([tool("Edit", { file_path: path })]))}\n`);
    const script = fileURLToPath(new URL("../scripts/stop-ready-work-check.mjs", import.meta.url));
    const call = (/** @type {string} */ input) =>
      spawnSync(process.execPath, [script], { input, encoding: "utf8" });
    const hook = (/** @type {object} */ extra) =>
      JSON.stringify({ transcript_path: transcript, cwd: dir, ...extra });

    const blocked = call(hook({ last_assistant_message: WAITING_LINE }));
    assert.equal(blocked.status, 0);
    assert.equal(JSON.parse(blocked.stdout).decision, "block");
    assert.equal(call(hook({ last_assistant_message: OFFER })).stdout, "");
    assert.equal(
      call(hook({ last_assistant_message: WAITING_LINE, stop_hook_active: true })).stdout,
      "",
    );

    const garbage = call("not json");
    assert.equal(garbage.status, 0);
    assert.equal(garbage.stdout, "");
    assert.match(garbage.stderr, /passed without checking/);

    writeFileSync(transcript, '{"type":"user"}\n{broken\n');
    const corrupt = call(hook({ last_assistant_message: WAITING_LINE }));
    assert.equal(corrupt.stdout, "");
    assert.match(corrupt.stderr, /passed without checking/);

    const unreadable = call(
      JSON.stringify({ transcript_path: dir, last_assistant_message: WAITING_LINE }),
    );
    assert.equal(unreadable.status, 0);
    assert.equal(unreadable.stdout, "");
    assert.match(unreadable.stderr, /passed without checking/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
