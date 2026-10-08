import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { scratch } from "./fixture.mjs";
import { join } from "node:path";
import { test } from "node:test";

const run = join(import.meta.dirname, "../evals/end-of-reply/run.mjs");

// A fake model CLI: reads the prompt on stdin and prints `reply`'s result.
const fakeModel = (dir, reply) => {
  const file = join(dir, "model.mjs");
  writeFileSync(
    file,
    `let p = ""; process.stdin.on("data", (d) => (p += d)).on("end", () => process.stdout.write((${reply})(p)));`,
  );
  return `"${process.execPath}" "${file}"`;
};

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
  assert.match(r.stdout, /^rules 3\/5, one-line 3\/5, no-rules 3\/5$/m);
  assert.match(r.stdout, /^WARN continue\.md /m);
  assert.match(r.stdout, /^WARN followups\.md /m);
  assert.match(r.stdout, /^WARN phase-remainder\.md /m);
  assert.doesNotMatch(r.stdout, /WARN waiting-with-ready-backlog\.md/);
  assert.doesNotMatch(r.stdout, /WARN needs-approval\.md/);
});

test("--baseline exits on the rules arm alone and stays quiet when only the rules pass", (t) => {
  const offer = "Apply the change?\\n\\n1. Apply it (Recommended)\\n2. Wait\\n\\nReply 1 to apply.";
  const r = baseline(
    t,
    `(p) => !p.includes("RULES-MARKER") ? "Done. Nothing is left." : /approval|unselected/i.test(p) ? "${offer}" : "TOOL_CALL: Bash run tests\\n"`,
  );
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /^rules 5\/5, one-line 0\/5, no-rules 0\/5$/m);
  assert.doesNotMatch(r.stdout, /WARN/);
});
