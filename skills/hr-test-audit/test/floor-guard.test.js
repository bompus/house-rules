import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanDiff } from "../scripts/floor-guard.ts";

const diffOf = (file, lines, { deletedFile = false } = {}) =>
  [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ ${deletedFile ? "/dev/null" : `b/${file}`}`,
    "@@ -1 +1 @@",
    ...lines,
  ].join("\n");

test("a loosened test and a silenced checker are flagged", () => {
  const diff = [
    diffOf("src/sum.test.js", ["-  expect(sum(1, 2)).toBe(3);", '+test.skip("sum", () => {});']),
    diffOf("src/sum.js", ["+// @ts-ignore"]),
    diffOf("old/legacy.spec.ts", ["-it('works', () => {});"], { deletedFile: true }),
  ].join("\n");
  expect(
    scanDiff(diff)
      .map((f) => `${f.rule} ${f.file}`)
      .sort(),
  ).toEqual([
    "assertion-removed src/sum.test.js",
    "silenced-checker src/sum.js",
    "test-deleted old/legacy.spec.ts",
    "test-skipped src/sum.test.js",
  ]);
});

test("moved or strengthened assertions and non-test edits are clean", () => {
  const diff = [
    diffOf("test/api.test.js", [
      "-  expect(res.status).toBe(200);",
      "+  expect(res.status).toBe(200);",
      "+  expect(res.body.id).toBe(7);",
    ]),
    diffOf("src/app.js", ["-  assert(ok);", "+  if (!ok) throw new Error('bad');"]),
  ].join("\n");
  expect(scanDiff(diff)).toEqual([]);
});

test("hunk lines that start with --- or +++ stay with their file", () => {
  // Content lines `-- note` and `++ count;` print as `--- note` and `+++ count;`.
  const diff = diffOf("test/a.test.js", ["--- note", "+++ count;", '+test.skip("a", () => {});']);
  expect(scanDiff(diff)).toEqual([
    { rule: "test-skipped", file: "test/a.test.js", text: 'test.skip("a", () => {});' },
  ]);
});

test("outside a git repository the guard exits 2, never 0", () => {
  const dir = mkdtempSync(join(tmpdir(), "floor-guard-"));
  try {
    writeFileSync(join(dir, "a.test.js"), "");
    const script = join(import.meta.dir, "../scripts/floor-guard.ts");
    const r = spawnSync(process.execPath, [script], { cwd: dir, encoding: "utf8" });
    expect(r.status).toBe(2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
