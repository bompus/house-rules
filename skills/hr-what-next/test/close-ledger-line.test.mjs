import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dirname, "..", "scripts", "close-ledger-line.mjs");
const checker = join(import.meta.dirname, "..", "scripts", "check-open-work.mjs");
const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// Ledger lines start at L6, as in check-open-work.test.mjs.
function setup(ledger, { eol = "\n", after = [] } = {}) {
  const root = mkdtempSync(join(process.env.HOUSE_RULES_TEST_TMP ?? tmpdir(), "close-line-"));
  roots.push(root);
  const plan = join(root, "plan.md");
  const body = [
    "Owner: Alice",
    "Status: active",
    "Purpose: demo",
    "",
    "## Ledger",
    ...ledger,
    "",
    ...after,
  ].join(eol);
  writeFileSync(plan, body);
  return plan;
}

const close = (plan, ...args) =>
  spawnSync("node", [script, plan, "--time", "2026-10-18 17:05 -06:00", ...args], {
    encoding: "utf8",
  });
const lines = (plan) => readFileSync(plan, "utf8").split(/\r?\n/);

test("closing a line by number marks it done in place with the evidence and the time", () => {
  const plan = setup([
    "- [ ] a: wait for acme/tool#5 recheck: 2026-10-01",
    "- [~] b: later trigger: release",
  ]);
  const run = close(plan, "--line", "6", "--evidence", "acme/tool#5 merged as 1a2b3c4");
  expect(run.status).toBe(0);
  expect(lines(plan)[5]).toBe(
    "- [x] a: wait for acme/tool#5 recheck: 2026-10-01 … evidence: acme/tool#5 merged as 1a2b3c4 (closed 2026-10-18 17:05 -06:00)",
  );
  expect(lines(plan)[6]).toBe("- [~] b: later trigger: release");
  // The checker accepts the closed line and no longer counts it.
  const report = JSON.parse(
    spawnSync("node", [checker, plan, "--json", "--offline"], { encoding: "utf8" }).stdout,
  );
  expect(report.errors).toEqual([]);
  expect(report.open).toEqual([expect.stringMatching(/^L7 /)]);
});

test("a deferred line can be closed, and a line can be found by a unique piece of its text", () => {
  const plan = setup(["- [ ] a: one", "- [~] b: ship the docs trigger: release"]);
  const run = close(plan, "--match", "ship the docs", "--evidence", "docs shipped in 0.17.0");
  expect(run.status).toBe(0);
  expect(lines(plan)[6]).toMatch(/^- \[x\] b: ship the docs trigger: release … evidence: docs/);
});

test("a line can be dropped with who dropped it", () => {
  const plan = setup(["- [ ] a: maybe rename the tool"]);
  const run = close(plan, "--line", "6", "--drop", "--by", "user, not selected");
  expect(run.status).toBe(0);
  expect(lines(plan)[5]).toBe(
    "- [-] a: maybe rename the tool … by: user, not selected (dropped 2026-10-18 17:05 -06:00)",
  );
});

test("a second identical run changes nothing and says so", () => {
  const plan = setup(["- [ ] a: wait for acme/tool#5"]);
  close(plan, "--line", "6", "--evidence", "merged");
  const before = readFileSync(plan, "utf8");
  for (const args of [
    ["--line", "6", "--evidence", "merged"],
    ["--match", "wait for acme/tool#5", "--evidence", "merged"],
  ]) {
    const again = spawnSync("node", [script, plan, ...args], { encoding: "utf8" });
    expect(again.status).toBe(0);
    expect(again.stdout).toMatch(/already done/);
    expect(readFileSync(plan, "utf8")).toBe(before);
  }
  const drop = setup(["- [ ] a: maybe"]);
  close(drop, "--line", "6", "--drop", "--by", "user");
  const dropped = readFileSync(drop, "utf8");
  expect(close(drop, "--line", "6", "--drop", "--by", "user").status).toBe(0);
  expect(readFileSync(drop, "utf8")).toBe(dropped);
});

test("it refuses without evidence, without who dropped it, or with both", () => {
  const plan = setup(["- [ ] a: one"]);
  const before = readFileSync(plan, "utf8");
  for (const args of [
    ["--line", "6"],
    ["--line", "6", "--evidence", "  "],
    ["--line", "6", "--drop"],
    ["--line", "6", "--drop", "--by", ""],
    ["--line", "6", "--drop", "--by", "user", "--evidence", "x"],
    ["--evidence", "x"],
    ["--line", "6", "--match", "one", "--evidence", "x"],
  ]) {
    const run = close(plan, ...args);
    expect(run.status).toBe(1);
    expect(run.stderr).not.toBe("");
  }
  expect(readFileSync(plan, "utf8")).toBe(before);
});

test("it refuses a line outside the ledger, a closed line with other evidence, and an unclear match", () => {
  const plan = setup(
    [
      "- [ ] a: wait for the review",
      "- [ ] b: wait for the review again",
      "- [x] c: done evidence: x",
    ],
    { after: ["## Notes", "- [ ] stray box outside the ledger"] },
  );
  const before = readFileSync(plan, "utf8");
  const cases = [
    [["--line", "3", "--evidence", "x"], /not a ledger item/],
    [["--line", "11", "--evidence", "x"], /not a ledger item/],
    [["--line", "8", "--evidence", "y"], /already done/],
    [
      ["--match", "wait for the review", "--evidence", "x"],
      /2 open or deferred ledger lines match/,
    ],
    [["--match", "nothing like this", "--evidence", "x"], /no open or deferred ledger line/],
  ];
  for (const [args, message] of cases) {
    const run = close(plan, ...args);
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(message);
  }
  expect(readFileSync(plan, "utf8")).toBe(before);
});

test("a wrapped item gets its evidence on its last line, and Windows line endings survive", () => {
  const plan = setup(["- [ ] a: wait for the long", "  review to finish", "- [ ] b: other"], {
    eol: "\r\n",
  });
  expect(close(plan, "--line", "6", "--evidence", "reviewed").status).toBe(0);
  const text = readFileSync(plan, "utf8");
  expect(text.split("\r\n").slice(5, 8)).toEqual([
    "- [x] a: wait for the long",
    "  review to finish … evidence: reviewed (closed 2026-10-18 17:05 -06:00)",
    "- [ ] b: other",
  ]);
  expect(text.replace(/\r\n/g, "")).not.toMatch(/\n/);
});

test("without --time it stamps the local time with its UTC offset", () => {
  const plan = setup(["- [ ] a: one"]);
  expect(
    spawnSync("node", [script, plan, "--line", "6", "--evidence", "x"], { encoding: "utf8" })
      .status,
  ).toBe(0);
  expect(lines(plan)[5]).toMatch(
    /^- \[x\] a: one … evidence: x \(closed \d{4}-\d{2}-\d{2} \d{2}:\d{2} [+-]\d{2}:\d{2}\)$/,
  );
});
