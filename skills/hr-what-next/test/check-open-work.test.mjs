import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dirname, "..", "scripts", "check-open-work.mjs");
const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// notes/plans/<topic>/plan.md with notes/tmp beside it, the layout the plan-files rule describes.
function setup({ status = "active", ledger = [], extra = "", owner = "Alice, session 7" } = {}) {
  const notes = mkdtempSync(join(process.env.HOUSE_RULES_TEST_TMP ?? tmpdir(), "open-work-"));
  roots.push(notes);
  const topic = join(notes, "plans", "demo");
  mkdirSync(topic, { recursive: true });
  const body = [`Owner: ${owner}`, `Status: ${status}`, "", "## Ledger", ...ledger, "", extra].join(
    "\n",
  );
  writeFileSync(join(topic, "plan.md"), body);
  return { notes, topic, plan: join(topic, "plan.md") };
}

function check(plan, ...args) {
  const run = spawnSync("node", [script, plan, "--json", ...args], { encoding: "utf8" });
  return {
    code: run.status,
    report: run.stdout ? JSON.parse(run.stdout) : null,
    stderr: run.stderr,
  };
}

function scratch(notes, name, owner) {
  mkdirSync(join(notes, "tmp", name), { recursive: true });
  writeFileSync(join(notes, "tmp", name, "manifest.json"), JSON.stringify({ owner }));
}

function repository(directory, commits = 1) {
  mkdirSync(directory, { recursive: true });
  const git = (...args) =>
    spawnSync("git", ["-C", directory, "-c", "user.name=t", "-c", "user.email=t@t", ...args]);
  git("init", "-q", "-b", "main");
  for (let i = 0; i < commits; i++) git("commit", "-q", "--allow-empty", "-m", `c${i}`);
}

test("open and deferred items are listed and make the exit code 2", () => {
  const { plan } = setup({
    ledger: [
      "- [ ] a: unanswered decision",
      "- [~] b: later - trigger: next failure",
      "- [x] c: shipped - evidence: PR 1",
    ],
  });
  const { code, report } = check(plan);
  expect(code).toBe(2);
  expect(report.open).toHaveLength(2);
  expect(report.open[1]).toContain("[~]");
});

test("all items done under a completed status is the only clean result", () => {
  const { plan } = setup({
    status: "completed",
    ledger: ["- [x] a: shipped - evidence: PR 1", "- [-] b: dropped - by: user, message 4"],
  });
  const { code, report } = check(plan);
  expect(code).toBe(0);
  expect(report.open).toEqual([]);
});

test("a completed status over an open item is a finding", () => {
  const { plan } = setup({
    status: "completed",
    ledger: ["- [x] a: shipped - evidence: x", "- [ ] b: forgotten"],
  });
  const { code, report } = check(plan);
  expect(code).toBe(2);
  expect(report.findings.join("\n")).toContain('Status says "completed"');
});

test("items need the field their state implies", () => {
  const { plan } = setup({ ledger: ["- [~] a: later", "- [x] b: said done", "- [-] c: dropped"] });
  const { code, report } = check(plan);
  expect(code).toBe(1);
  expect(report.errors.map((e) => e.match(/needs `(\w+):`/)[1]).sort()).toEqual([
    "by",
    "evidence",
    "trigger",
  ]);
});

test("a plan without a ledger, items, status or owner is invalid", () => {
  const { plan } = setup({ ledger: [] });
  expect(check(plan).report.errors.join("\n")).toContain("no items");
  const bare = setup();
  writeFileSync(bare.plan, "# notes\n\n- [ ] something\n");
  const { code, report } = check(bare.plan);
  expect(code).toBe(1);
  expect(report.errors.join("\n")).toMatch(/Status.*Owner.*Ledger|Status[\s\S]*Ledger/);
});

test("owned scratch must be named by an item that is still open", () => {
  const { notes, plan } = setup({
    status: "completed",
    ledger: ["- [x] a: shipped - evidence: x"],
  });
  scratch(notes, "big-copy", "Alice");
  scratch(notes, "other-copy", "Bob");
  scratch(notes, "word-copy", "session"); // a word of "Alice, session 7", not an identity in it
  let { code, report } = check(plan);
  expect(code).toBe(2);
  expect(report.findings).toEqual(["scratch big-copy is not named in any ledger item"]);

  writeFileSync(
    plan,
    `Owner: Alice\nStatus: completed\n\n## Ledger\n- [x] clean: big-copy removed - evidence: rm\n`,
  );
  ({ code, report } = check(plan));
  expect(report.findings[0]).toContain("still exists but its ledger item is done");

  writeFileSync(
    plan,
    `Owner: Alice\nStatus: active\n\n## Ledger\n- [~] keep: big-copy kept - trigger: 2026-10-16\n`,
  );
  ({ code, report } = check(plan));
  expect(report.findings).toEqual([]);
  expect(report.open).toHaveLength(1);

  rmSync(join(notes, "tmp", "big-copy"), { recursive: true });
  writeFileSync(
    plan,
    `Owner: Alice\nStatus: completed\n\n## Ledger\n- [x] clean: big-copy removed - evidence: rm\n`,
  );
  expect(check(plan).code).toBe(0);
});

test("a dirty or unpushed checkout must be named by an open item", () => {
  const { notes, plan } = setup({
    status: "completed",
    ledger: ["- [x] a: shipped - evidence: x"],
  });
  const checkout = join(notes, "work");
  repository(checkout, 2);
  let { code, report } = check(plan, "--checkout", checkout);
  expect(code).toBe(2);
  expect(report.findings[0]).toContain("2 unpushed commit(s)");

  writeFileSync(
    plan,
    `Owner: Alice\nStatus: active\n\n## Ledger\n- [ ] land: ${checkout} commits - next: open a PR\n`,
  );
  ({ code, report } = check(plan, "--checkout", checkout));
  expect(report.findings).toEqual([]);
  expect(report.open).toHaveLength(1);
});

test("archiving moves only a completed plan with nothing open", () => {
  const active = setup({ status: "active", ledger: ["- [x] a: shipped - evidence: x"] });
  let { code, report } = check(active.plan, "--archive");
  expect(code).toBe(2);
  expect(report.findings[0]).toContain("archiving refused");
  expect(existsSync(active.plan)).toBe(true);

  const open = setup({ status: "completed", ledger: ["- [ ] a: still open"] });
  expect(check(open.plan, "--archive").code).toBe(2);
  expect(existsSync(open.plan)).toBe(true);

  const done = setup({ status: "completed", ledger: ["- [x] a: shipped - evidence: x"] });
  ({ code, report } = check(done.plan, "--archive"));
  expect(code).toBe(0);
  expect(existsSync(done.plan)).toBe(false);
  expect(readdirSync(join(done.notes, "plans", "archive"))[0]).toMatch(/^demo-\d{4}-\d\d-\d\d$/);
  expect(report.archived).toContain(join("plans", "archive"));
});

test("marker lines outside the ledger warn but do not change the result", () => {
  const { plan } = setup({
    status: "completed",
    ledger: ["- [x] a: shipped - evidence: x"],
    extra: "## Notes\n- pending: an old line\n- [ ] stray box\n",
  });
  const { code, report } = check(plan);
  expect(code).toBe(0);
  expect(report.warnings).toHaveLength(2);
});
