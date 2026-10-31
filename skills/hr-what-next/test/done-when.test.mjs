import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePlan, planSnapshot } from "../scripts/plan-ledger.mjs";

const script = join(import.meta.dirname, "..", "scripts", "done-when.mjs");
const checker = join(import.meta.dirname, "..", "scripts", "check-open-work.mjs");
// The stand-in `gh` below is a shebang script, which Windows cannot run from PATH.
const posixOnly = test.skipIf(process.platform === "win32");
/** @type {string[]} */
const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

/** @param {string[]} ledger */
function planText(ledger) {
  return ["Owner: Alice", "Status: active", "Purpose: demo", "", "## Ledger", ...ledger, ""].join(
    "\n",
  );
}

// Ledger lines start at L6, as in the other tests of this skill.
/** @param {string[]} ledger */
function setup(ledger) {
  const root = mkdtempSync(join(process.env.HOUSE_RULES_TEST_TMP ?? tmpdir(), "done-when-"));
  roots.push(root);
  const plan = join(root, "plans", "demo", "plan.md");
  mkdirSync(join(root, "plans", "demo"), { recursive: true });
  writeFileSync(plan, planText(ledger));
  return { root, plan };
}

// A stand-in `gh` on PATH: answers `gh api repos/<o>/<r>/issues/<n>` from a map of "o/r#n" to
// "open", "merged" (a merged pull request), "closed-pr" (a pull request closed without merging) or
// "closed-issue", and fails like an offline host on "fail".
/** @param {Record<string, string | boolean>} states */
function fakeGh(states) {
  const bin = mkdtempSync(join(process.env.HOUSE_RULES_TEST_TMP ?? tmpdir(), "done-when-bin-"));
  roots.push(bin);
  writeFileSync(join(bin, "states.json"), JSON.stringify(states));
  writeFileSync(
    join(bin, "gh"),
    [
      `#!${process.execPath}`,
      'const { appendFileSync, readFileSync } = require("node:fs");',
      'const { join } = require("node:path");',
      'appendFileSync(join(__dirname, "calls.log"), process.argv.slice(2).join(" ") + "\\n");',
      'const states = JSON.parse(readFileSync(join(__dirname, "states.json"), "utf8"));',
      'if (states.fail) { console.error("error connecting to api.github.com"); process.exit(1); }',
      "const [, owner, repo, , number] = process.argv[3].split('/');",
      "const state = states[`${owner}/${repo}#${number}`];",
      'if (!state) { console.error("gh: Not Found (HTTP 404)"); process.exit(1); }',
      "const at = '2026-10-30T12:00:00Z';",
      "const body = {",
      "  open: { state: 'open', pull_request: {} },",
      "  merged: { state: 'closed', closed_at: at, pull_request: { merged_at: at } },",
      "  'closed-pr': { state: 'closed', closed_at: at, pull_request: { merged_at: null } },",
      "  'closed-issue': { state: 'closed', closed_at: at },",
      "  'open-issue': { state: 'open' },",
      "}[state];",
      "console.log(JSON.stringify(body));",
    ].join("\n"),
    { mode: 0o755 },
  );
  const calls = () =>
    existsSync(join(bin, "calls.log"))
      ? readFileSync(join(bin, "calls.log"), "utf8").split("\n").filter(Boolean)
      : [];
  return { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, calls };
}

/** @param {NodeJS.ProcessEnv} env @param {string} plan @param {...string} args */
function run(env, plan, ...args) {
  const result = spawnSync(process.execPath, [script, plan, ...args], { encoding: "utf8", env });
  return { code: result.status, out: result.stdout, err: result.stderr };
}
/** @param {string} plan */
const lines = (plan) => readFileSync(plan, "utf8").split("\n");

test("a ledger item exposes its done-when conditions as a parsed field", () => {
  const { items } = parsePlan(
    planText([
      "- [ ] a: ship acme/tool#5 done-when: pr-merged acme/tool#5; issue-closed acme/tool#6.",
      "- [~] b: later ... trigger: x done-when: path-absent ~/scratch/topic dir",
      "- [ ] c: no clause",
      "- [ ] d: wrapped clause done-when: pr-merged acme/tool#7;",
      "      path-absent /tmp/x",
    ]),
  );
  expect(items.map((item) => item.doneWhen)).toEqual([
    {
      conditions: [
        { kind: "pr-merged", repo: "acme/tool", number: 5 },
        { kind: "issue-closed", repo: "acme/tool", number: 6 },
      ],
    },
    { conditions: [{ kind: "path-absent", path: "~/scratch/topic dir" }] },
    undefined,
    {
      conditions: [
        { kind: "pr-merged", repo: "acme/tool", number: 7 },
        { kind: "path-absent", path: "/tmp/x" },
      ],
    },
  ]);
});

test("a clause that cannot be read is an error, never an empty condition list", () => {
  const { items } = parsePlan(
    planText([
      "- [ ] a: done-when: merged acme/tool#5",
      "- [ ] b: done-when: pr-merged acme/tool",
      "- [ ] c: done-when: path-absent relative/dir",
      "- [ ] d: done-when:",
      "- [ ] e: done-when: pr-merged acme/tool#5; ; issue-closed acme/tool#6",
    ]),
  );
  for (const item of items) {
    expect(item.doneWhen).toEqual({ error: expect.any(String) });
  }
});

test("done-when inside backticks is prose about the convention, not a clause", () => {
  const { items } = parsePlan(
    planText([
      "- [ ] a: lines may end with `done-when: pr-merged owner/repo#n` and the check reads it",
      "- [ ] b: the `done-when` field is parsed",
    ]),
  );
  expect(items.map((item) => item.doneWhen)).toEqual([undefined, undefined]);
});

test("the continuity snapshot of an open item does not carry the parsed clause", () => {
  const snapshot = planSnapshot(planText(["- [ ] a: done-when: pr-merged acme/tool#5"]));
  expect(Object.keys(snapshot.openItems[0] ?? {})).not.toContain("doneWhen");
});

posixOnly("without --apply it reports each line and changes nothing", () => {
  const dir = root0();
  const { plan } = setup([
    "- [ ] a: land done-when: pr-merged acme/tool#1",
    "- [ ] b: land done-when: pr-merged acme/tool#2",
    `- [ ] c: remove done-when: path-absent ${join(dir, "gone")}`,
    "- [ ] d: no clause",
  ]);
  const before = readFileSync(plan, "utf8");
  const { env } = fakeGh({ "acme/tool#1": "merged", "acme/tool#2": "open" });
  const result = run(env, plan);
  expect(result.code).toBe(0);
  expect(result.out).toContain("L6 closeable: pr-merged acme/tool#1: merged 2026-10-30T12:00:00Z");
  expect(result.out).toContain("L7 pending: pr-merged acme/tool#2: still open");
  expect(result.out).toContain("L8 closeable: path-absent");
  expect(result.out).not.toContain("L9");
  expect(readFileSync(plan, "utf8")).toBe(before);
});

/** A directory that exists and has nothing at ./gone. */
function root0() {
  const root = mkdtempSync(join(process.env.HOUSE_RULES_TEST_TMP ?? tmpdir(), "done-when-path-"));
  roots.push(root);
  return root;
}

posixOnly("--apply closes only the closeable lines, with the evidence found", () => {
  const { plan } = setup([
    "- [ ] a: land done-when: pr-merged acme/tool#1",
    "- [~] b: park ... trigger: x done-when: issue-closed acme/tool#3",
    "- [ ] c: land done-when: pr-merged acme/tool#2",
  ]);
  const { env } = fakeGh({
    "acme/tool#1": "merged",
    "acme/tool#2": "open",
    "acme/tool#3": "closed-issue",
  });
  const result = run(env, plan, "--apply");
  expect(result.code).toBe(0);
  const text = lines(plan);
  expect(text[5]).toMatch(
    /^- \[x\] a: land done-when: pr-merged acme\/tool#1 … evidence: done-when held: pr-merged acme\/tool#1: merged 2026-10-30T12:00:00Z \(closed /,
  );
  expect(text[6]).toMatch(
    /^- \[x\] b: park .* … evidence: done-when held: issue-closed acme\/tool#3: closed 2026-10-30T12:00:00Z/,
  );
  expect(text[7]).toBe("- [ ] c: land done-when: pr-merged acme/tool#2");
  // A second run has nothing left to close and changes nothing.
  const after = readFileSync(plan, "utf8");
  const again = run(env, plan, "--apply");
  expect(again.code).toBe(0);
  expect(readFileSync(plan, "utf8")).toBe(after);
});

posixOnly("every condition must hold: one that does not leaves the line open", () => {
  const dir = root0();
  const { plan } = setup([
    `- [ ] a: land done-when: pr-merged acme/tool#1; path-absent ${dir}`,
    `- [ ] b: land done-when: pr-merged acme/tool#1; path-absent ${join(dir, "gone")}`,
  ]);
  const { env } = fakeGh({ "acme/tool#1": "merged" });
  const result = run(env, plan, "--apply");
  expect(result.out).toContain(
    `L6 pending: pr-merged acme/tool#1: merged 2026-10-30T12:00:00Z; path-absent ${dir}: still exists`,
  );
  expect(result.out).toContain("L7 closeable");
  expect(lines(plan)[5]).toMatch(/^- \[ \] a:/);
  expect(lines(plan)[6]).toMatch(/^- \[x\] b:/);
});

posixOnly("a lookup that fails is an error row and is never closed", () => {
  const { plan } = setup([
    "- [ ] a: land done-when: pr-merged acme/tool#1",
    "- [ ] b: land done-when: pr-merged acme/tool#9",
  ]);
  const before = readFileSync(plan, "utf8");
  const unreachable = run(fakeGh({ fail: true }).env, plan, "--apply");
  expect(unreachable.code).toBe(1);
  expect(unreachable.out).toMatch(/L6 error: .*GitHub check skipped/);
  expect(unreachable.out).toMatch(/L7 error: .*GitHub check skipped/);
  expect(readFileSync(plan, "utf8")).toBe(before);
  // Reachable, but one reference GitHub does not know.
  const missing = run(fakeGh({ "acme/tool#1": "merged" }).env, plan, "--apply");
  expect(missing.code).toBe(1);
  expect(missing.out).toContain("L7 error: pr-merged acme/tool#9: not found");
  expect(lines(plan)[5]).toMatch(/^- \[x\] a:/);
  expect(lines(plan)[6]).toMatch(/^- \[ \] b:/);
});

posixOnly("a pull request and an issue are not interchangeable", () => {
  const { plan } = setup([
    "- [ ] a: done-when: issue-closed acme/tool#1",
    "- [ ] b: done-when: pr-merged acme/tool#2",
    "- [ ] c: done-when: pr-merged acme/tool#3",
  ]);
  const result = run(
    fakeGh({ "acme/tool#1": "merged", "acme/tool#2": "closed-issue", "acme/tool#3": "closed-pr" })
      .env,
    plan,
    "--apply",
  );
  expect(result.out).toContain("L6 error: issue-closed acme/tool#1: is a pull request");
  expect(result.out).toContain("L7 error: pr-merged acme/tool#2: is an issue, not a pull request");
  expect(result.out).toContain("L8 pending: pr-merged acme/tool#3: closed without merging");
  expect(readFileSync(plan, "utf8")).not.toContain("[x]");
});

posixOnly("path-absent counts only a missing path as absent", () => {
  const dir = root0();
  writeFileSync(join(dir, "file"), "x");
  symlinkSync(join(dir, "a"), join(dir, "b"));
  symlinkSync(join(dir, "b"), join(dir, "a"));
  const { plan } = setup([
    `- [ ] a: done-when: path-absent ${join(dir, "missing")}`,
    `- [ ] b: done-when: path-absent ${join(dir, "file", "below")}`,
    `- [ ] c: done-when: path-absent ${join(dir, "file")}`,
    `- [ ] d: done-when: path-absent ${join(dir, "a", "below")}`,
    `- [ ] e: done-when: path-absent ${join(dir, "dangling")}`,
  ]);
  symlinkSync(join(dir, "nowhere"), join(dir, "dangling"));
  const result = run(process.env, plan, "--apply");
  expect(result.out).toContain("L6 closeable");
  expect(result.out).toContain("L7 closeable");
  expect(result.out).toContain("L8 pending");
  // A symlink loop is an access error, not absence.
  expect(result.out).toMatch(/L9 error: .*ELOOP|L9 error:/);
  // A dangling link is still something at the path.
  expect(result.out).toContain("L10 pending");
  expect(result.code).toBe(1);
  const text = lines(plan);
  expect(text.slice(5, 7).every((line) => line.startsWith("- [x]"))).toBe(true);
  expect(text.slice(7, 10).every((line) => line.startsWith("- [ ]"))).toBe(true);
});

test("a clause that cannot be read never closes, and a path must be absolute", () => {
  const { plan } = setup([
    "- [ ] a: done-when: merged acme/tool#5",
    "- [ ] b: done-when: path-absent relative/dir",
  ]);
  const before = readFileSync(plan, "utf8");
  const result = run(process.env, plan, "--apply");
  expect(result.code).toBe(1);
  expect(result.out).toContain('L6 error: unknown condition "merged acme/tool#5"');
  expect(result.out).toContain("L7 error: path must be absolute or start with ~/");
  expect(readFileSync(plan, "utf8")).toBe(before);
});

test("a done or dropped line with a clause is not evaluated", () => {
  const { plan } = setup([
    "- [x] a: done-when: pr-merged acme/tool#1 … evidence: shipped (closed 2026-10-30)",
    "- [-] b: done-when: pr-merged acme/tool#2 … by: Alice (dropped 2026-10-30)",
  ]);
  const result = run(process.env, plan);
  expect(result.code).toBe(0);
  expect(result.out).toBe("");
});

posixOnly("the open-work check lists each clause and still exits 2 for the open line", () => {
  const { plan } = setup([
    "- [ ] a: land done-when: pr-merged acme/tool#1",
    "- [ ] b: land done-when: pr-merged acme/tool#2",
  ]);
  const before = readFileSync(plan, "utf8");
  const { env } = fakeGh({ "acme/tool#1": "merged", "acme/tool#2": "open" });
  const result = spawnSync(process.execPath, [checker, plan, "--json"], { encoding: "utf8", env });
  expect(result.status).toBe(2);
  const report = JSON.parse(result.stdout);
  expect(report.doneWhen).toEqual([
    "L6 closeable: pr-merged acme/tool#1: merged 2026-10-30T12:00:00Z",
    "L7 pending: pr-merged acme/tool#2: still open",
  ]);
  expect(readFileSync(plan, "utf8")).toBe(before);
  // With --offline the lines are reported as unchecked, not closeable.
  const offline = spawnSync(process.execPath, [checker, plan, "--json", "--offline"], {
    encoding: "utf8",
    env,
  });
  expect(
    JSON.parse(offline.stdout).doneWhen.every((/** @type {string} */ row) =>
      /^L\d+ error: /.test(row),
    ),
  ).toBe(true);
});

test("the clause must be the last field, so a later field cannot become part of a path", () => {
  const dir = root0();
  const { plan } = setup([
    `- [ ] a: done-when: path-absent ${dir} recheck: 2026-11-01`,
    "- [ ] b: done-when: pr-merged acme/tool#5 trigger: later",
  ]);
  const before = readFileSync(plan, "utf8");
  const result = run(process.env, plan, "--apply");
  expect(result.code).toBe(1);
  expect(result.out).toContain(
    "L6 error: done-when must be the last field, but `recheck:` follows it",
  );
  expect(result.out).toContain(
    "L7 error: done-when must be the last field, but `trigger:` follows it",
  );
  expect(readFileSync(plan, "utf8")).toBe(before);
});

posixOnly("a path keeps its trailing dot", () => {
  const dir = root0();
  mkdirSync(join(dir, "kept."));
  const { plan } = setup([
    `- [ ] a: done-when: path-absent ${join(dir, "kept.")}`,
    `- [ ] b: done-when: path-absent ${join(dir, "kept")}`,
  ]);
  const result = run(process.env, plan);
  expect(result.out).toContain("L6 pending");
  expect(result.out).toContain("L7 closeable");
});

test("a path with a tab or consecutive spaces is refused, so the close cannot be redirected", () => {
  const { plan } = setup([
    "- [ ] a: done-when: path-absent /work/a  b",
    "- [ ] b: done-when: path-absent /work/a\tb",
  ]);
  const result = run(process.env, plan, "--apply");
  expect(result.code).toBe(1);
  expect(result.out).toContain("L6 error: path has a tab or consecutive spaces");
  expect(result.out).toContain("L7 error: path has a tab or consecutive spaces");
});

posixOnly("a Windows drive path is not a path this check can read off Windows", () => {
  const { plan } = setup(["- [ ] a: done-when: path-absent C:\\Windows\\Temp"]);
  const result = run(process.env, plan, "--apply");
  expect(result.code).toBe(1);
  expect(result.out).toContain("L6 error: path must be absolute or start with ~/");
});

posixOnly("a reference both checks name is looked up once", () => {
  const { plan } = setup([
    "- [ ] a: land acme/tool#1 then update the roadmap page for the next planning cycle done-when: pr-merged acme/tool#1",
  ]);
  const { env, calls } = fakeGh({ "acme/tool#1": "merged" });
  const result = spawnSync(process.execPath, [checker, plan, "--json"], { encoding: "utf8", env });
  const report = JSON.parse(result.stdout);
  expect(report.stale).toHaveLength(1);
  expect(report.doneWhen).toHaveLength(1);
  expect(calls()).toHaveLength(1);
});

test("a later field is refused even when its value follows the colon directly", () => {
  const dir = root0();
  const { plan } = setup([`- [ ] a: done-when: path-absent ${dir} recheck:2026-11-01`]);
  const result = run(process.env, plan, "--apply");
  expect(result.code).toBe(1);
  expect(result.out).toContain(
    "L6 error: done-when must be the last field, but `recheck:` follows it",
  );
  expect(readFileSync(plan, "utf8")).toContain("- [ ] a:");
});

posixOnly("~ expands to the home directory as literal text", () => {
  // `$&` in a replacement string would be read as the matched text.
  const home = join(root0(), "h$&h");
  mkdirSync(join(home, "scratch"), { recursive: true });
  const { plan } = setup(["- [ ] a: done-when: path-absent ~/scratch"]);
  const result = run({ ...process.env, HOME: home }, plan);
  expect(result.out).toContain("L6 pending: path-absent ~/scratch: still exists");
});

test("a later field in parentheses is refused too", () => {
  const dir = root0();
  const { plan } = setup([
    `- [ ] a: done-when: path-absent ${dir} (recheck: 2026-11-01)`,
    `- [ ] b: done-when: path-absent ${dir} [trigger: later]`,
  ]);
  const result = run(process.env, plan, "--apply");
  expect(result.code).toBe(1);
  expect(result.out).toContain(
    "L6 error: done-when must be the last field, but `recheck:` follows it",
  );
  expect(result.out).toContain(
    "L7 error: done-when must be the last field, but `trigger:` follows it",
  );
  expect(readFileSync(plan, "utf8")).not.toContain("[x]");
});

test("done-when inside a code span of any backtick length is prose", () => {
  const { items } = parsePlan(
    planText([
      "- [ ] a: write ``done-when: pr-merged owner/repo#n`` after the item",
      "- [ ] b: write ```done-when: path-absent ~/x``` or `done-when: x` after it",
      "- [ ] c: a ``code with ` inside`` then done-when: pr-merged acme/tool#1",
    ]),
  );
  expect(items.map((item) => item.doneWhen)).toEqual([
    undefined,
    undefined,
    { conditions: [{ kind: "pr-merged", repo: "acme/tool", number: 1 }] },
  ]);
});

test("backticks inside a real condition's path stay part of the path", () => {
  const { items } = parsePlan(
    planText([
      "- [ ] a: done-when: path-absent /work/project`1`",
      "- [ ] b: see `done-when: x` then done-when: path-absent /work/a`b`c",
    ]),
  );
  expect(items.map((item) => item.doneWhen)).toEqual([
    { conditions: [{ kind: "path-absent", path: "/work/project`1`" }] },
    { conditions: [{ kind: "path-absent", path: "/work/a`b`c" }] },
  ]);
});

test("a later field written inside a code span after a path is refused", () => {
  const dir = root0();
  const { plan } = setup([`- [ ] a: done-when: path-absent ${dir} \`recheck: 2026-11-01\``]);
  const result = run(process.env, plan, "--apply");
  expect(result.code).toBe(1);
  expect(result.out).toContain(
    "L6 error: done-when must be the last field, but `recheck:` follows it",
  );
  expect(readFileSync(plan, "utf8")).toContain("- [ ] a:");
});

test("a code span after a space following a path is refused, not read as part of the path", () => {
  const dir = root0();
  const { plan } = setup([
    `- [ ] a: done-when: path-absent ${dir} \`see PR#9\``,
    `- [ ] b: done-when: path-absent ${join(dir, "x")}\`1\``,
  ]);
  const result = run(process.env, plan, "--apply");
  expect(result.code).toBe(1);
  expect(result.out).toContain("L6 error: a code span follows the path after a space");
  // A backtick glued into the path is still part of it: this path does not exist, so it is closeable.
  expect(result.out).toContain("L7 closeable");
  expect(lines(plan)[5]).toMatch(/^- \[ \] a:/);
});
