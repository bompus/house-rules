import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { checkBoundary } from "../scripts/continuity-boundary.mjs";
import { grade } from "../evals/end-of-reply/grade.mjs";

const state = (disposition, extra = {}) => ({
  version: 1,
  disposition,
  goal: "Reduce repeated prompting.",
  result: "Offline checks passed.",
  remaining: "The integration slot is occupied.",
  phaseBoundary: false,
  ...extra,
});
const offer =
  "**Question 1: Next step?**\n\n`1A` (Recommended): Run the assessment.\n\n`1B`: Defer.\n\nRecommended: reply `1A` or `go`";

test("an already-approved blocker stops without a redundant decision", () => {
  const reply = "Publication remains pending. The integration slot is occupied.";
  assert.equal(checkBoundary(reply, state("blocked")).pass, true);
  assert.equal(checkBoundary(reply + "\n" + offer, state("blocked")).pass, false);
  assert.equal(
    checkBoundary(reply + " Would you like me to keep this pending?", state("blocked")).pass,
    false,
  );
  assert.equal(grade(reply, "blocked", { coded: true }).pass, true);
  assert.equal(grade(offer, "blocked", { coded: true }).pass, false);
  const permission = reply + " Can I proceed?";
  assert.equal(checkBoundary(permission, state("blocked")).pass, false);
  assert.equal(grade(permission, "blocked", { coded: true }).pass, false);
});

test("ready decisions appear in the handback, not only as prose", () => {
  assert.equal(checkBoundary("We should assess your workflow.", state("offer")).pass, false);
  assert.equal(checkBoundary(offer, state("offer")).pass, true);
});

test("authorized work cannot be recorded as a finished handback", () => {
  assert.equal(checkBoundary("Next I will verify it.", state("continue")).pass, false);
  const options = { requiredCall: "TOOL_CALL: verify installed configuration" };
  assert.equal(grade("TOOL_CALL: inspect unrelated repository", "continue", options).pass, false);
  assert.equal(grade(options.requiredCall, "continue", options).pass, true);
});

test("complete, frozen, paused and missing records remain distinct", () => {
  assert.equal(checkBoundary("Nothing remains.", state("complete")).pass, true);
  assert.equal(checkBoundary("Nothing remains.", state("blocked")).pass, false);
  assert.equal(
    checkBoundary(
      "Work is paused. Resume only when asked.",
      state("paused", { remaining: "Resume only when asked." }),
    ).pass,
    true,
  );
  assert.equal(
    checkBoundary(
      "Blocked. The evaluation input is frozen.",
      state("blocked", { remaining: "The evaluation input is frozen." }),
    ).pass,
    true,
  );
  for (const invalid of [null, [], {}, state("unknown"), state("blocked", { goal: "" })]) {
    assert.equal(checkBoundary("Done.", invalid).pass, false);
  }
});

test("phase handbacks include goal, result and remaining work", () => {
  const record = state("blocked", { phaseBoundary: true });
  assert.equal(checkBoundary(record.remaining, record).pass, false);
  assert.equal(
    checkBoundary([record.goal, record.result, record.remaining].join("\n"), record).pass,
    true,
  );
});

test("final dispositions reject declared tool calls", () => {
  for (const [disposition, reply] of [
    ["offer", offer],
    ["complete", "Nothing remains."],
    ["blocked", "Blocked. The integration slot is occupied."],
    ["paused", "Paused. The integration slot is occupied."],
  ]) {
    assert.equal(checkBoundary(reply, state(disposition)).pass, true);
    assert.equal(
      checkBoundary(reply + "\nTOOL_CALL: publish source B", state(disposition)).pass,
      false,
    );
  }
});

test("exact-source replay requires the action label on an offer option", () => {
  const options = { coded: true, options: "Publish exact source B. | Defer" };
  assert.equal(grade(offer + "\nPublish exact source B.", "offer", options).pass, false);
  assert.equal(
    grade(offer.replace("Run the assessment.", "Publish exact source B."), "offer", options).pass,
    true,
  );
});

test("a required pattern is matched without regard to case", () => {
  const options = { coded: true, requiredPattern: "walk-?through" };
  assert.equal(grade(offer, "offer", options).pass, false);
  assert.equal(grade(offer + "\nWalk-through of the open offers.", "offer", options).pass, true);
});

test("a forbidden pattern fails a reply that matches it", () => {
  const options = { forbiddenPattern: "TOOL_CALL[^\\n]*(issue|upstream)" };
  assert.equal(grade("TOOL_CALL: Bash run tests", "continue", options).pass, true);
  assert.equal(grade("TOOL_CALL: gh issue search leap day", "continue", options).pass, false);
});

test("the parked-finding scenario allows the ledger capture and rejects edits to the parked work", () => {
  const scenario = readFileSync(
    join(import.meta.dirname, "..", "evals/end-of-reply/scenarios/parked-finding.md"),
    "utf8",
  );
  const forbiddenPattern = scenario.match(/^forbiddenPattern: (.+)$/m)[1];
  const options = { requiredPattern: "park|defer", forbiddenPattern };
  const ledger = "TOOL_CALL: edit plans/invoice-export/plan.md park the date-fns finding";
  assert.equal(grade(ledger, "continue", options).pass, true);
  assert.equal(
    grade("TOOL_CALL: edit vendor/date-fns/index.js park the leap-day fix", "continue", options)
      .pass,
    false,
  );
});

test("a later remaining-work claim contradicts completion", () => {
  for (const reply of [
    "Nothing remains to verify; publishing the source remains.",
    "Nothing else is left. Publishing is left.",
    "Nothing left.\nOne release step remains.",
  ]) {
    assert.equal(grade(reply, "complete").pass, false);
    assert.equal(checkBoundary(reply, state("complete")).pass, false);
  }
  assert.equal(grade("All checks passed. Nothing remains.", "complete").pass, true);
});
