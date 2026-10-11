import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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
  const body = [
    `Owner: ${owner}`,
    `Status: ${status}`,
    "Purpose: demo",
    "",
    "## Ledger",
    ...ledger,
    "",
    extra,
  ].join("\n");
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

test("a deferral whose only trigger is the user's own action is listed as awaiting a yes or no", () => {
  const { plan } = setup({
    ledger: [
      "- [~] a: rename the flag - trigger: user selects",
      "- [~] b: split the module - trigger: user's decision.",
      "- [~] c: vendored copy is old - trigger: user asks for the backlog",
      "- [ ] d: open question about wording",
    ],
  });
  const { code, report } = check(plan);
  expect(code).toBe(2);
  expect(report.awaitingUser).toHaveLength(3);
  expect(report.awaitingUser.join("\n")).toContain("L6 [~] a: rename the flag");
  expect(report.open).toHaveLength(4);
  const text = spawnSync("node", [script, plan], { encoding: "utf8" }).stdout;
  expect(text).toContain("awaiting your yes/no: L6 [~] a: rename the flag");
  expect(text).toContain("3 awaiting your yes/no");
});

test("a deferral with a dated, event or compound trigger is not listed as awaiting a yes or no", () => {
  const { plan } = setup({
    ledger: [
      "- [~] a: later - trigger: 2026-10-16",
      "- [~] b: upstream fix - trigger: release 1.4 ships",
      "- [~] c: later - trigger: user selects after the release ships",
      "- [~] d: waits on an owner - trigger: owner of the pin replies",
      "- [ ] e: open item with no trigger",
    ],
  });
  const { report } = check(plan);
  expect(report.awaitingUser).toEqual([]);
  expect(report.open).toHaveLength(5);
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

test("an unreadable scratch manifest is an error, not a clean pass", () => {
  const { notes, plan } = setup({
    status: "completed",
    ledger: ["- [x] a: shipped - evidence: x"],
  });
  mkdirSync(join(notes, "tmp", "broken"), { recursive: true });
  writeFileSync(join(notes, "tmp", "broken", "manifest.json"), "{not json");
  const { code, report } = check(plan, "--archive");
  expect(code).toBe(1);
  expect(report.errors[0]).toContain(join("broken", "manifest.json"));
  expect(existsSync(plan)).toBe(true);
});

test("a branch name or path counts only as a whole word in an item", () => {
  const { notes, plan } = setup({
    ledger: ["- [ ] docs: update main docs and the maintenance notes"],
  });
  const checkout = join(notes, "work");
  repository(checkout, 1);
  let { report } = check(plan, "--checkout", checkout);
  expect(report.findings[0]).toContain("is not named in any ledger item");
  writeFileSync(
    plan,
    `Owner: Alice\nStatus: active\n\n## Ledger\n- [ ] land: ${checkout}x and ${checkout}-old\n`,
  );
  ({ report } = check(plan, "--checkout", checkout));
  expect(report.findings[0]).toContain("is not named in any ledger item");
  writeFileSync(
    plan,
    `Owner: Alice\nStatus: active\n\n## Ledger\n- [ ] land: ${checkout} commits\n`,
  );
  ({ report } = check(plan, "--checkout", checkout));
  expect(report.findings).toEqual([]);
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

test("an app-managed checkout is reported as a warning, not a finding", () => {
  const { notes, plan } = setup({
    status: "completed",
    ledger: ["- [x] a: shipped - evidence: x"],
  });
  const checkout = join(notes, "app-worktree");
  repository(checkout, 2);
  const { code, report } = check(plan, "--app-managed", checkout);
  expect(code).toBe(0);
  expect(report.findings).toEqual([]);
  expect(report.warnings.join("\n")).toContain("2 unpushed commit(s)");
});

test("options the user passed over, dropped as not selected, leave nothing open", () => {
  const { plan } = setup({
    status: "completed",
    ledger: [
      "- [x] 1B: chosen change - evidence: PR 4",
      "- [-] 1A: option not picked - by: user, not selected (answered 1B)",
      "- [-] 1C: option not picked - by: user, not selected (answered 1B)",
    ],
  });
  const { code, report } = check(plan);
  expect(code).toBe(0);
  expect(report.open).toEqual([]);
});

test("archiving moves only a completed plan with nothing open", () => {
  const active = setup({ status: "active", ledger: ["- [x] a: shipped - evidence: x"] });
  let { code, report } = check(active.plan, "--archive");
  expect(code).toBe(2);
  expect(report.findings[0]).toContain("archiving refused");
  expect(existsSync(active.plan)).toBe(true);

  const finished = setup({ status: "done", ledger: ["- [x] a: shipped - evidence: x"] });
  expect(check(finished.plan, "--archive").code).toBe(2);
  expect(existsSync(finished.plan)).toBe(true);

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

test("a plan without a Purpose line warns but does not change the result", () => {
  const { plan } = setup({ status: "completed", ledger: ["- [x] a: shipped - evidence: x"] });
  const text = readFileSync(plan, "utf8").replace("Purpose: demo\n", "");
  writeFileSync(plan, text);
  const { code, report } = check(plan);
  expect(code).toBe(0);
  expect(report.warnings).toEqual([expect.stringContaining("Purpose:")]);
});

// The stand-in `gh` below is a shebang script, which Windows cannot run from PATH.
const posixOnly = test.skipIf(process.platform === "win32");

// A stand-in `gh` on PATH: answers `gh api repos/<o>/<r>/issues/<n>` from a JSON map of
// "o/r#n" to "open", "closed" or "merged", logs each call, and fails like an offline host on "fail".
function fakeGh(states) {
  const bin = mkdtempSync(join(process.env.HOUSE_RULES_TEST_TMP ?? tmpdir(), "open-work-bin-"));
  roots.push(bin);
  symlinkSync(process.execPath, join(bin, "node"));
  writeFileSync(join(bin, "states.json"), JSON.stringify(states));
  writeFileSync(
    join(bin, "gh"),
    [
      "#!/usr/bin/env node",
      'const { appendFileSync, readFileSync } = require("node:fs");',
      'const { join } = require("node:path");',
      'appendFileSync(join(__dirname, "calls.log"), process.argv.slice(2).join(" ") + "\\n");',
      'const states = JSON.parse(readFileSync(join(__dirname, "states.json"), "utf8"));',
      'if (states.fail) { console.error("error connecting to api.github.com"); process.exit(1); }',
      "const [, owner, repo, , number] = process.argv[3].split('/');",
      "const state = states[`${owner}/${repo}#${number}`];",
      'if (!state) { console.error("gh: Not Found (HTTP 404)"); process.exit(1); }',
      "console.log(JSON.stringify({ state: state === 'open' ? 'open' : 'closed',",
      "  ...(state === 'merged' ? { pull_request: { merged_at: '2026-01-01T00:00:00Z' } } : state === 'closed' ? { pull_request: { merged_at: null } } : {}) }));",
    ].join("\n"),
    { mode: 0o755 },
  );
  const calls = () =>
    existsSync(join(bin, "calls.log"))
      ? readFileSync(join(bin, "calls.log"), "utf8").split("\n").filter(Boolean)
      : [];
  return { env: { ...process.env, PATH: bin }, calls };
}

function checkWith(env, plan, ...args) {
  const run = spawnSync(process.execPath, [script, plan, "--json", ...args], {
    encoding: "utf8",
    env,
  });
  return { code: run.status, report: run.stdout ? JSON.parse(run.stdout) : null };
}

posixOnly(
  "an open item whose every named pull request or issue is merged or closed is listed as possibly finished",
  () => {
    const { plan } = setup({
      ledger: [
        "- [ ] a: land acme/tool#1",
        "- [~] b: wait on https://github.com/acme/tool/issues/2 ... trigger: maintainer reply recheck: 2099-01-01",
        "- [ ] c: release acme/tool#1 and acme/tool#3",
        "- [ ] d: land PR #4",
        "- [ ] e: land #9 in another repository",
      ],
    });
    const gh = fakeGh({
      "acme/tool#1": "merged",
      "acme/tool#2": "closed",
      "acme/tool#3": "open",
      "acme/tool#4": "merged",
    });
    const { code, report } = checkWith(gh.env, plan, "--repo", "acme/tool");
    expect(code).toBe(2);
    expect(report.stale).toEqual([
      expect.stringMatching(/^L6 .*acme\/tool#1 merged/),
      expect.stringMatching(/^L7 .*acme\/tool#2 closed/),
      expect.stringMatching(/^L9 .*acme\/tool#4 merged/),
    ]);
    expect(report.skipped).toEqual([]);
    // #9 is looked up in --repo too, and a reference GitHub does not know leaves the item alone.
    expect(gh.calls()).toHaveLength(5);
  },
);

posixOnly("bare pull request numbers are not checked without --repo", () => {
  const { plan } = setup({ ledger: ["- [ ] d: land PR #4"] });
  const gh = fakeGh({ "acme/tool#4": "merged" });
  const { report } = checkWith(gh.env, plan);
  expect(report.stale).toEqual([]);
  expect(gh.calls()).toHaveLength(0);
  expect(report.skipped).toEqual([expect.stringContaining("--repo")]);
});

posixOnly("without gh, offline or with --offline the GitHub check is skipped and says so", () => {
  const { plan } = setup({ ledger: ["- [ ] a: land acme/tool#1", "- [ ] b: land acme/tool#2"] });
  const missing = fakeGh({});
  rmSync(join(missing.env.PATH, "gh"));
  const offline = fakeGh({ fail: true });
  const flag = fakeGh({ "acme/tool#1": "merged" });
  for (const [env, args, reason] of [
    [missing.env, [], /gh not found/],
    [offline.env, [], /error connecting/],
    [flag.env, ["--offline"], /--offline/],
  ]) {
    const { code, report } = checkWith(env, plan, ...args);
    expect(code).toBe(2);
    expect(report.stale).toEqual([]);
    expect(report.skipped).toEqual([expect.stringMatching(reason)]);
  }
  expect(offline.calls()).toHaveLength(1);
  expect(flag.calls()).toHaveLength(0);
});

posixOnly(
  "a named commit outside the default branch keeps an item open, a landed one decides nothing",
  () => {
    const { notes, plan } = setup();
    const checkout = join(notes, "repo");
    repository(checkout, 2);
    const git = (...args) =>
      spawnSync("git", ["-C", checkout, ...args], { encoding: "utf8" }).stdout.trim();
    const landed = git("rev-parse", "HEAD~1").slice(0, 9);
    git("update-ref", "refs/remotes/origin/main", landed);
    git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
    const local = git("rev-parse", "HEAD").slice(0, 9);
    writeFileSync(
      plan,
      readFileSync(plan, "utf8").replace(
        "## Ledger\n",
        [
          "## Ledger",
          `- [ ] a: land acme/tool#1 (${landed})`,
          `- [ ] b: land acme/tool#1 (${local})`,
          `- [ ] c: the pin is still ${landed}`,
          "",
        ].join("\n"),
      ),
    );
    const gh = fakeGh({ "acme/tool#1": "merged" });
    const env = { ...gh.env, PATH: `${gh.env.PATH}:${process.env.PATH}` };
    const { report } = checkWith(env, plan, "--checkout", checkout);
    expect(report.stale).toEqual([
      expect.stringMatching(new RegExp(`^L6 .*acme/tool#1 merged, ${landed} in origin/main`)),
    ]);
  },
);

posixOnly(
  "a reference the line already reports as merged or left out is context, not the subject",
  () => {
    const { plan } = setup({
      ledger: [
        "- [~] a: the part left out of acme/tool#1 ... trigger: next release",
        "- [~] b: residual advisories after acme/tool#1 merged ... trigger: next audit",
        "- [ ] c: acme/tool#1 merged; clean up acme/tool#2",
      ],
    });
    const gh = fakeGh({ "acme/tool#1": "merged", "acme/tool#2": "merged" });
    const { report } = checkWith(gh.env, plan);
    expect(report.stale).toEqual([expect.stringMatching(/^L8 .*acme\/tool#2 merged$/)]);
    expect(gh.calls()).toHaveLength(1);
  },
);

test("dates that are not on the calendar are rejected or reported", () => {
  const { plan } = setup({ ledger: ["- [~] a: wait ... trigger: x recheck: 2026-02-31"] });
  expect(check(plan, "--today", "2026-13-45").code).toBe(1);
  const { report } = check(plan, "--offline", "--today", "2026-03-01");
  expect(report.recheckDue).toEqual([]);
  expect(report.warnings).toEqual([expect.stringContaining("not a calendar date")]);
});

test("follow-up markers in prose and stray deferred boxes warn, ordinary prose does not", () => {
  const { plan } = setup({
    status: "completed",
    ledger: ["- [x] a: shipped - evidence: x"],
    extra: [
      "## Log",
      "- Follow-up: edge order needs a re-tune first.",
      "Landed the fix. Still open for later: the perf batch.",
      "Merged it. Deferred: the directory listing.",
      "- [~] stray deferred box ... trigger: x",
      "Recent panel follow-up: recovered the newer decisions.",
      "Offer 3 remains open and unselected.",
      "We can look at this later if it matters.",
    ].join("\n"),
  });
  const { code, report } = check(plan);
  expect(code).toBe(0);
  expect(report.warnings.map((w) => w.match(/^L\d+/)?.[0])).toEqual(["L9", "L10", "L11", "L12"]);
});

test("an answered offer line that does not say what happened to the other options warns", () => {
  const { plan } = setup({
    status: "completed",
    ledger: [
      "- [x] Offer DEMO-1 selected 1B ... evidence: PR 1",
      "- [x] Offer DEMO-2 selected 1A; 1B not selected ... evidence: PR 2",
      "- [x] Offer DEMO-3 selected 2A ... evidence: PR 3",
      "- [-] Offer DEMO-3 option 2B ... by: user, not selected",
      "- [x] Offer DEMO-4 selected 1A; rollout deferred until the release ... evidence: PR 4",
      "- [x] Offer DEMO-5 selected 1A, 1B deferred ... evidence: PR 5",
      "- [x] Presented the offer ... evidence: reply text",
    ],
  });
  const { code, report } = check(plan);
  expect(code).toBe(0);
  expect(report.warnings).toEqual([
    expect.stringMatching(/^L6 .*answered offer/),
    expect.stringMatching(/^L10 .*answered offer/),
  ]);
});

test("items tied to another thread need a re-check date, and dates within a week are listed", () => {
  const { plan } = setup({
    ledger: [
      "- [~] a: comment on acme/tool#5 ... trigger: maintainer reply",
      "- [~] b: upstream review ... trigger: maintainer reply recheck: 2026-10-01",
      "- [ ] c: asked the release session about the tag; reply route: its plan ... recheck: 2026-10-15",
      "- [~] d: wait for the upstream release ... trigger: release recheck: 2026-11-30",
      "- [~] e: unrelated local idea ... trigger: next failure",
      "- [ ] f: asked the design thread which layout to keep",
      "- [~] g: wait for PR #4 to merge ... trigger: merge",
    ],
  });
  const { report } = check(plan, "--offline", "--today", "2026-10-11");
  expect(report.recheckDue).toEqual([
    expect.stringMatching(/^L7 .*overdue since 2026-10-01/),
    expect.stringMatching(/^L8 .*due 2026-10-15/),
  ]);
  expect(report.warnings).toEqual([
    expect.stringMatching(/^L6 .*recheck:/),
    expect.stringMatching(/^L11 .*recheck:/),
    expect.stringMatching(/^L12 .*recheck:/),
  ]);
});
