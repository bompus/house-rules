import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const scratch = process.env.HOUSE_RULES_TEST_TMP ?? tmpdir();
/** @type {string[]} */
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true });
  }
});
const script = fileURLToPath(new URL("../scripts/check-pr-review.ts", import.meta.url));
const head = "a".repeat(40);
/**
 * @param {any[]} [nodes]
 * @param {boolean} [more]
 * @param {string | null} [cursor]
 */
const page = (nodes = [], more = false, cursor = null) => ({
  nodes,
  pageInfo: { hasNextPage: more, endCursor: cursor },
});
/** @param {boolean} isResolved */
const thread = (isResolved) => ({
  isResolved,
  comments: { nodes: [{ url: "https://example.test/thread" }] },
});

/** @param {any} [options] Fixture switches read by the stub `gh`. */
function run(options = {}) {
  const root = mkdtempSync(join(scratch, "cli-"));
  roots.push(root);
  const fixture = join(root, "fixture.json");
  writeFileSync(fixture, JSON.stringify(options));
  const gh = join(root, "gh");
  writeFileSync(
    gh,
    `#!/usr/bin/env bun
const f = await Bun.file(process.env.REVIEW_FIXTURE).json();
const args = process.argv.slice(2);
const val = name => args.find(a => a.startsWith(name + "="))?.slice(name.length + 1);
const query = val("query");
const connection = key => {
  const pages = f[key] ?? [{nodes:[],pageInfo:{hasNextPage:false,endCursor:null}}];
  const page = pages[val(key + "Cursor") ? 1 : 0];
  if (key === "contexts" && !query.includes("name status conclusion")) for (const node of page.nodes) delete node.conclusion;
  if (key === "contexts" && !query.includes("conclusion title completedAt")) for (const node of page.nodes) { delete node.title; delete node.completedAt; }
  return page;
};
const changed = (f.changedHead && val("reviewThreadsCursor")) ||
  (f.finalHeadChange && !query.includes("reviewThreads(first:"));
const pr = {headRefOid:changed ? "b".repeat(40) : "${head}",
  baseRef: "baseRef" in f ? f.baseRef : {branchProtectionRule:null,rules:{pageInfo:{hasNextPage:false},nodes:[]}},
  commits:{nodes:[{commit:{oid:"${head}",committedDate:"committedDate" in f ? f.committedDate : "2026-10-01T00:00:00Z",tree:{entries:[]},
    statusCheckRollup:{contexts:connection("contexts")}}}]},
  reviewThreads:connection("reviewThreads"),reviews:connection("reviews"),comments:connection("comments")};
const response = {data:{viewer:{__typename:"User",login:"maintainer"},
  repository:{viewerPermission:"ADMIN",pullRequest:pr}}};
if(f.errors) response.errors = [{message:"partial failure"}];
if(f.missingPR) response.data.repository.pullRequest = null;
if(f.defaultRepo && ["owner", "name"].some(k => {
 const index = args.findIndex(a => a.startsWith(k + "="));
 return args[index - 1] !== "-F" || val(k) !== (k === "owner" ? "{owner}" : "{repo}");
})) response.data.repository.pullRequest = null;
if(f.malformed) pr.reviewThreads.nodes = [null];
if(f.missingPageInfo) delete pr.reviewThreads.pageInfo;
if(f.nullContexts) pr.commits.nodes[0].commit.statusCheckRollup = null;
process.stdout.write(f.invalidJSON ? "invalid" : JSON.stringify(response));
`,
  );
  chmodSync(gh, 0o755);
  const preload = join(root, "transport.js");
  writeFileSync(
    preload,
    `import { mock } from "bun:test";
import child from "node:child_process";
const run = child.spawnSync.bind(child);
mock.module("node:child_process", () => ({spawnSync: (command, args, options) => {
 if (command !== "gh") throw new Error("Unexpected fixture command");
 return run(process.execPath, [${JSON.stringify(gh)}, ...args], options);
}}));
`,
  );
  const r = Bun.spawnSync(
    [
      process.execPath,
      "--preload",
      preload,
      script,
      "7",
      ...(options.defaultRepo ? [] : ["--repo", "owner/app"]),
    ],
    {
      env: { ...process.env, REVIEW_FIXTURE: fixture },
    },
  );
  return { code: r.exitCode, err: r.stderr.toString(), out: r.stdout.toString() };
}

test("CLI finds unresolved threads beyond the first page", () => {
  const r = run({ reviewThreads: [page([thread(true)], true, "next"), page([thread(false)])] });
  expect(r.code).toBe(1);
  expect(r.err).toContain("unresolved thread: https://example.test/thread");
});

test("CLI reads later review, acknowledgement and status pages", () => {
  const bot = { __typename: "Bot", login: "coderabbitai" };
  const review = {
    author: bot,
    body: "Outside diff range comments",
    submittedAt: "2026-10-03T17:00:00Z",
    lastEditedAt: null,
    url: "https://example.test/review/1",
  };
  const comments = [
    page([], true, "next"),
    page([
      {
        author: { __typename: "User", login: "maintainer" },
        editor: null,
        lastEditedAt: null,
        isMinimized: false,
        createdAt: "2026-10-03T18:00:00Z",
        body: `Review: ${review.url}\nHead: ${head}\nReason: Fixed and verified.`,
      },
    ]),
  ];
  const reviews = [page([], true, "next"), page([review])];
  expect(run({ reviews }).code).toBe(1);
  expect(run({ reviews, comments }).code).toBe(0);
  const r = run({
    contexts: [
      page([], true, "next"),
      page([{ context: "CodeRabbit", state: "PENDING", description: null }]),
    ],
  });
  expect(r.code).toBe(1);
  expect(r.err).toContain("review still running");
});

test("CLI refuses partial, malformed, incomplete and inconsistent API reads", () => {
  for (const options of [
    { errors: true },
    { invalidJSON: true },
    { missingPR: true },
    { malformed: true },
    { missingPageInfo: true },
    { reviewThreads: [page([], true, "next"), page([], true, "next")] },
    { reviewThreads: [page([], true, null)] },
    { changedHead: true, reviewThreads: [page([], true, "next"), page([])] },
  ]) {
    const r = run(options);
    expect(r.code).toBe(2);
    expect(r.out).not.toContain("none open");
  }
});

test("CLI permits complete empty feedback, including a head without status rollup", () => {
  expect(run().code).toBe(0);
  expect(run({ nullContexts: true }).code).toBe(0);
});

test("CLI rejects a head change on the final metadata-only read", () => {
  const r = run({ finalHeadChange: true });
  expect(r.code).toBe(2);
  expect(r.err).toContain("PR head changed during feedback read");
});

test("CLI rejects an unknown actor discriminator instead of overlooking bot findings", () => {
  const r = run({
    reviews: [
      page([
        {
          author: { __typename: "UnexpectedActor", login: "coderabbitai" },
          body: "Outside diff range comments",
          submittedAt: "2026-10-03T17:00:00Z",
          lastEditedAt: null,
          url: "https://example.test/review/1",
        },
      ]),
    ],
  });
  expect(r.code).toBe(2);
});

/** @type {[string, any][]} */
const malformedEnums = [
  [
    "actor",
    {
      reviews: [
        page([
          {
            author: { __typename: ["Bot"], login: "coderabbitai" },
            body: "Outside diff range comments",
            submittedAt: "2026-10-03T17:00:00Z",
            lastEditedAt: null,
            url: "https://example.test/review/1",
          },
        ]),
      ],
    },
  ],
  [
    "status context state",
    {
      contexts: [
        page([{ context: "CodeRabbit", state: ["PENDING"], description: "Review completed" }]),
      ],
    },
  ],
  ["check run status", { contexts: [page([{ name: "CodeRabbit", status: ["COMPLETED"] }])] }],
];
test.each(malformedEnums)("CLI rejects a non-string %s enum", (_name, options) => {
  const r = run(options);
  expect(r.code).toBe(2);
  expect(r.out).not.toContain("none open");
});

test("default gate invocation preserves gh repository placeholder expansion", () => {
  expect(run({ defaultRepo: true }).code).toBe(0);
});

test("CLI checks completed bot conclusions from later pages", () => {
  for (const conclusion of ["FAILURE", "CANCELLED", "SKIPPED", "TIMED_OUT", "NEUTRAL", null]) {
    const r = run({
      contexts: [
        page([], true, "next"),
        page([{ name: "CodeRabbit", status: "COMPLETED", conclusion }]),
      ],
    });
    expect(r.code).toBe(1);
    expect(r.err).toContain("CodeRabbit review concluded");
  }
  expect(
    run({ contexts: [page([{ name: "CodeRabbit", status: "COMPLETED", conclusion: "SUCCESS" }])] })
      .code,
  ).toBe(0);
});

test("CLI lands past a review bot with no quota and names it", () => {
  const limited = {
    name: "cubic · AI code reviewer",
    status: "COMPLETED",
    conclusion: "NEUTRAL",
    title: "AI review line limit reached",
  };
  const r = run({ contexts: [page([limited])] });
  expect(r.code).toBe(0);
  expect(r.out).toContain(
    'skipped review bot cubic · AI code reviewer: no quota (check title "AI review line limit reached")',
  );
  expect(r.out).toContain("review feedback: none open on PR 7 (1 review bot(s) skipped)");
  const withThread = run({ contexts: [page([limited])], reviewThreads: [page([thread(false)])] });
  expect(withThread.code).toBe(1);
  expect(withThread.out).toContain("skipped review bot cubic");
});

test("CLI refuses a malformed cubic check title or completion time", () => {
  for (const bad of [{ title: ["AI review line limit reached"] }, { completedAt: "not a date" }]) {
    const node = {
      name: "cubic · AI code reviewer",
      status: "COMPLETED",
      conclusion: "NEUTRAL",
      ...bad,
    };
    expect(run({ contexts: [page([node])] }).code).toBe(2);
  }
});

test("CLI refuses a head commit with a missing or malformed commit date", () => {
  for (const committedDate of [null, "not a date", 5]) {
    expect(run({ committedDate }).code).toBe(2);
  }
});

const requiredByRuleset = (/** @type {string[]} */ ...contexts) => ({
  branchProtectionRule: null,
  rules: {
    pageInfo: { hasNextPage: false },
    nodes: [
      {
        type: "REQUIRED_STATUS_CHECKS",
        parameters: { requiredStatusChecks: contexts.map((context) => ({ context })) },
      },
    ],
  },
});

test("CLI refuses a required check that has not reported on the head", () => {
  const passing = { name: "check", status: "COMPLETED", conclusion: "SUCCESS" };
  const r = run({ baseRef: requiredByRuleset("check", "windows"), contexts: [page([passing])] });
  expect(r.code).toBe(1);
  expect(r.err).toContain("required check has not reported: windows");
  expect(r.err).not.toContain("required check has not reported: check");
  const both = run({
    baseRef: requiredByRuleset("check", "windows"),
    contexts: [page([passing, { ...passing, name: "windows" }])],
  });
  expect(both.code).toBe(0);
});

test("CLI reads classic branch protection and refuses an incomplete rule list", () => {
  const classic = {
    branchProtectionRule: {
      requiredStatusCheckContexts: ["legacy"],
      requiredStatusChecks: [{ context: "legacy" }],
    },
    rules: { pageInfo: { hasNextPage: false }, nodes: [] },
  };
  const missing = run({ baseRef: classic });
  expect(missing.code).toBe(1);
  expect(missing.err).toContain("required check has not reported: legacy");
  const partial = run({
    baseRef: { ...classic, rules: { pageInfo: { hasNextPage: true }, nodes: [] } },
  });
  expect(partial.code).toBe(2);
  expect(run({ baseRef: null }).code).toBe(2);
});
