import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

const baseline = (reply) => {
  const dir = mkdtempSync(join(tmpdir(), "house-rules-eval-"));
  const rules = join(dir, "rules.md");
  writeFileSync(rules, "RULES-MARKER\n");
  return spawnSync(
    process.execPath,
    [run, "--rules", rules, "--cmd", fakeModel(dir, reply), "--baseline"],
    { encoding: "utf8" },
  );
};

test("--baseline reports each arm and warns about scenarios every arm passes", () => {
  const r = baseline(`() => "TOOL_CALL: Bash run tests\\n"`);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stdout, /^rules 2\/3, one-line 2\/3, no-rules 2\/3$/m);
  assert.match(r.stdout, /^WARN continue\.md /m);
  assert.match(r.stdout, /^WARN followups\.md /m);
  assert.doesNotMatch(r.stdout, /WARN needs-approval\.md/);
});

test("--baseline exits on the rules arm alone and stays quiet when only the rules pass", () => {
  const offer = "Apply the change?\\n\\n1. Apply it (Recommended)\\n2. Wait\\n\\nReply 1 to apply.";
  const r = baseline(
    `(p) => !p.includes("RULES-MARKER") ? "Done. Nothing is left." : /approv/i.test(p) ? "${offer}" : "TOOL_CALL: Bash run tests\\n"`,
  );
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /^rules 3\/3, one-line 0\/3, no-rules 0\/3$/m);
  assert.doesNotMatch(r.stdout, /WARN/);
});
