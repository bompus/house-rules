import assert from "node:assert/strict";
import { test } from "node:test";
import { grade } from "../evals/end-of-reply/grade.mjs";

const offer = "Run the migration now?\n\n1. Apply it (Recommended)\n2. Wait\n\nReply 1 to apply.";
const coded =
  "**Question 1: Apply?**\n\n`1A` (Recommended) Apply it.\n\n`1B` Wait.\n\nRecommended: reply `1A` or `go`";

test("each expectation passes its intended reply and fails the others", () => {
  const cases = [
    ["continue", "Tests next.\nTOOL_CALL: Bash run tests", {}, true],
    ["continue", "TOOL_CALL: Bash run tests\nShould I also lint?", {}, false],
    ["continue", "I cannot make a TOOL_CALL here.", {}, false],
    ["offer", offer, {}, true],
    ["offer", `TOOL_CALL: Bash migrate\n${offer}`, {}, false],
    ["offer", offer, { coded: true }, false],
    ["offer", coded, { coded: true }, true],
    ["offer-or-continue", "TOOL_CALL: Edit fix the flaky test", {}, true],
    ["offer-or-continue", `${offer}\nNothing else remains.`, {}, false],
  ];
  for (const [expect, reply, opts, pass] of cases)
    assert.equal(grade(reply, expect, opts).pass, pass, `${expect}: ${reply}`);
});

test("an unknown expectation is an error, not a failed reply", () => {
  assert.throws(() => grade("x", "ofer"), /unknown expect "ofer"/);
});

test("remainder scenarios reject unrelated actions and decisions", () => {
  const phase = { scenario: "phase-remainder.md" };
  const waiting = { scenario: "waiting-with-ready-backlog.md", coded: true };
  assert.equal(grade("TOOL_CALL: Bash run tests", "continue", phase).pass, false);
  assert.equal(
    grade("The installed configuration is pending.\nTOOL_CALL: Bash run tests", "continue", phase)
      .pass,
    false,
  );
  assert.equal(grade("TOOL_CALL: verify installed configuration", "continue", phase).pass, true);
  assert.equal(grade(coded, "offer", waiting).pass, false);
  assert.equal(
    grade(coded.replace("Apply?", "Fix the configuration validation bug?"), "offer", waiting).pass,
    true,
  );
});
