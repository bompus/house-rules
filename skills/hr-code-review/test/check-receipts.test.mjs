import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import {
  checkCitation,
  checkLogs,
  extractPanelText,
  findCitations,
} from "../scripts/check-receipts.mjs";

const roots = [];
const dir = () => {
  const path = mkdtempSync(join(tmpdir(), "check-receipts-"));
  roots.push(path);
  return path;
};
afterEach(() => {
  for (const path of roots.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

function seedRepo() {
  const root = dir();
  writeFileSync(join(root, "engine.ts"), "export function buildTotals() {}\nconst x = 1;\n");
  return root;
}

describe("check-receipts", () => {
  test("strict citation passes when the cited line holds the identifier", () => {
    const root = seedRepo();
    const [row] = findCitations("calls `buildTotals` (engine.ts:1) here");
    assert.equal(checkCitation(row, root).status, "pass");
  });

  test("strict citation fails when the cited line lacks the identifier", () => {
    const root = seedRepo();
    const [row] = findCitations("calls `buildTotals` (engine.ts:2) here");
    const result = checkCitation(row, root);
    assert.equal(result.status, "fail");
    assert.ok(result.reason.includes("lacks"));
  });

  test("bare citation checks existence only", () => {
    const root = seedRepo();
    const [row] = findCitations("see engine.ts:2 for context");
    assert.equal(row.strict, false);
    assert.equal(checkCitation(row, root).status, "pass");
  });

  test("missing file and past-EOF lines fail", () => {
    const root = seedRepo();
    assert.equal(checkCitation(findCitations("`x` (nope.ts:1)")[0], root).status, "fail");
    assert.equal(checkCitation(findCitations("`x` (engine.ts:99)")[0], root).status, "fail");
  });

  test("ranges span lines and strict spans shadow bare matches", () => {
    const root = seedRepo();
    const rows = findCitations("`buildTotals` (engine.ts:1-2)");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].end, 2);
    assert.equal(checkCitation(rows[0], root).status, "pass");
  });

  test("extracts text deltas from opencode json logs, raw text otherwise", () => {
    const jsonl = [
      JSON.stringify({ type: "step_start" }),
      JSON.stringify({ type: "message", part: { type: "text", text: "see `x` (a.ts:1)" } }),
    ].join("\n");
    assert.equal(extractPanelText(jsonl), "see `x` (a.ts:1)");
    assert.equal(extractPanelText("plain `x` (a.ts:1) text"), "plain `x` (a.ts:1) text");
  });

  test("checkLogs aggregates across files", () => {
    const root = seedRepo();
    const log = join(root, "panel.log");
    writeFileSync(
      log,
      JSON.stringify({
        part: {
          type: "text",
          text: "`buildTotals` (engine.ts:1) ok, `nope` (engine.ts:2) bad",
        },
      }),
    );
    const results = checkLogs([log], root);
    assert.deepEqual(
      results.map((row) => row.status),
      ["pass", "fail"],
    );
  });
});

describe("check-receipts basename fallback", () => {
  test("resolves basenames against the repo tree", () => {
    const root = dir();
    mkdirSync(join(root, "sub"));
    writeFileSync(join(root, "sub", "util.ts"), "const a = 1;\n");
    const [row] = findCitations("see util.ts:1");
    const result = checkCitation(row, root);
    assert.equal(result.status, "pass");
    assert.equal(result.path.endsWith(join("sub", "util.ts")), true);
  });

  test("ambiguous basenames fail closed", () => {
    const root = dir();
    mkdirSync(join(root, "a"));
    mkdirSync(join(root, "b"));
    writeFileSync(join(root, "a", "dup.ts"), "x\n");
    writeFileSync(join(root, "b", "dup.ts"), "x\n");
    const result = checkCitation(findCitations("see dup.ts:1")[0], root);
    assert.equal(result.status, "fail");
    assert.ok(result.reason.includes("ambiguous"));
  });
});

describe("check-receipts command line", () => {
  const script = join(import.meta.dirname, "../scripts/check-receipts.mjs");

  test("exits 0 when every citation holds, 1 when one fails, 2 when none are found", () => {
    const root = seedRepo();
    const run = (text) => {
      const log = join(root, "panel.txt");
      writeFileSync(log, text);
      return spawnSync("node", [script, "--repo", root, log], { encoding: "utf8" }).status;
    };
    assert.equal(run("`buildTotals` (engine.ts:1)"), 0);
    assert.equal(run("`buildTotals` (engine.ts:2)"), 1);
    assert.equal(run("no citations here"), 2);
  });
});

describe("check-receipts edge cases", () => {
  test("a JSON example line in a plain reply does not hide its citations", () => {
    const raw = 'see `buildTotals` (engine.ts:1)\n{"example": true}\nand engine.ts:2';
    assert.equal(findCitations(extractPanelText(raw)).length, 2);
  });

  test("a final newline does not add a line to cite", () => {
    const root = seedRepo();
    assert.equal(checkCitation(findCitations("engine.ts:2")[0], root).status, "pass");
    const past = checkCitation(findCitations("engine.ts:3")[0], root);
    assert.equal(past.status, "fail");
    assert.ok(past.reason.includes("past EOF"));
  });

  test("a citation to a file outside the repository fails", () => {
    const root = seedRepo();
    const other = dir();
    writeFileSync(join(other, "secret.ts"), "x\n");
    const cited = relative(root, join(other, "secret.ts")).split(sep).join("/");
    const result = checkCitation(findCitations(`${cited}:1`)[0], root);
    assert.equal(result.status, "fail");
    assert.ok(result.reason.includes("outside"));
  });

  test("tsx and css citations are found", () => {
    const rows = findCitations("see App.tsx:3 and `.box` (style.css:9)");
    assert.deepEqual(
      rows.map((row) => row.file),
      ["style.css", "App.tsx"],
    );
  });

  test("an unreadable log exits 2", () => {
    const root = seedRepo();
    const script = join(import.meta.dirname, "../scripts/check-receipts.mjs");
    const run = spawnSync("node", [script, "--repo", root, join(root, "missing.log")], {
      encoding: "utf8",
    });
    assert.equal(run.status, 2);
  });

  test("a subpath citation written with backslashes resolves", () => {
    const root = dir();
    mkdirSync(join(root, "a"));
    mkdirSync(join(root, "b"));
    writeFileSync(join(root, "a", "dup.ts"), "x\ny\n");
    writeFileSync(join(root, "b", "dup.ts"), "x\n");
    const [row] = findCitations("see a\\dup.ts:2");
    assert.equal(row.file, "a\\dup.ts");
    assert.equal(checkCitation(row, root).status, "pass");
  });

  test(
    "a symlink inside the repository that points outside fails",
    { skip: process.platform === "win32" },
    () => {
      const root = seedRepo();
      const other = dir();
      writeFileSync(join(other, "secret.ts"), "export const hidden = 1;\n");
      symlinkSync(join(other, "secret.ts"), join(root, "link.ts"));
      const result = checkCitation(findCitations("`hidden` (link.ts:1)")[0], root);
      assert.equal(result.status, "fail");
      assert.ok(result.reason.includes("outside"));
    },
  );
});
