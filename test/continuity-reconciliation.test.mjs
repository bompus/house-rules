import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkBoundary } from "../scripts/continuity-boundary.mjs";

/** @param {string} text */
const hash = (text) => createHash("sha256").update(text).digest("hex");
const text =
  "Owner: demo\nStatus: active\nPurpose: demo\n## Ledger\n- [ ] Wait for owner; recheck: 2030-01-03\n";
const context = { planText: text, sessionId: "session-a", turnId: "turn-a", today: "2030-01-01" };
const id = `L5:${hash(" Wait for owner; recheck: 2030-01-03")}`;
const receipt = () => ({
  version: 1,
  sessionId: context.sessionId,
  turnId: context.turnId,
  planSHA256: hash(text),
  exit: 2,
  errors: [],
  findings: [],
  openItems: [
    { id, line: 5, mark: " ", text: "Wait for owner; recheck: 2030-01-03", recheck: "2030-01-03" },
  ],
});
const waiting = () => ({
  id,
  kind: "live-owner-wait",
  next: "Read owner result.",
  owner: "worker-a",
  reference: "task-a",
  recheck: "2030-01-03",
});
// The cases below break this record on purpose, so it is untyped.
/** @returns {any} */
const state = () => ({
  version: 2,
  disposition: "blocked",
  goal: "Finish work.",
  result: "Checks passed.",
  remaining: "Owner is running.",
  phaseBoundary: false,
  reconciliation: receipt(),
  items: [waiting()],
  decisions: [],
});
const reply = "Owner is running.";
const offer =
  "**Question 1: Next step?**\n\n- `1a` (Recommended): Select deployment.\n- `1b`: Defer.\n\nRecommended: reply `1a` or `go`";

test("floor emits a bound receipt, including open identities on invalid input", () => {
  const root = mkdtempSync(join(process.env.HOUSE_RULES_TEST_TMP ?? tmpdir(), "bound-floor-"));
  try {
    const plan = join(root, "plan.md");
    const run = () =>
      spawnSync(
        process.execPath,
        [
          join(import.meta.dirname, "../skills/hr-what-next/scripts/check-open-work.mjs"),
          plan,
          "--offline",
          "--json",
          "--session",
          context.sessionId,
          "--turn",
          context.turnId,
        ],
        { encoding: "utf8" },
      );
    writeFileSync(plan, text);
    const good = run();
    assert.equal(good.status, 2);
    const r = JSON.parse(good.stdout).reconciliation;
    assert.deepEqual(r, receipt());
    assert.equal(checkBoundary(reply, { ...state(), reconciliation: r }, context).pass, true);
    writeFileSync(plan, text + "- [x] Done without evidence\n");
    const bad = run();
    assert.equal(bad.status, 1);
    const invalid = JSON.parse(bad.stdout);
    assert.equal(invalid.open.length, 1);
    assert.equal(invalid.reconciliation.openItems[0].id, id);
    assert.equal(invalid.reconciliation.exit, 1);
    assert.ok(invalid.reconciliation.errors.length);
    for (const args of [
      ["--session", "s"],
      ["--turn", "t"],
      ["--session", "s", "--turn", "t", "--archive"],
    ]) {
      const rejected = spawnSync(
        process.execPath,
        [
          join(import.meta.dirname, "../skills/hr-what-next/scripts/check-open-work.mjs"),
          plan,
          ...args,
        ],
        { encoding: "utf8" },
      );
      assert.equal(rejected.status, 1);
      assert.match(rejected.stderr, /supplied together|cannot archive/);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("valid live-owner and external-trigger waits can hand back", () => {
  assert.deepEqual(checkBoundary(reply, state(), context), { pass: true, issues: [] });
  const external = state();
  external.items[0] = {
    ...waiting(),
    kind: "external-trigger-wait",
    trigger: "Upstream posts a release.",
  };
  assert.equal(checkBoundary(reply, external, context).pass, true);
});

/** @type {Record<string, (s: any) => void>} */
const invalidCases = {
  "absent reconciliation": (s) => {
    delete s.reconciliation;
  },
  "invalid reconciliation": (s) => {
    s.reconciliation = [];
  },
  "exit 1 with empty groups": (s) => {
    s.reconciliation.exit = 1;
  },
  "validation errors": (s) => {
    s.reconciliation.errors = ["invalid ledger"];
  },
  "unaccounted findings": (s) => {
    s.reconciliation.findings = ["untracked resource"];
  },
  "stale turn": (s) => {
    s.reconciliation.turnId = "previous";
  },
  "foreign session": (s) => {
    s.reconciliation.sessionId = "foreign";
  },
  "changed hash": (s) => {
    s.reconciliation.planSHA256 = "0".repeat(64);
  },
  "forged empty floor": (s) => {
    s.reconciliation.openItems = [];
  },
  "null classification": (s) => {
    s.items = [null];
  },
  unclassified: (s) => {
    delete s.items[0].kind;
  },
  "missing item": (s) => {
    s.items = [];
  },
  "duplicate item": (s) => {
    s.items.push(waiting());
  },
  "unknown item": (s) => {
    s.items.push({ ...waiting(), id: "unknown" });
  },
  "unsent result": (s) => {
    s.items[0] = {
      id,
      kind: "unsent-result",
      next: "Send required result.",
      authority: "Assigned report.",
    };
  },
  "authorized ready action": (s) => {
    s.items[0] = {
      id,
      kind: "authorized-ready-action",
      next: "Run next check.",
      authority: "Selected task.",
    };
  },
  "omitted ready decision": (s) => {
    s.items[0] = { id, kind: "ready-user-decision", next: "Select deployment." };
  },
  "missing owner reference": (s) => {
    delete s.items[0].reference;
  },
  "overdue wait": (s) => {
    s.items[0].recheck = "2029-12-31";
  },
};
for (const [name, mutate] of Object.entries(invalidCases)) {
  test(`rejects ${name}`, () => {
    const record = state();
    mutate(record);
    assert.equal(checkBoundary(reply, record, context).pass, false);
  });
}

test("current plan bytes and adapter identities are required", () => {
  assert.equal(checkBoundary(reply, state()).pass, false);
  assert.equal(checkBoundary(reply, state(), { ...context, planText: text + "\n" }).pass, false);
  assert.equal(checkBoundary(reply, state(), { ...context, turnId: "new-turn" }).pass, false);
  assert.equal(
    checkBoundary(reply, state(), { ...context, planText: text + "- [x] invalid\n" }).pass,
    false,
  );
});

test("ready decision requires its concrete text on an offer option", () => {
  const record = state();
  record.disposition = "offer";
  record.items = [{ id, kind: "ready-user-decision", next: "Select deployment." }];
  record.decisions = [{ id, text: "Select deployment." }];
  assert.equal(checkBoundary(offer, record, context).pass, true);
  assert.equal(
    checkBoundary(offer.replace("Select deployment.", "Run unrelated work."), record, context).pass,
    false,
  );
  assert.equal(
    checkBoundary(
      offer.replace("Select deployment.", "Run unrelated work.") + "\nSelect deployment.",
      record,
      context,
    ).pass,
    false,
  );
  record.decisions.push({ id, text: "Select deployment." });
  assert.equal(checkBoundary(offer, record, context).pass, false);
});

test("an overdue ledger recheck cannot be hidden by a later attested date", () => {
  const record = state();
  record.items[0].recheck = "2030-01-04";
  assert.equal(checkBoundary(reply, record, { ...context, today: "2030-01-03" }).pass, false);
});

test("adapter stop, hold, pause and low-quota signals take precedence", () => {
  for (const stopReason of ["stop", "hold", "pause", "low-quota"]) {
    assert.equal(checkBoundary("Stopped.", null, { stopReason }).pass, true);
  }
  assert.equal(checkBoundary(reply, state(), { stopReason: "unknown" }).pass, false);
});

test("version 1 callers require explicit migration", () => {
  const record = state();
  record.version = 1;
  assert.equal(checkBoundary(reply, record, context).pass, false);
});

test("a decision among waits cannot be omitted or replaced with unrelated option text", () => {
  const mixedText = text + "- [ ] Decide release timing\n";
  const mixedContext = { ...context, planText: mixedText };
  const decisionId = `L6:${hash(" Decide release timing")}`;
  const record = state();
  record.reconciliation.planSHA256 = hash(mixedText);
  record.reconciliation.openItems.push({
    id: decisionId,
    line: 6,
    mark: " ",
    text: "Decide release timing",
    recheck: null,
  });
  record.items.push({ id: decisionId, kind: "ready-user-decision", next: "Select deployment." });
  assert.equal(checkBoundary(reply, record, mixedContext).pass, false);
  record.disposition = "offer";
  record.decisions = [{ id: decisionId, text: "Select deployment." }];
  assert.equal(checkBoundary(offer, record, mixedContext).pass, true);
  record.decisions[0].text = "Defer.";
  assert.equal(checkBoundary(offer, record, mixedContext).pass, false);
});

test(
  "the existing floor CLI still executes through a symlink",
  { skip: process.platform === "win32" },
  () => {
    const root = mkdtempSync(join(process.env.HOUSE_RULES_TEST_TMP ?? tmpdir(), "linked-floor-"));
    try {
      const plan = join(root, "plan.md");
      const link = join(root, "floor.mjs");
      writeFileSync(plan, text);
      symlinkSync(
        join(import.meta.dirname, "../skills/hr-what-next/scripts/check-open-work.mjs"),
        link,
      );
      const run = spawnSync(process.execPath, [link, plan, "--offline", "--json"], {
        encoding: "utf8",
      });
      assert.equal(run.status, 2);
      assert.equal(JSON.parse(run.stdout).open.length, 1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
