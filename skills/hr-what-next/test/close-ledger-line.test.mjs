import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dirname, "..", "scripts", "close-ledger-line.mjs");
const checker = join(import.meta.dirname, "..", "scripts", "check-open-work.mjs");
/** @type {string[]} */
const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

// Ledger lines start at L6, as in check-open-work.test.mjs.
/** @param {string[]} ledger @param {{ eol?: string, after?: string[] }} [options] */
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

/** @param {string} plan @param {...string} args */
const close = (plan, ...args) =>
  spawnSync(process.execPath, [script, plan, "--time", "2026-10-18 17:05 -06:00", ...args], {
    encoding: "utf8",
  });
/** @param {string} plan */
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
    spawnSync(process.execPath, [checker, plan, "--json", "--offline"], { encoding: "utf8" })
      .stdout,
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

test("a line the user dropped records where they answered about it", () => {
  const plan = setup(["- [ ] a: maybe rename the tool"]);
  const run = close(
    plan,
    "--line",
    "6",
    "--drop",
    "--by",
    "user",
    "--asked",
    "offer RENAME-TOOL-1",
  );
  expect(run.status).toBe(0);
  expect(lines(plan)[5]).toBe(
    "- [-] a: maybe rename the tool … by: user, asked in offer RENAME-TOOL-1 (dropped 2026-10-18 17:05 -06:00)",
  );
});

test("a flag cannot stand in for the asking location", () => {
  const plan = setup(["- [ ] a: maybe rename the tool"]);
  const before = readFileSync(plan, "utf8");
  const result = close(plan, "--line", "6", "--drop", "--by", "user", "--asked", "--drop");
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("--asked needs a value");
  expect(readFileSync(plan, "utf8")).toBe(before);
});

test("a line someone else dropped needs no record of asking", () => {
  const plan = setup(["- [ ] a: maybe rename the tool"]);
  expect(close(plan, "--line", "6", "--drop", "--by", "superseded by #12").status).toBe(0);
  expect(lines(plan)[5]).toBe(
    "- [-] a: maybe rename the tool … by: superseded by #12 (dropped 2026-10-18 17:05 -06:00)",
  );
});

test("a drop by the user without a record of asking is refused, and so is --asked for others", () => {
  const plan = setup(["- [ ] a: maybe rename the tool"]);
  const before = readFileSync(plan, "utf8");
  const bulk = close(plan, "--line", "6", "--drop", "--by", "user, not selected");
  expect(bulk.status).toBe(1);
  expect(bulk.stderr).toMatch(/needs --asked/);
  const other = close(plan, "--line", "6", "--drop", "--by", "Bob", "--asked", "offer X-1");
  expect(other.status).toBe(1);
  expect(other.stderr).toMatch(/--asked goes with a drop by the user/);
  expect(readFileSync(plan, "utf8")).toBe(before);
});

test("a second identical run changes nothing and says so", () => {
  const plan = setup(["- [ ] a: wait for acme/tool#5"]);
  close(plan, "--line", "6", "--evidence", "merged");
  const before = readFileSync(plan, "utf8");
  for (const args of [
    ["--line", "6", "--evidence", "merged"],
    ["--match", "wait for acme/tool#5", "--evidence", "merged"],
  ]) {
    const again = spawnSync(process.execPath, [script, plan, ...args], { encoding: "utf8" });
    expect(again.status).toBe(0);
    expect(again.stdout).toMatch(/already done/);
    expect(readFileSync(plan, "utf8")).toBe(before);
  }
  const drop = setup(["- [ ] a: maybe"]);
  close(drop, "--line", "6", "--drop", "--by", "user", "--asked", "offer MAYBE-1");
  const dropped = readFileSync(drop, "utf8");
  expect(
    close(drop, "--line", "6", "--drop", "--by", "user", "--asked", "offer MAYBE-1").status,
  ).toBe(0);
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
  /** @type {[string[], RegExp][]} */
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
    spawnSync(process.execPath, [script, plan, "--line", "6", "--evidence", "x"], {
      encoding: "utf8",
    }).status,
  ).toBe(0);
  expect(lines(plan)[5]).toMatch(
    /^- \[x\] a: one … evidence: x \(closed \d{4}-\d{2}-\d{2} \d{2}:\d{2} [+-]\d{2}:\d{2}\)$/,
  );
});

test("a retry whose note is only a prefix of the recorded one is refused, not reported as done", () => {
  const plan = setup(["- [ ] a: one", "- [ ] b: two"]);
  close(plan, "--line", "6", "--evidence", "merged another PR");
  close(plan, "--line", "7", "--drop", "--by", "Bobby");
  const before = readFileSync(plan, "utf8");
  for (const args of [
    ["--line", "6", "--evidence", "merged"],
    ["--line", "7", "--drop", "--by", "Bob"],
  ]) {
    const run = close(plan, ...args);
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/different note/);
  }
  expect(readFileSync(plan, "utf8")).toBe(before);
});

test("a note with a line break is refused", () => {
  const plan = setup(["- [ ] a: one"]);
  const before = readFileSync(plan, "utf8");
  for (const args of [
    ["--line", "6", "--evidence", "tests passed\nbuild passed"],
    ["--line", "6", "--drop", "--by", "user\r\nagain"],
    ["--match", "one\ntwo", "--evidence", "x"],
  ]) {
    const run = close(plan, ...args);
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/one line/);
  }
  expect(readFileSync(plan, "utf8")).toBe(before);
});

test("--expect-exact also refuses a change in the whitespace inside the line", () => {
  const plan = setup(["- [ ] a: remove /work/a  b", "- [ ] b"]);
  const changed = close(
    plan,
    "--line",
    "6",
    "--evidence",
    "gone",
    "--expect-exact",
    "a: remove /work/a b",
  );
  expect(changed.status).toBe(1);
  expect(changed.stderr).toContain("no longer reads as expected");
  expect(lines(plan)[5]).toBe("- [ ] a: remove /work/a  b");
  const same = close(
    plan,
    "--line",
    "6",
    "--evidence",
    "gone",
    "--expect-exact",
    "a: remove /work/a  b",
  );
  expect(same.status).toBe(0);
  expect(lines(plan)[5]).toMatch(/^- \[x\] a: remove \/work\/a {2}b … evidence: gone/);
});

test("--expect closes the line only while it still reads as the caller saw it", () => {
  const plan = setup(["- [ ] a:  wait for the release", "- [ ] b"]);
  const changed = close(
    plan,
    "--line",
    "6",
    "--evidence",
    "shipped",
    "--expect",
    "a: wait for the review",
  );
  expect(changed.status).toBe(1);
  expect(changed.stderr).toContain("no longer reads as expected");
  expect(lines(plan)[5]).toBe("- [ ] a:  wait for the release");
  const same = close(
    plan,
    "--line",
    "6",
    "--evidence",
    "shipped",
    "--expect",
    "a: wait for the release",
  );
  expect(same.status).toBe(0);
  expect(lines(plan)[5]).toContain("- [x] a:  wait for the release … evidence: shipped");
});
