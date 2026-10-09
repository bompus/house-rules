import assert from "node:assert/strict";
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
