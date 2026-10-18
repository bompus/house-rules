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

test("a short user-action object still awaits a yes or no, and a condition does not", () => {
  const { plan } = setup({
    ledger: [
      "- [~] a: ship it - trigger: user asks for a release",
      "- [~] b: rerun - trigger: user decides whether to rerun it",
      "- [~] c: later - trigger: user asks for a release once CI passes",
    ],
  });
  const { report } = check(plan);
  expect(report.awaitingUser).toHaveLength(2);
  expect(report.awaitingUser.join("\n")).not.toContain("L8");
  const dated = setup({
    ledger: [
      "- [~] a: ship it - trigger: user approves the release on Friday",
      "- [~] b: ship it - trigger: user approves it at noon",
      "- [~] c: ship it - trigger: user asks tomorrow",
    ],
  });
  expect(check(dated.plan).report.awaitingUser).toEqual([]);
});

test("when every open item is deferred the report says the close-out is due", () => {
  const { plan } = setup({
    ledger: ["- [~] a: later - trigger: 2026-12-01", "- [x] b: shipped - evidence: PR 1"],
  });
  const { report } = check(plan);
  expect(report.closeOutDue).toBe(true);
  const text = spawnSync("node", [script, plan], { encoding: "utf8" }).stdout;
  expect(text).toContain("close-out due:");
  const withOpen = setup({ ledger: ["- [~] a: later - trigger: 2026-12-01", "- [ ] b: working"] });
  expect(check(withOpen.plan).report.closeOutDue).toBe(false);
});

test("a paused plan without a done line recording the user's Pause is a finding", () => {
  const bare = setup({ status: "paused", ledger: ["- [~] a: later - trigger: 2026-12-01"] });
  expect(check(bare.plan).report.findings.join("\n")).toContain("no done ledger item records");
  const chosen = setup({
    status: "paused",
    ledger: [
      "- [~] a: later - trigger: 2026-12-01",
      "- [x] user chose Pause in offer DEMO-9 - evidence: reply 1B",
    ],
  });
  expect(check(chosen.plan).report.findings).toEqual([]);
  // The user's pause stands: no second close-out prompt.
  expect(check(chosen.plan).report.closeOutDue).toBe(false);
  const text = spawnSync("node", [script, chosen.plan], { encoding: "utf8" }).stdout;
  expect(text).not.toContain("close-out due");
  // A done line that only mentions the word is not the user's choice.
  const unrelated = setup({
    status: "paused",
    ledger: [
      "- [~] a: later - trigger: 2026-12-01",
      "- [x] add pause/resume controls - evidence: PR 9",
      "- [x] user asked for pause/resume controls - evidence: PR 10",
    ],
  });
  expect(check(unrelated.plan).report.findings.join("\n")).toContain("no done ledger item records");
  expect(check(unrelated.plan).report.closeOutDue).toBe(true);
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

test("a ledger lint error still reports every open marker outside the ledger", () => {
  const boxes = Array.from({ length: 7 }, (_, index) => `- [ ] stray box ${index}`);
  const { plan } = setup({
    ledger: ["- [x] a: said done", "- [ ] b: still open"],
    extra: ["## Notes", "- pending: an old line", ...boxes].join("\n"),
  });
  const { code, report } = check(plan);
  expect(code).toBe(1);
  expect(report.errors).toEqual([expect.stringContaining("needs `evidence:`")]);
  expect(report.open).toHaveLength(1);
  expect(report.warnings.filter((warning) => warning.includes("stray box"))).toHaveLength(7);
  expect(report.warnings.join("\n")).toContain("pending: an old line");
});

test("every unchecked box outside the ledger is listed, with prose labels capped at five", () => {
  const boxes = Array.from({ length: 8 }, (_, index) => `- [ ] stray box ${index}`);
  const labels = Array.from({ length: 7 }, (_, index) => `- pending: label ${index}`);
  const { plan } = setup({
    status: "completed",
    ledger: ["- [x] a: shipped - evidence: x"],
    extra: ["## Notes", ...boxes, ...labels].join("\n"),
  });
  const { code, report } = check(plan);
  expect(code).toBe(0);
  expect(report.warnings.filter((warning) => warning.includes("stray box"))).toHaveLength(8);
  expect(report.warnings.filter((warning) => warning.includes("label"))).toHaveLength(5);
  expect(report.warnings).toContain("2 more narrative marker line(s)");
});

test("the text report names the offers count and the markers even when the plan is invalid", () => {
  const { plan } = setup({
    ledger: ["- [x] a: said done"],
    extra: "## Notes\n- [ ] stray box\n",
  });
  const run = spawnSync("node", [script, plan], { encoding: "utf8" });
  expect(run.status).toBe(1);
  expect(run.stdout).toContain("unanswered offers: 0");
  expect(run.stdout).toContain("outside the ledger: - [ ] stray box");
  expect(run.stdout).toContain("skipped: scratch, checkout, audit record and GitHub checks");
  expect(run.stdout).toContain(
    "result: invalid input (the checks that read only the plan text still ran)",
  );
});

test("an error from a host check on a valid plan is not blamed on the plan", () => {
  const { notes, plan } = setup({
    status: "completed",
    ledger: ["- [x] a: shipped - evidence: x"],
  });
  mkdirSync(join(notes, "tmp", "broken"), { recursive: true });
  writeFileSync(join(notes, "tmp", "broken", "manifest.json"), "{not json");
  const run = spawnSync("node", [script, plan], { encoding: "utf8" });
  expect(run.status).toBe(1);
  expect(run.stdout).toMatch(/result: invalid input\n?$/);
  expect(run.stdout).not.toContain("still ran");
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

const offerLine = (id, rest = "(presented 2026-10-12): Q1 pick one; 1A recommended") =>
  `- [ ] Offer ${id} ${rest}`;
const offerWarning = (report) => report.warnings.filter((warning) => /unanswered/.test(warning));

test("a plan with no offers counts none and prints the count line", () => {
  const { plan } = setup({
    ledger: ["- [ ] a: unanswered decision", "- [x] b ... evidence: PR 1"],
  });
  const { report } = check(plan);
  expect(report.unansweredOffers).toEqual([]);
  expect(offerWarning(report)).toEqual([]);
  const text = spawnSync("node", [script, plan], { encoding: "utf8" }).stdout;
  expect(text).toContain("unanswered offers: 0\n");
});

test("two unanswered offers are counted and do not warn", () => {
  const { plan } = setup({ ledger: [offerLine("DEMO-1"), offerLine("DEMO-2")] });
  const { code, report } = check(plan);
  expect(code).toBe(2);
  expect(report.unansweredOffers).toEqual([
    expect.stringMatching(/^L6 \[ \] Offer DEMO-1/),
    expect.stringMatching(/^L7 \[ \] Offer DEMO-2/),
  ]);
  expect(offerWarning(report)).toEqual([]);
  const text = spawnSync("node", [script, plan], { encoding: "utf8" }).stdout;
  expect(text).toContain("unanswered offers: 2\n");
});

test("three or more unanswered offers warn to start a walk-through and leave the exit code alone", () => {
  for (const count of [3, 4]) {
    const ids = Array.from({ length: count }, (_, i) => `DEMO-${i + 1}`);
    const { plan } = setup({ ledger: ids.map((id) => offerLine(id)) });
    const { code, report } = check(plan);
    expect(code).toBe(2);
    expect(report.unansweredOffers).toHaveLength(count);
    expect(offerWarning(report)).toEqual([
      expect.stringMatching(new RegExp(`^${count} offers are open and unanswered.*walk-through`)),
    ]);
    const text = spawnSync("node", [script, plan], { encoding: "utf8" }).stdout;
    expect(text).toContain(`unanswered offers: ${count}\n`);
    expect(text).toMatch(/warning: \d offers are open and unanswered/);
  }
});

test("an offer answered, superseded or dropped on another ledger line is not counted", () => {
  const { plan } = setup({
    ledger: [
      offerLine("DEMO-1"),
      "- [x] Offer DEMO-1 answered `go` = 1A; 1B not selected ... evidence: user message",
      offerLine("DEMO-2"),
      "- [-] Offer DEMO-2 superseded by offer DEMO-3 ... by: superseded",
      offerLine("DEMO-3"),
      offerLine("DEMO-4"),
      "- [-] Offer DEMO-4 withdrawn before any answer ... by: user, no longer needed",
      offerLine("DEMO-5"),
    ],
  });
  const { report } = check(plan);
  expect(report.unansweredOffers).toEqual([
    expect.stringMatching(/Offer DEMO-3 /),
    expect.stringMatching(/Offer DEMO-5 /),
  ]);
});

test("an offer that is only awaiting the user's reply stays unanswered", () => {
  const { plan } = setup({
    ledger: [
      "- [ ] Offer DEMO-1 sent; awaiting user reply",
      "- [ ] Offer DEMO-2 sent; waiting for the user reply",
      "- [ ] Offer DEMO-3 sent; pending user reply",
      "- [ ] Offer DEMO-4 sent; user reply pending",
      "- [ ] Offer DEMO-5 sent; user reply is pending",
    ],
  });
  const { report } = check(plan);
  expect(report.unansweredOffers).toHaveLength(5);
});

test("an offer the user chose is answered", () => {
  const { plan } = setup({
    ledger: [offerLine("ABC-12"), "- [x] Offer ABC-12 chosen 1A ... evidence: PR 1"],
  });
  const { report } = check(plan);
  expect(report.unansweredOffers).toEqual([]);
});

test("only by, into and with mark a replacement offer; behind, after and under do not", () => {
  const { plan } = setup({
    ledger: [
      "- [ ] Offer DEMO-4 is queued behind offer DEMO-3",
      "- [ ] Offer DEMO-5 is presented after offer DEMO-6",
      "- [ ] Offer DEMO-7 is presented under offer DEMO-8",
      "- [-] Offer DEMO-1 superseded by offer DEMO-2 ... by: superseded",
      offerLine("DEMO-2"),
      "- [-] Offer DEMO-9 folded into offer DEMO-10 ... by: superseded",
      offerLine("DEMO-10"),
      "- [-] Offer DEMO-11 merged with offer DEMO-12 ... by: superseded",
      offerLine("DEMO-12"),
    ],
  });
  const { report } = check(plan);
  expect(report.unansweredOffers).toHaveLength(9);
});

test("an offer named on several open lines is one offer", () => {
  const { plan } = setup({
    ledger: [
      offerLine("DEMO-1"),
      "- [ ] Offer DEMO-1 question 2 still unanswered ... recheck: 2026-10-20",
      offerLine("DEMO-2"),
    ],
  });
  const { report } = check(plan);
  expect(report.unansweredOffers).toHaveLength(2);
});

test("deferred items and prose that only mention an offer are not unanswered offers", () => {
  const { plan } = setup({
    ledger: [
      "- [~] Offer DEMO-1 held for later ... trigger: next release",
      "- [ ] Draft an offer for the CI-2 failure",
      "- [ ] Offers DEMO-2 and DEMO-3 are queued in the walk-through",
      "- [ ] Check why DEMO-4 was not offered to the user",
      "- [ ] Question 12 (queued): the worker's own offer id DEMO-7 is not used",
      "- [x] Offer DEMO-5 presented ... evidence: reply text",
      "- [-] Offer DEMO-6 ... by: user, not selected",
    ],
  });
  const { report } = check(plan);
  expect(report.unansweredOffers).toEqual([]);
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

test("an open line whose re-check date has passed and whose pull request, thread or commit a later done line names is listed", () => {
  const { plan } = setup({
    ledger: [
      "- [ ] a: wait for acme/tool#5 ... recheck: 2026-10-01",
      "- [~] b: ask mcp:0a1b2c3d about the tag ... trigger: reply recheck: 2026-10-02",
      "- [ ] c: land fix 1a2b3c4 ... recheck: 2026-10-03",
      "- [ ] d: PR #9 review ... recheck: 2026-10-04",
      "- [ ] e: ask about acme/tool#6 ... recheck: 2026-10-05",
      "- [ ] f: DEMO-OFFER-20261001-7 follow-up ... recheck: 2026-10-06",
      "- [x] a done: acme/tool#5 merged ... evidence: merge commit",
      "- [x] b done: reply from mcp:0a1b2c3d-1111-2222-3333-444444444444 ... evidence: thread",
      "- [x] c done: landed 1a2b3c4d5e ... evidence: git log",
      "- [x] d done: acme/tool#9 closed ... evidence: closed",
      "- [x] f done: DEMO-OFFER-20261001-7 answered ... evidence: reply",
    ],
  });
  const { code, report } = check(plan, "--offline", "--repo", "acme/tool", "--today", "2026-10-11");
  expect(report.resolvedLater).toEqual([
    expect.stringMatching(/^L6 .*acme\/tool#5.*L12/),
    expect.stringMatching(/^L7 .*thread:0a1b2c3d.*L13/),
    expect.stringMatching(/^L8 .*commit:1a2b3c4.*L14/),
    expect.stringMatching(/^L9 .*acme\/tool#9.*L15/),
    expect.stringMatching(/^L11 .*offer:DEMO-OFFER-20261001-7.*L16/),
  ]);
  // A group, not a finding: the exit code still comes from the open items.
  expect(code).toBe(2);
  expect(report.findings).toEqual([]);
});

test("a done line that comes first, a common token or a different item does not list the open line", () => {
  const common = Array.from(
    { length: 8 },
    (_, i) => `- [x] common ${i}: see acme/tool#77 ... evidence: x`,
  );
  const { plan } = setup({
    ledger: [
      "- [x] earlier: acme/tool#1 merged ... evidence: merge",
      "- [ ] a: wait for acme/tool#1 ... recheck: 2026-10-01",
      "- [x] b first: acme/tool#2 merged ... evidence: merge",
      "- [ ] b: follow up on acme/tool#2 ... recheck: 2026-10-01",
      "- [ ] c: wait for acme/tool#77 ... recheck: 2026-10-01",
      "- [ ] d: wait for acme/tool#3 ... recheck: 2026-10-01",
      "- [x] d other: acme/tool#4 merged ... evidence: merge",
      "- [ ] e: wait for acme/tool#5 ... recheck: 2026-10-01",
      "- [x] e other: acme/tool#5 merged but check UTF-8 ... evidence: merge",
      ...common,
    ],
  });
  const { report } = check(plan, "--offline", "--repo", "acme/tool", "--today", "2026-10-11");
  expect(report.resolvedLater).toEqual([expect.stringMatching(/^L13 .*acme\/tool#5/)]);
});

test("an open line is listed without waiting for its re-check date, and a work id ties lines together", () => {
  const { plan } = setup({
    ledger: [
      "- [ ] a: wait for acme/tool#5 ... recheck: 2026-10-20",
      "- [ ] b: land demo-docs-fix-20261016",
      "- [~] c: sync release-0.17.0-20261018 to the mirror ... trigger: release",
      "- [ ] d: tidy hr-plain-prose wording",
      "- [ ] e: rerun on 2026-10-16-03",
      "- [x] a done: acme/tool#5 merged ... evidence: merge",
      "- [x] b done: demo-docs-fix-20261016 landed ... evidence: git log",
      "- [x] c done: release-0.17.0-20261018 synced ... evidence: mirror",
      "- [x] d other: hr-plain-prose checker fixed ... evidence: x",
      "- [x] e other: rerun on 2026-10-16-03 ... evidence: x",
    ],
  });
  const { report } = check(plan, "--offline", "--repo", "acme/tool", "--today", "2026-10-11");
  expect(report.resolvedLater).toEqual([
    expect.stringMatching(/^L6 .*acme\/tool#5.*L11/),
    expect.stringMatching(/^L7 .*work:demo-docs-fix-20261016.*L12/),
    expect.stringMatching(/^L8 .*work:release-0\.17\.0-20261018.*L13/),
  ]);
});

test("an open ledger of more than 100 lines or a plan over 256 KiB warns", () => {
  const items = (count) => Array.from({ length: count }, (_, i) => `- [ ] item ${i}`);
  const budget = (report) => report.warnings.filter((warning) => /budget/.test(warning));
  expect(budget(check(setup({ ledger: items(100) }).plan, "--offline").report)).toEqual([]);
  expect(budget(check(setup({ ledger: items(101) }).plan, "--offline").report)).toEqual([
    expect.stringMatching(/101 open or deferred ledger lines.*over the budget of 100/),
  ]);
  const large = setup({ ledger: items(1), extra: "x".repeat(256 * 1024) });
  expect(budget(check(large.plan, "--offline").report)).toEqual([
    expect.stringMatching(/plan is 25\d KiB.*over the budget of 256 KiB/),
  ]);
  const small = setup({ ledger: items(1), extra: "x".repeat(255 * 1024) });
  expect(budget(check(small.plan, "--offline").report)).toEqual([]);
});

test("a commit of only digits or only letters counts after the word commit or sha, a bare run of them does not", () => {
  const { plan } = setup({
    ledger: [
      "- [ ] a: land commit 1234567 ... recheck: 2026-10-01",
      "- [ ] b: land sha abcdefa ... recheck: 2026-10-01",
      "- [ ] c: land 7654321 ... recheck: 2026-10-01",
      "- [x] a done: commit 1234567890 landed ... evidence: git log",
      "- [x] b done: sha ABCDEFAB landed ... evidence: git log",
      "- [x] c done: landed 7654321 ... evidence: git log",
    ],
  });
  const { report } = check(plan, "--offline", "--today", "2026-10-11");
  expect(report.resolvedLater).toEqual([
    expect.stringMatching(/^L6 .*commit:1234567.*L9/),
    expect.stringMatching(/^L7 .*commit:abcdefa.*L10/),
  ]);
});

test("the later-done-line group still runs on a plan that fails its lint", () => {
  const { plan } = setup({
    ledger: [
      "- [ ] a: wait for acme/tool#5 ... recheck: 2026-10-01",
      "- [~] broken: deferred without a trigger",
      "- [x] a done: acme/tool#5 merged ... evidence: merge",
    ],
  });
  const { code, report } = check(plan, "--offline", "--repo", "acme/tool", "--today", "2026-10-11");
  expect(code).toBe(1);
  expect(report.resolvedLater).toEqual([expect.stringMatching(/^L6 .*acme\/tool#5/)]);
});

// notes/audits/<project>/last-audit.json, the record hr-forgotten-work-audit writes.
function auditRecord(notes, project, record) {
  mkdirSync(join(notes, "audits", project), { recursive: true });
  const text = typeof record === "string" ? record : JSON.stringify(record);
  writeFileSync(join(notes, "audits", project, "last-audit.json"), text);
}

function withProject(plan, project) {
  writeFileSync(
    plan,
    readFileSync(plan, "utf8").replace("Purpose: demo\n", `Purpose: demo\nProject: ${project}\n`),
  );
}

const auditWarnings = (report) => report.warnings.filter((warning) => /audit/i.test(warning));

test("a plan without a Project line gets no audit warning", () => {
  const { plan } = setup({ status: "completed", ledger: ["- [x] a: shipped - evidence: x"] });
  const { code, report } = check(plan, "--today", "2026-10-11");
  expect(code).toBe(0);
  expect(report.warnings).toEqual([]);
});

test("a project with no audit record warns and names where the record belongs", () => {
  const { plan, notes } = setup({
    status: "completed",
    ledger: ["- [x] a: shipped - evidence: x"],
  });
  withProject(plan, "demo-app");
  const { code, report } = check(plan, "--today", "2026-10-11");
  expect(code).toBe(0);
  expect(auditWarnings(report)).toEqual([
    expect.stringContaining(join(notes, "audits", "demo-app", "last-audit.json")),
  ]);
  expect(auditWarnings(report)[0]).toContain("no forgotten-work audit");
});

test("an audit older than 30 days warns; one 30 days old or newer does not", () => {
  const { plan, notes } = setup({
    status: "completed",
    ledger: ["- [x] a: shipped - evidence: x"],
  });
  withProject(plan, "demo-app");
  const record = { project: "demo-app", date: "2026-09-10", scope: "all sessions", result: "r.md" };
  auditRecord(notes, "demo-app", record);
  const old = check(plan, "--today", "2026-10-11");
  expect(old.code).toBe(0);
  expect(auditWarnings(old.report)).toEqual([
    expect.stringMatching(/last forgotten-work audit .*2026-09-10, 31 days ago/),
  ]);
  auditRecord(notes, "demo-app", { ...record, date: "2026-09-11" });
  expect(auditWarnings(check(plan, "--today", "2026-10-11").report)).toEqual([]);
});

test("an unreadable or incomplete audit record warns instead of passing", () => {
  const { plan, notes } = setup({
    status: "completed",
    ledger: ["- [x] a: shipped - evidence: x"],
  });
  withProject(plan, "demo-app");
  for (const record of [
    "not json",
    { project: "demo-app", date: "2026-02-31", scope: "x", result: "r.md" },
    { project: "demo-app", date: "2026-10-01", result: "r.md" },
  ]) {
    auditRecord(notes, "demo-app", record);
    const { code, report } = check(plan, "--today", "2026-10-11");
    expect(code).toBe(0);
    expect(auditWarnings(report)).toEqual([
      expect.stringContaining("cannot read the audit record"),
    ]);
  }
});

test("a Project value that is not a plain name warns instead of reading outside the audits folder", () => {
  const { plan } = setup({ status: "completed", ledger: ["- [x] a: shipped - evidence: x"] });
  withProject(plan, "../elsewhere");
  const { report } = check(plan, "--today", "2026-10-11");
  expect(auditWarnings(report)).toEqual([expect.stringContaining("not a plain project name")]);
});

test("a Project URL header is not a Project line", () => {
  const { plan } = setup({ status: "completed", ledger: ["- [x] a: shipped - evidence: x"] });
  writeFileSync(
    plan,
    readFileSync(plan, "utf8").replace(
      "Purpose: demo\n",
      "Purpose: demo\nProject URL: https://example.com\n",
    ),
  );
  expect(auditWarnings(check(plan, "--today", "2026-10-11").report)).toEqual([]);
});

test("an audit dated after today is reported, not counted as fresh", () => {
  const { plan, notes } = setup({
    status: "completed",
    ledger: ["- [x] a: shipped - evidence: x"],
  });
  withProject(plan, "demo-app");
  auditRecord(notes, "demo-app", {
    project: "demo-app",
    date: "2026-12-01",
    scope: "x",
    result: "r.md",
  });
  expect(auditWarnings(check(plan, "--today", "2026-10-11").report)).toEqual([
    expect.stringContaining("dated after today"),
  ]);
});
