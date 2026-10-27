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

const script = join(import.meta.dirname, "..", "scripts", "consolidate-ledger.mjs");
const checker = join(import.meta.dirname, "..", "scripts", "check-open-work.mjs");
const time = "2026-10-26 18:00 -06:00";
/** @type {string[]} */
const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

/** @param {string} prefix */
function scratch(prefix) {
  const root = mkdtempSync(join(process.env.HOUSE_RULES_TEST_TMP ?? tmpdir(), prefix));
  roots.push(root);
  return root;
}

// The stand-in `gh` below is a shebang script, which Windows cannot run from PATH.
const posixOnly = test.skipIf(process.platform === "win32");

// A stand-in `gh` on PATH: answers `gh api repos/<o>/<r>/issues/<n>` from a JSON map of "o/r#n" to
// "open", "closed" or "merged", and fails like an offline host on `fail`. Unlisted references are 404.
/** @param {Record<string, string | boolean | { path: string, from: string, to: string }>} states */
function fakeGh(states) {
  const bin = scratch("consolidate-bin-");
  symlinkSync(process.execPath, join(bin, "node"));
  writeFileSync(join(bin, "states.json"), JSON.stringify(states));
  writeFileSync(
    join(bin, "gh"),
    [
      "#!/usr/bin/env node",
      'const { readFileSync } = require("node:fs");',
      'const { join } = require("node:path");',
      'const states = JSON.parse(readFileSync(join(__dirname, "states.json"), "utf8"));',
      'if (states.fail) { console.error("error connecting to api.github.com"); process.exit(1); }',
      "if (states.mutate) { const { path, from, to } = states.mutate; const { writeFileSync } = require('node:fs'); writeFileSync(path, readFileSync(path, 'utf8').replace(from, to)); }",
      "const [, owner, repo, , number] = process.argv[3].split('/');",
      "const state = states[`${owner}/${repo}#${number}`];",
      'if (!state) { console.error("gh: Not Found (HTTP 404)"); process.exit(1); }',
      "console.log(JSON.stringify({ state: state === 'open' ? 'open' : 'closed',",
      "  ...(state === 'merged' ? { pull_request: { merged_at: '2026-01-01T00:00:00Z' } } : state === 'unmerged' ? { pull_request: { merged_at: null } } : {}) }));",
    ].join("\n"),
    { mode: 0o755 },
  );
  return { ...process.env, PATH: bin };
}

/** @param {string} root @param {string[]} ledger */
function writePlan(root, ledger) {
  const plan = join(root, "plan.md");
  writeFileSync(
    plan,
    ["Owner: Alice", "Status: active", "Purpose: demo", "", "## Ledger", ...ledger, ""].join("\n"),
  );
  return plan;
}

/** @param {NodeJS.ProcessEnv} env @param {...string} args */
function consolidate(env, ...args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env });
}

/** @param {string} path */
const lines = (path) => readFileSync(path, "utf8").split("\n");
/** @param {string} outdir @returns {{ line: number, flag: string, checks: string[], lineRefs: { line: number }[] }[]} */
const candidates = (outdir) =>
  JSON.parse(readFileSync(join(outdir, "closure-candidates.json"), "utf8")).candidates;

test("chunk writes a snapshot and splits the open and deferred lines by count and by size", () => {
  const root = scratch("consolidate-chunk-");
  const plan = writePlan(root, [
    "- [ ] one",
    "- [~] two trigger: later",
    "- [x] three evidence: done",
    "- [ ] four",
    "  wrapped on a second line",
    "- [-] five by: Alice",
    "- [ ] six",
  ]);
  const outdir = join(root, "out");
  const run = consolidate(process.env, "chunk", plan, outdir, "--lines", "2");
  expect(run.status).toBe(0);
  expect(run.stdout).toContain("4 open or deferred line(s) in 2 chunk(s)");
  expect(readFileSync(join(outdir, "plan.snapshot.md"), "utf8")).toBe(readFileSync(plan, "utf8"));
  expect(lines(join(outdir, "chunk-01.txt"))).toEqual([
    "L6\t- [ ] one",
    "L7\t- [~] two trigger: later",
    "",
  ]);
  expect(lines(join(outdir, "chunk-02.txt"))).toEqual([
    "L9\t- [ ] four wrapped on a second line",
    "L12\t- [ ] six",
    "",
  ]);
  const bySize = consolidate(process.env, "chunk", plan, join(root, "small"), "--bytes", "20");
  expect(bySize.stdout).toContain("4 open or deferred line(s) in 4 chunk(s)");
});

test("chunk keeps the snapshot the helpers' results refer to unless told to replace it", () => {
  const root = scratch("consolidate-chunk-");
  const plan = writePlan(root, ["- [ ] one"]);
  const outdir = join(root, "out");
  expect(consolidate(process.env, "chunk", plan, outdir).status).toBe(0);
  writeFileSync(plan, readFileSync(plan, "utf8").replace("one", "changed"));
  const again = consolidate(process.env, "chunk", plan, outdir);
  expect(again.status).toBe(1);
  expect(again.stderr).toContain("snapshot");
  expect(readFileSync(join(outdir, "plan.snapshot.md"), "utf8")).toContain("one");
  expect(consolidate(process.env, "chunk", plan, outdir, "--force").status).toBe(0);
  expect(readFileSync(join(outdir, "plan.snapshot.md"), "utf8")).toContain("changed");
  // Results written for the old snapshot never carry over to a new one.
  writeFileSync(join(outdir, "results-01.tsv"), "line\tverdict\tevidence\tnote\n");
  const stale = consolidate(process.env, "chunk", plan, outdir, "--force");
  expect(stale.status).toBe(1);
  expect(stale.stderr).toContain("use a new directory");
});

// Ledger lines start at L6. Rows of results-01.tsv name the line they judge.
const LEDGER = [
  "- [ ] a merged pull request", // L6
  "- [ ] b open pull request", // L7
  "- [ ] c no reference", // L8
  "- [ ] d closed ledger line", // L9
  "- [ ] e open ledger line only", // L10
  "- [ ] f still open", // L11
  "- [x] g closed already evidence: PR 1", // L12
  "- [ ] h superseded by an open line", // L13
  "- [ ] i superseded with no reference", // L14
  "- [ ] j weaker evidence", // L15
  "- [ ] k unknown verdict", // L16
  "- [ ] l waiting", // L17
  "- [ ] m closed line", // L18
  "- [ ] n pull request not found", // L19
  "- [ ] o two rows disagree", // L20
  "- [ ] p reported twice", // L21
];
const ROWS = [
  ["L6", "DONE", "acme/tool#1 merged"],
  ["L7", "DONE", "acme/tool#2 still open on review"],
  ["L8", "DONE", "the owner said it is finished"],
  ["L9", "DONE", "recorded on L12"],
  ["L10", "DONE", "tracked on L11"],
  ["L13", "SUPERSEDED", "carried by L11"],
  ["L14", "SUPERSEDED", "replaced by a newer line"],
  ["L15", "DONE", "acme/tool#1 merged but the note is thin"],
  ["L16", "MAYBE", "acme/tool#1"],
  ["L17", "WAITING", "owner Bob until 2026-11-01"],
  ["L12", "DONE", "acme/tool#1 merged"],
  ["L19", "DONE", "acme/tool#9 merged"],
  ["L20", "DONE", "acme/tool#1 merged"],
  ["L20", "OPEN", "work remains"],
  ["L21", "DONE", "acme/tool#1 merged"],
  ["L21", "DONE", "acme/tool#3 closed"],
].map((row) => row.join("\t"));

/** @param {string} root */
function consolidation(root) {
  const plan = writePlan(root, LEDGER);
  const outdir = join(root, "out");
  expect(consolidate(process.env, "chunk", plan, outdir).status).toBe(0);
  writeFileSync(
    join(outdir, "results-01.tsv"),
    `line\tverdict\tevidence\tnote\n${ROWS.join("\n")}\n`,
  );
  writeFileSync(join(root, "weaker.txt"), "# held back for the user\nL15\n");
  return { plan, outdir };
}

const STATES = { "acme/tool#1": "merged", "acme/tool#2": "open", "acme/tool#3": "closed" };

posixOnly(
  "verify flags every proposed closure by what can be checked and writes the candidates",
  () => {
    const root = scratch("consolidate-verify-");
    const { outdir } = consolidation(root);
    const run = consolidate(
      fakeGh(STATES),
      "verify",
      outdir,
      "--exclude",
      join(root, "weaker.txt"),
    );
    expect(run.status).toBe(0);
    expect(candidates(outdir).map((row) => `L${row.line} ${row.flag}`)).toEqual([
      "L6 ok", // a merged pull request
      "L7 BAD", // a pull request that is still open
      "L8 NOREF", // nothing checkable is named
      "L9 ok", // names L12, which is closed
      "L10 BAD", // names only L11, which is still open
      "L13 ok", // superseded by a line that exists
      "L14 NOREF",
      "L15 EXCLUDED", // would be ok, but the line is on the exclusion list
      "L16 INVALID", // MAYBE is not a verdict
      "L17 none", // WAITING proposes no closure
      "L12 INVALID", // a row for a line that is not open or deferred
      "L19 BAD", // GitHub has no such pull request
      "L20 CONFLICT",
      "L20 CONFLICT",
      "L21 ok",
      "L21 DUPLICATE", // the first row for a line decides
    ]);
    expect(candidates(outdir)[0]?.checks).toEqual(["acme/tool#1=merged"]);
    expect(run.stdout).toContain("rows 16: DONE 11, SUPERSEDED 2, MAYBE 1, WAITING 1, OPEN 1");
    expect(run.stdout).toContain("BAD L7 DONE");
    expect(run.stdout).toContain("NOREF L8 DONE");
    expect(run.stdout).not.toContain("ok L6");
  },
);

posixOnly("verify checks nothing when GitHub cannot be asked", () => {
  const root = scratch("consolidate-verify-");
  const { outdir } = consolidation(root);
  const down = consolidate(fakeGh({ fail: true }), "verify", outdir);
  expect(down.status).toBe(3);
  expect(down.stderr).toContain("nothing was verified");
  expect(existsSync(join(outdir, "closure-candidates.json"))).toBe(false);
  const offline = consolidate(fakeGh(STATES), "verify", outdir, "--offline");
  expect(offline.status).toBe(3);
  expect(existsSync(join(outdir, "closure-candidates.json"))).toBe(false);
});

posixOnly(
  "apply closes each ok candidate in place with its evidence and the checks that passed",
  () => {
    const root = scratch("consolidate-apply-");
    const { plan, outdir } = consolidation(root);
    const before = readFileSync(plan, "utf8");
    expect(
      consolidate(fakeGh(STATES), "verify", outdir, "--exclude", join(root, "weaker.txt")).status,
    ).toBe(0);
    const dry = consolidate(process.env, "apply", outdir, plan, "--dry-run");
    expect(dry.status).toBe(0);
    expect(dry.stdout).toContain("would close 4, already closed 0, skipped 0, failed 0");
    expect(readFileSync(plan, "utf8")).toBe(before);
    expect(existsSync(join(outdir, "plan.before-closures.md"))).toBe(false);

    const run = consolidate(process.env, "apply", outdir, plan, "--time", time);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("closed 4, already closed 0, skipped 0, failed 0");
    expect(readFileSync(join(outdir, "plan.before-closures.md"), "utf8")).toBe(before);
    const after = lines(plan);
    expect(after[5]).toBe(
      `- [x] a merged pull request … evidence: acme/tool#1 merged [checked: acme/tool#1=merged] (closed ${time})`,
    );
    expect(after[8]).toContain(
      "- [x] d closed ledger line … evidence: recorded on L12 [checked: L12:done]",
    );
    expect(after[12]).toBe(
      `- [-] h superseded by an open line … by: consolidation, superseded: carried by L11 [checked: L11:open] (dropped ${time})`,
    );
    expect(after[20]).toContain("- [x] p reported twice … evidence: acme/tool#1 merged");
    // Flagged and excluded lines, and lines the helpers called open, are untouched.
    for (const index of [6, 7, 9, 13, 14, 15, 16, 17, 18, 19]) {
      expect(after[index]).toBe(before.split("\n")[index]);
    }
    // The plan is still a valid plan for the checker.
    expect(
      spawnSync(process.execPath, [checker, plan, "--offline"], { encoding: "utf8" }).status,
    ).not.toBe(1);

    const again = consolidate(process.env, "apply", outdir, plan, "--time", time);
    expect(again.stdout).toContain("closed 0, already closed 4, skipped 0, failed 0");
    expect(lines(plan)).toEqual(after);
  },
);

posixOnly("apply skips a line that was edited after the snapshot", () => {
  const root = scratch("consolidate-apply-");
  const { plan, outdir } = consolidation(root);
  expect(consolidate(fakeGh(STATES), "verify", outdir).status).toBe(0);
  writeFileSync(
    plan,
    readFileSync(plan, "utf8").replace("a merged pull request", "a reopened task"),
  );
  const run = consolidate(process.env, "apply", outdir, plan, "--time", time);
  expect(run.status).toBe(0);
  expect(run.stdout).toContain("skipped L6: the line changed since the snapshot");
  expect(lines(plan)[5]).toBe("- [ ] a reopened task");
  expect(lines(plan)[8]).toContain("- [x] d closed ledger line");
});

test("verify and apply refuse to run without their inputs", () => {
  const root = scratch("consolidate-usage-");
  const outdir = join(root, "out");
  mkdirSync(outdir);
  expect(consolidate(process.env, "verify", outdir).stderr).toContain("run chunk first");
  writeFileSync(
    join(outdir, "plan.snapshot.md"),
    "Owner: A\nStatus: active\n\n## Ledger\n- [ ] x\n",
  );
  expect(consolidate(process.env, "verify", outdir).stderr).toContain("no results-*.tsv");
  expect(consolidate(process.env, "apply", outdir, join(root, "plan.md")).stderr).toContain(
    "run verify first",
  );
  expect(consolidate(process.env, "bogus").status).toBe(1);
});

/** @param {string[]} ledger @param {string[]} results */
function smallConsolidation(ledger, results) {
  const root = scratch("consolidate-small-");
  const plan = writePlan(root, ledger);
  const outdir = join(root, "out");
  expect(consolidate(process.env, "chunk", plan, outdir).status).toBe(0);
  writeFileSync(
    join(outdir, "results-01.tsv"),
    `line\tverdict\tevidence\tnote\n${results.join("\n")}\n`,
  );
  return { root, plan, outdir };
}

posixOnly("a failed verification leaves no earlier approvals for apply to use", () => {
  const root = scratch("consolidate-stale-");
  const { plan, outdir } = consolidation(root);
  expect(consolidate(fakeGh(STATES), "verify", outdir).status).toBe(0);
  expect(consolidate(fakeGh({ fail: true }), "verify", outdir).status).toBe(3);
  const run = consolidate(process.env, "apply", outdir, plan, "--time", time);
  expect(run.status).toBe(1);
  expect(run.stderr).toContain("run verify first");
  expect(lines(plan)[5]).toBe("- [ ] a merged pull request");
});

posixOnly("apply refuses candidates verified against a different snapshot", () => {
  const root = scratch("consolidate-stale-");
  const { plan, outdir } = consolidation(root);
  expect(consolidate(fakeGh(STATES), "verify", outdir).status).toBe(0);
  writeFileSync(
    join(outdir, "plan.snapshot.md"),
    readFileSync(plan, "utf8").replace("a merged", "another"),
  );
  const run = consolidate(process.env, "apply", outdir, plan, "--time", time);
  expect(run.status).toBe(1);
  expect(run.stderr).toContain("changed since verify");
});

posixOnly("apply skips a closure whose evidence line was reopened after verify", () => {
  const root = scratch("consolidate-reopen-");
  const { plan, outdir } = consolidation(root);
  expect(consolidate(fakeGh(STATES), "verify", outdir).status).toBe(0);
  writeFileSync(
    plan,
    readFileSync(plan, "utf8").replace("- [x] g closed already", "- [ ] g closed already"),
  );
  const run = consolidate(process.env, "apply", outdir, plan, "--time", time);
  expect(run.stdout).toContain("skipped L9: L12 is no longer as verified");
  expect(lines(plan)[8]).toBe("- [ ] d closed ledger line");
});

test("supersessions that point at each other carry nothing, and one line is enough elsewhere", () => {
  const { outdir } = smallConsolidation(
    ["- [ ] a", "- [ ] b", "- [ ] c", "- [ ] d"],
    [
      "L6\tSUPERSEDED\tcarried by L7\t",
      "L7\tSUPERSEDED\tcarried by L6\t",
      "L8\tSUPERSEDED\tcarried by L9\t",
      "L9\tOPEN\twork remains\t",
    ],
  );
  expect(consolidate(process.env, "verify", outdir).status).toBe(0);
  expect(candidates(outdir).map((row) => `L${row.line} ${row.flag}`)).toEqual([
    "L6 NOREF",
    "L7 NOREF",
    "L8 ok",
    "L9 none",
  ]);
});

test("a row with extra or missing columns is invalid and single-digit ledger lines count", () => {
  const { outdir } = smallConsolidation(
    ["- [ ] a", "- [x] b evidence: shipped", "- [ ] c", "- [ ] d"],
    [
      "L6\tDONE\tfinished on L7\t",
      "L8\tDONE\tacme/tool#1 merged\tand acme/tool#2 open\textra",
      "L9\tDONE",
    ],
  );
  expect(consolidate(process.env, "verify", outdir, "--offline").status).toBe(0);
  expect(candidates(outdir).map((row) => `L${row.line} ${row.flag}`)).toEqual([
    "L6 ok",
    "L8 INVALID",
    "L9 INVALID",
  ]);
});

test("duplicate rows cannot hide a supersession cycle", () => {
  const { outdir } = smallConsolidation(
    ["- [ ] a", "- [ ] b", "- [ ] c"],
    [
      "L6\tSUPERSEDED\tcarried by L7\t",
      "L7\tSUPERSEDED\tcarried by L6\t",
      "L6\tSUPERSEDED\tcarried by L8\t",
      "L7\tSUPERSEDED\tcarried by L8\t",
    ],
  );
  expect(consolidate(process.env, "verify", outdir).status).toBe(0);
  expect(candidates(outdir).map((row) => row.flag)).toEqual([
    "NOREF",
    "NOREF",
    "DUPLICATE",
    "DUPLICATE",
  ]);
});

posixOnly("apply skips a closure whose evidence line now says something else", () => {
  const root = scratch("consolidate-rewritten-");
  const { plan, outdir } = consolidation(root);
  expect(consolidate(fakeGh(STATES), "verify", outdir).status).toBe(0);
  writeFileSync(
    plan,
    readFileSync(plan, "utf8").replace(
      "g closed already evidence: PR 1",
      "z unrelated closed task evidence: PR 2",
    ),
  );
  const run = consolidate(process.env, "apply", outdir, plan, "--time", time);
  expect(run.stdout).toContain("skipped L9: L12 is no longer as verified");
  const open = consolidate(process.env, "apply", outdir, plan, "--dry-run");
  expect(open.stdout).toContain("skipped L9");
});

test("a retried apply cannot rest on a supersession chain that has since broken", () => {
  const { plan, outdir } = smallConsolidation(
    ["- [ ] a", "- [ ] b", "- [ ] c"],
    ["L6\tSUPERSEDED\tcarried by L7\t", "L7\tSUPERSEDED\tcarried by L8\t"],
  );
  expect(consolidate(process.env, "verify", outdir).status).toBe(0);
  const original = readFileSync(plan, "utf8");
  writeFileSync(plan, original.replace("- [ ] a", "- [ ] a edited"));
  const first = consolidate(process.env, "apply", outdir, plan, "--time", time);
  expect(first.stdout).toContain("skipped L6: the line changed since the snapshot");
  expect(lines(plan)[6]).toContain("- [-] b");
  // L6 is restored, but the line at the end of the chain is replaced by an unrelated one.
  writeFileSync(
    plan,
    lines(plan)
      .join("\n")
      .replace("- [ ] a edited", "- [ ] a")
      .replace("- [ ] c", "- [ ] unrelated"),
  );
  const second = consolidate(process.env, "apply", outdir, plan, "--time", time);
  expect(second.stdout).toContain("skipped L6: L8 is no longer as verified");
  expect(lines(plan)[5]).toBe("- [ ] a");
});

test("a line closed earlier in the same run still counts as the evidence for a later one", () => {
  const { plan, outdir } = smallConsolidation(
    ["- [x] a evidence: shipped", "- [ ] b", "- [ ] c"],
    ["L7\tDONE\tshipped on L6\t", "L8\tSUPERSEDED\tcarried by L7\t"],
  );
  expect(consolidate(process.env, "verify", outdir, "--offline").status).toBe(0);
  const run = consolidate(process.env, "apply", outdir, plan, "--time", time);
  expect(run.stdout).toContain("closed 2, already closed 0, skipped 0, failed 0");
  expect(lines(plan)[6]).toContain("- [x] b");
  expect(lines(plan)[7]).toContain("- [-] c");
});

posixOnly("apply refuses when the snapshot changed while verify was waiting on GitHub", () => {
  const root = scratch("consolidate-race-");
  const { plan, outdir } = consolidation(root);
  const env = fakeGh({
    ...STATES,
    mutate: {
      path: join(outdir, "plan.snapshot.md"),
      from: "a merged pull request",
      to: "another task",
    },
  });
  expect(consolidate(env, "verify", outdir).status).toBe(0);
  const run = consolidate(process.env, "apply", outdir, plan, "--time", time);
  expect(run.status).toBe(1);
  expect(run.stderr).toContain("changed since verify");
});

posixOnly(
  "a DONE row is held back by a pull request named in its note or in the line itself",
  () => {
    const { outdir } = smallConsolidation(
      ["- [ ] a waits on acme/tool#2", "- [ ] b", "- [ ] c"],
      [
        "L6\tDONE\tacme/tool#1 merged\t",
        "L7\tDONE\tacme/tool#1 merged\tacme/tool#2 still open",
        "L8\tDONE\tacme/tool#1 merged\tdone",
      ],
    );
    expect(consolidate(fakeGh(STATES), "verify", outdir).status).toBe(0);
    expect(candidates(outdir).map((row) => `L${row.line} ${row.flag}`)).toEqual([
      "L6 BAD",
      "L7 BAD",
      "L8 ok",
    ]);
  },
);

posixOnly("apply skips a closure when the evidence line gained any note of its own", () => {
  const root = scratch("consolidate-appended-");
  const { plan, outdir } = consolidation(root);
  expect(consolidate(fakeGh(STATES), "verify", outdir).status).toBe(0);
  writeFileSync(
    plan,
    readFileSync(plan, "utf8").replace(
      "evidence: PR 1",
      "evidence: PR 1; correction: it was reverted",
    ),
  );
  const run = consolidate(process.env, "apply", outdir, plan, "--time", time);
  expect(run.stdout).toContain("skipped L9: L12 is no longer as verified");
});

posixOnly("a pull request named by its URL holds a DONE closure back like a shorthand one", () => {
  const { outdir } = smallConsolidation(
    [
      "- [ ] a see https://github.com/acme/tool/pull/2",
      "- [ ] b see https://github.com/acme/tool/issues/3",
    ],
    ["L6\tDONE\tacme/tool#1 merged\t", "L7\tDONE\tacme/tool#1 merged\t"],
  );
  expect(consolidate(fakeGh(STATES), "verify", outdir).status).toBe(0);
  expect(candidates(outdir).map((row) => `L${row.line} ${row.flag}`)).toEqual(["L6 BAD", "L7 ok"]);
});

posixOnly("a closure-shaped note added by someone else does not pass for this run's own", () => {
  const root = scratch("consolidate-forged-");
  const { plan, outdir } = consolidation(root);
  expect(consolidate(fakeGh(STATES), "verify", outdir).status).toBe(0);
  writeFileSync(
    plan,
    readFileSync(plan, "utf8").replace(
      "evidence: PR 1",
      "evidence: PR 1 … evidence: correction, release reverted (closed fixed)",
    ),
  );
  const run = consolidate(process.env, "apply", outdir, plan, "--time", time);
  expect(run.stdout).toContain("skipped L9: L12 is no longer as verified");
});

test("a link into a file is not a reference to a ledger line", () => {
  const { outdir } = smallConsolidation(
    ["- [ ] a", "- [x] b evidence: shipped", "- [ ] c"],
    [
      "L6\tDONE\tfixed in https://github.com/acme/tool/blob/main/fix.js#L7 and src/L7\t",
      "L8\tDONE\trecorded on (L7)\t",
    ],
  );
  expect(consolidate(process.env, "verify", outdir, "--offline").status).toBe(0);
  expect(candidates(outdir).map((row) => `${row.flag} ${row.checks.join(",")}`)).toEqual([
    "NOREF ",
    "ok L7:done",
  ]);
});

posixOnly("a DONE row that names a pull request without its owner is held back", () => {
  const { outdir } = smallConsolidation(
    ["- [ ] a land acme/tool#1 and tool#2", "- [ ] b see PR #1 and acme/tool#1"],
    ["L6\tDONE\tacme/tool#1 merged\t", "L7\tDONE\tacme/tool#1 merged\t"],
  );
  expect(consolidate(fakeGh(STATES), "verify", outdir).status).toBe(0);
  expect(candidates(outdir).map((row) => `L${row.line} ${row.flag}`)).toEqual([
    "L6 UNCHECKED",
    "L7 ok",
  ]);
  expect(candidates(outdir)[0]?.checks).toContain("tool#2=no repository");
});

test("a supersession resting on a DONE line also rests on that line's evidence", () => {
  const { outdir } = smallConsolidation(
    ["- [ ] a", "- [ ] b", "- [x] c evidence: shipped"],
    ["L6\tSUPERSEDED\tcarried by L7\t", "L7\tDONE\tshipped on L8\t"],
  );
  expect(consolidate(process.env, "verify", outdir, "--offline").status).toBe(0);
  const first = candidates(outdir)[0];
  expect(first?.flag).toBe("ok");
  expect(first?.lineRefs.map((ref) => ref.line).sort()).toEqual([7, 8]);
});

posixOnly(
  "a bare pull request number holds a DONE closure back unless the same number is checked",
  () => {
    const { outdir } = smallConsolidation(
      [
        "- [ ] a land PR #42",
        "- [ ] b land PR #1",
        "- [ ] c waits on #7",
        "- [x] d evidence: shipped",
      ],
      ["L6\tDONE\tshipped on L9\t", "L7\tDONE\tacme/tool#1 merged\t", "L8\tDONE\tshipped on L9\t"],
    );
    expect(consolidate(fakeGh(STATES), "verify", outdir).status).toBe(0);
    expect(candidates(outdir).map((row) => `L${row.line} ${row.flag}`)).toEqual([
      "L6 UNCHECKED",
      "L7 ok",
      "L8 UNCHECKED",
    ]);
    expect(candidates(outdir)[0]?.checks).toContain("#42=no repository");
  },
);

posixOnly(
  "a repository shorthand is covered by the qualified reference to it, and digits may start a name",
  () => {
    const { outdir } = smallConsolidation(
      ["- [ ] a land tool#1", "- [ ] b land 123tool#2", "- [x] c evidence: shipped"],
      ["L6\tDONE\tacme/tool#1 merged\t", "L7\tDONE\tshipped on L8\t"],
    );
    expect(consolidate(fakeGh(STATES), "verify", outdir).status).toBe(0);
    expect(candidates(outdir).map((row) => `L${row.line} ${row.flag}`)).toEqual([
      "L6 ok",
      "L7 UNCHECKED",
    ]);
    expect(candidates(outdir)[1]?.checks).toContain("123tool#2=no repository");
  },
);

posixOnly("a dropped line is not completion evidence, and PR#n is covered like PR #n", () => {
  const { outdir } = smallConsolidation(
    ["- [ ] a", "- [-] b by: Alice", "- [ ] c land PR#1"],
    ["L6\tDONE\tgiven up on L7\t", "L8\tDONE\tacme/tool#1 merged\t"],
  );
  expect(consolidate(fakeGh(STATES), "verify", outdir).status).toBe(0);
  expect(candidates(outdir).map((row) => `L${row.line} ${row.flag}`)).toEqual(["L6 BAD", "L8 ok"]);
});

test("verify and chunk leave nothing from an earlier snapshot behind", () => {
  const root = scratch("consolidate-leftovers-");
  const many = Array.from({ length: 5 }, (_, i) => `- [ ] item ${i}`);
  const plan = writePlan(root, many);
  const outdir = join(root, "out");
  expect(consolidate(process.env, "chunk", plan, outdir, "--lines", "2").status).toBe(0);
  expect(existsSync(join(outdir, "chunk-03.txt"))).toBe(true);
  expect(consolidate(process.env, "chunk", plan, outdir, "--lines", "10", "--force").status).toBe(
    0,
  );
  expect(existsSync(join(outdir, "chunk-01.txt"))).toBe(true);
  expect(existsSync(join(outdir, "chunk-02.txt"))).toBe(false);
  // A verify that fails because the snapshot is gone still removes the earlier approvals.
  writeFileSync(join(outdir, "closure-candidates.json"), "{}");
  rmSync(join(outdir, "plan.snapshot.md"));
  expect(consolidate(process.env, "verify", outdir).status).toBe(1);
  expect(existsSync(join(outdir, "closure-candidates.json"))).toBe(false);
});

posixOnly("apply skips a closure whose done evidence line was changed to dropped", () => {
  const root = scratch("consolidate-dropped-");
  const { plan, outdir } = consolidation(root);
  expect(consolidate(fakeGh(STATES), "verify", outdir).status).toBe(0);
  writeFileSync(
    plan,
    readFileSync(plan, "utf8").replace(
      "- [x] g closed already evidence: PR 1",
      "- [-] g closed already evidence: PR 1",
    ),
  );
  const run = consolidate(process.env, "apply", outdir, plan, "--time", time);
  expect(run.stdout).toContain("skipped L9: L12 is no longer as verified");
});

posixOnly(
  "a pull request closed without merging, dotted names, long numbers and http links hold a closure back",
  () => {
    const { outdir } = smallConsolidation(
      [
        "- [ ] a land acme/tool#4",
        "- [ ] b land .github#2",
        "- [ ] c land PR #1234567",
        "- [ ] d land http://github.com/acme/tool/pull/2",
        "- [x] e evidence: shipped",
      ],
      [
        "L6\tDONE\tacme/tool#4 closed\t",
        "L7\tDONE\tshipped on L10\t",
        "L8\tDONE\tshipped on L10\t",
        "L9\tDONE\tshipped on L10\t",
      ],
    );
    expect(
      consolidate(fakeGh({ ...STATES, "acme/tool#4": "unmerged" }), "verify", outdir).status,
    ).toBe(0);
    expect(candidates(outdir).map((row) => `L${row.line} ${row.flag}`)).toEqual([
      "L6 BAD",
      "L7 UNCHECKED",
      "L8 UNCHECKED",
      "L9 BAD",
    ]);
  },
);

test("a done line without its evidence field is not evidence that something finished", () => {
  const { outdir } = smallConsolidation(
    ["- [ ] a", "- [x] b", "- [ ] c"],
    ["L6\tDONE\tcompleted at L7\t", "L8\tSUPERSEDED\tcarried by L7\t"],
  );
  expect(consolidate(process.env, "verify", outdir, "--offline").status).toBe(0);
  expect(candidates(outdir).map((row) => `L${row.line} ${row.flag}`)).toEqual([
    "L6 BAD",
    "L8 NOREF",
  ]);
});

posixOnly("a link to GitHub with a differently cased host is still a reference", () => {
  const { outdir } = smallConsolidation(
    ["- [ ] a waits on https://GitHub.com/acme/tool/pull/2", "- [x] b evidence: shipped"],
    ["L6\tDONE\tshipped on L7\t"],
  );
  expect(consolidate(fakeGh(STATES), "verify", outdir).status).toBe(0);
  expect(candidates(outdir)[0]?.flag).toBe("BAD");
});

test("a supporting line closed after verification stops the closure that rests on it", () => {
  const { plan, outdir } = smallConsolidation(
    ["- [ ] a", "- [ ] b by: someone"],
    ["L6\tSUPERSEDED\tcarried by L7\t"],
  );
  expect(consolidate(process.env, "verify", outdir).status).toBe(0);
  writeFileSync(plan, readFileSync(plan, "utf8").replace("- [ ] b", "- [-] b"));
  const run = consolidate(process.env, "apply", outdir, plan, "--time", time);
  expect(run.stdout).toContain("skipped L6: L7 is no longer as verified");
  expect(lines(plan)[5]).toBe("- [ ] a");
});

test("a DONE row that also names a ledger line still open is held back", () => {
  const { outdir } = smallConsolidation(
    ["- [ ] a build and deploy", "- [x] b evidence: built", "- [ ] c deploy"],
    ["L6\tDONE\tbuilt on L7, deployment on L8\t"],
  );
  expect(consolidate(process.env, "verify", outdir, "--offline").status).toBe(0);
  const row = candidates(outdir)[0];
  expect(row?.flag).toBe("BAD");
  expect(row?.checks).toEqual(["L7:done", "L8:open"]);
});

test("a DONE row is held back by an open ledger line in its note or a line that does not exist", () => {
  const { outdir } = smallConsolidation(
    [
      "- [ ] a build and deploy",
      "- [x] b evidence: built",
      "- [ ] c deploy",
      "- [ ] d build and deploy",
    ],
    [
      "L6\tDONE\tbuilt on L7\tdeployment on L8 still open",
      "L9\tDONE\tbuilt on L7; deployment on L99\t",
    ],
  );
  expect(consolidate(process.env, "verify", outdir, "--offline").status).toBe(0);
  expect(
    candidates(outdir).map((row) => `L${row.line} ${row.flag} ${row.checks.join(",")}`),
  ).toEqual(["L6 BAD L7:done", "L9 BAD L7:done,L99=missing"]);
});

test("a DONE row is held back by the item's own open reference, an unproven done line or a missing note reference", () => {
  const { outdir } = smallConsolidation(
    [
      "- [ ] a build L7 and deploy L8",
      "- [x] b evidence: built",
      "- [ ] c deploy",
      "- [ ] d build and deploy",
      "- [x] e deployed",
      "- [ ] f build and deploy",
    ],
    [
      "L6\tDONE\tbuilt on L7\t",
      "L9\tDONE\tbuilt on L7\tdeployed on L99",
      "L8\tDONE\tbuilt on L7\tdeployed on L10",
    ],
  );
  expect(consolidate(process.env, "verify", outdir, "--offline").status).toBe(0);
  expect(candidates(outdir).map((row) => `L${row.line} ${row.flag}`)).toEqual([
    "L6 BAD",
    "L9 BAD",
    "L8 BAD",
  ]);
});

test("apply rechecks a ledger line that only the note named", () => {
  const { plan, outdir } = smallConsolidation(
    ["- [ ] a build and deploy", "- [x] b evidence: built", "- [x] c evidence: deployed"],
    ["L6\tDONE\tbuilt on L7\tdeployed on L8"],
  );
  expect(consolidate(process.env, "verify", outdir, "--offline").status).toBe(0);
  expect(candidates(outdir)[0]?.lineRefs.map((ref) => ref.line)).toEqual([7, 8]);
  writeFileSync(plan, readFileSync(plan, "utf8").replace("- [x] c", "- [ ] c"));
  const run = consolidate(process.env, "apply", outdir, plan, "--time", time);
  expect(run.stdout).toContain("skipped L6: L8 is no longer as verified");
});

test("a dropped line named by a DONE row holds it back", () => {
  const { outdir } = smallConsolidation(
    ["- [ ] a build and deploy", "- [x] b evidence: built", "- [-] c by: user"],
    ["L6\tDONE\tbuilt on L7, deploy dropped on L8\t"],
  );
  expect(consolidate(process.env, "verify", outdir, "--offline").status).toBe(0);
  expect(candidates(outdir).map((row) => `L${row.line} ${row.flag}`)).toEqual(["L6 BAD"]);
});
