import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { scratch } from "./fixture.mjs";
import { join } from "node:path";
import { test } from "node:test";

const run = join(import.meta.dirname, "../evals/end-of-reply/run.mjs");

// A fake model CLI: reads the prompt on stdin and prints `reply`'s result.
/**
 * @param {string} dir
 * @param {string} reply
 */
const fakeModel = (dir, reply) => {
  const file = join(dir, "model.mjs");
  writeFileSync(
    file,
    `let p = ""; process.stdin.on("data", (d) => (p += d)).on("end", () => process.stdout.write((${reply})(p)));`,
  );
  return `"${process.execPath}" "${file}"`;
};

/**
 * @param {import("node:test").TestContext} t
 * @param {string} reply
 */
const baseline = (t, reply) => {
  const dir = scratch(t, "house-rules-eval-");
  const rules = join(dir, "rules.md");
  writeFileSync(rules, "RULES-MARKER\n");
  return spawnSync(
    process.execPath,
    [run, "--rules", rules, "--cmd", fakeModel(dir, reply), "--baseline"],
    { encoding: "utf8" },
  );
};

test("--baseline reports each arm and warns about scenarios every arm passes", (t) => {
  const r = baseline(t, `() => "TOOL_CALL: Bash run tests\\n"`);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stdout, /^rules 2\/20, one-line 2\/20, no-rules 2\/20$/m);
  assert.match(r.stdout, /^behavior only: rules \d+\/20, one-line \d+\/20, no-rules \d+\/20$/m);
  assert.match(r.stdout, /^WARN continue\.md /m);
  assert.match(r.stdout, /^WARN followups\.md /m);
  assert.doesNotMatch(r.stdout, /WARN parked-finding\.md/);
  assert.doesNotMatch(r.stdout, /WARN phase-remainder\.md/);
  assert.doesNotMatch(r.stdout, /WARN waiting-with-ready-backlog\.md/);
  assert.doesNotMatch(r.stdout, /WARN needs-approval\.md/);
});

test("--baseline exits on the rules arm alone and stays quiet when only the rules pass", (t) => {
  const offer = "Apply the change?\\n\\n1. Apply it (Recommended)\\n2. Wait\\n\\nReply 1 to apply.";
  const decision =
    "Fix the validation bug?\\n\\n1. Fix and land the configuration validation bug. (Recommended)\\n2. Defer this repair.\\n\\nReply 1 to proceed.";
  const helperOffer = offer
    .replace("Apply it", "Select the compatible date helper.")
    .replace("2. Wait", "2. Defer the export repair.");
  const sourceOffer = offer
    .replace("Apply it", "Publish exact source B.")
    .replace("2. Wait", "2. Defer");
  const keepOffer = offer.replace("Apply it", "Keep the research checkout.");
  const queueOffer = offer.replace("Apply it", "Start the walk-through over the open offers.");
  const spinOffer = offer.replace("Apply it", "Start the parked items in new sessions.");
  const r = baseline(
    t,
    `(p) => /All selected work is verified/.test(p) ? "Done. Nothing remains." : !p.includes("RULES-MARKER") ? "Done." : /Two observations remain parked/.test(p) ? "Two parked items remain in [the ledger](plans/invoice-export/plan.md) with their original triggers." : /shared helper rejects/.test(p) ? "${helperOffer}" : /passed over/.test(p) ? "Done. Nothing remains." : /slot is occupied/.test(p) ? "Publication remains blocked. The integration slot is occupied." : /explicitly paused/.test(p) ? "Work is paused. Resume only when the user asks." : /input explicitly frozen/.test(p) ? "Blocked. The evaluation input is frozen." : /one exact revision|already authorized/.test(p) ? "Blocked. The integration slot is occupied." : /exactly this call|Replay action label/.test(p) ? "TOOL_CALL: verify installed configuration\\n" : /research checkout/.test(p) ? "${keepOffer}" : /Reindex the docs search/.test(p) ? "${queueOffer}" : /Purpose done/.test(p) ? "${spinOffer}" : /round each line/.test(p) ? "${offer}" : /leap days/.test(p) ? "TOOL_CALL: edit plans/invoice-export/plan.md park the date-fns finding\\n" : /unselected/i.test(p) ? "${decision}" : /source revision A/.test(p) ? "${sourceOffer}" : /approval|not selected/.test(p) ? "${offer}" : "TOOL_CALL: Bash run tests\\n"`,
  );
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /^rules 20\/20, one-line 1\/20, no-rules 1\/20$/m);
  assert.match(r.stdout, /^behavior only: rules 20\/20, /m);
  assert.match(r.stdout, /WARN complete\.md/);
  assert.equal((r.stdout.match(/^WARN /gm) ?? []).length, 1);
});
