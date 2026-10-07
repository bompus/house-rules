import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const scratch = process.env.HOUSE_RULES_TEST_TMP ?? tmpdir();
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true });
  }
});
const script = fileURLToPath(new URL("../scripts/resolve-pr-thread.ts", import.meta.url));
const pr = "https://github.com/owner/app/pull/7";
const head = "a".repeat(40);
const reply = `${pr}#discussion_r2`;

function run(f = {}, args = []) {
  const root = mkdtempSync(join(scratch, "cli-"));
  roots.push(root);
  writeFileSync(join(root, "fixture.json"), JSON.stringify(f));
  const gh = join(root, "gh");
  writeFileSync(
    gh,
    `#!/usr/bin/env bun
const f = await Bun.file(process.env.FIXTURE).json();
const path = process.env.FIXTURE + ".state";
const state = await Bun.file(path).exists() ? await Bun.file(path).json() : {reads:0,mutations:0,mutationTargets:[],resolved:!!f.resolved};
const args = process.argv.slice(2);
const val = k => args.find(a=>a.startsWith(k+"="))?.slice(k.length+1);
if(!args.includes("github.com")) process.exit(1);
const query = val("query");
const user = {__typename:"User",login:"maintainer"};
const actor = f.actor ?? user;
const c = (id, parent) => ({id,url:"${pr}#discussion_r"+id,body:"Fixed and verified.",state:"SUBMITTED",publishedAt:"2026-10-04T00:00:00Z",isMinimized:false,author:user,editor:null,lastEditedAt:null,replyTo:parent ? {id:parent} : null});
const root = c("1",null), reply = {...c("2","1"), ...f.reply};
let data;
if(query.startsWith("mutation")) {
 state.mutations++;
 state.mutationTargets.push(val("thread"));
 if(!f.noCommit && val("thread") === "thread") state.resolved = true;
 data = {resolveReviewThread:{thread:{id:"thread",isResolved:state.resolved}}};
} else {
 state.reads++;
 const changed = f.changeAt && state.reads >= f.changeAt || f.changeOnMutation && state.mutations;
 const t = {__typename:"PullRequestReviewThread",id:"thread",isResolved:state.resolved,isOutdated:!!f.outdated,viewerCanResolve:!f.noResolve,
 pullRequest:{url:f.wrongPR ?? "${pr}",headRefOid:changed ? "b".repeat(40) : "${head}",state:f.prState ?? "OPEN",repository:{viewerPermission:f.permission === undefined ? "ADMIN" : f.permission}},
 comments:{nodes:f.malformed ? [null] : f.missingReply ? [root] : f.paged ? (val("cursor") ? [reply] : [root]) : [root,reply],pageInfo:{hasNextPage:!!f.loop || !!f.paged && !val("cursor"),endCursor:"next"}}};
 if(f.badId) t.id = "other";
 if(f.badBoolean) t.isResolved = [];
 if(f.nullNode) data = {viewer:actor,node:null};
 else data = {viewer:actor,node:t};
 if(f.missingPage) delete t.comments.pageInfo;
}
await Bun.write(path, JSON.stringify(state));
if(query.startsWith("mutation") && f.lostResponse) process.exit(1);
if(query.startsWith("mutation") && f.nullMutation) data.resolveReviewThread.thread = null;
if(f.invalidJSON) { process.stdout.write("broken"); process.exit(0); }
process.stdout.write(JSON.stringify({data,...((f.errors || query.startsWith("mutation") && f.mutationErrors) ? {errors:[{message:"partial"}]} : {})}));
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
      pr,
      "--thread",
      "thread",
      "--expect-head",
      head,
      "--reply-url",
      reply,
      ...args,
    ],
    {
      env: {
        ...process.env,
        FIXTURE: join(root, "fixture.json"),
        PATH: `${root}:${process.env.PATH}`,
        GH_HOST: "wrong.example",
      },
    },
  );
  return {
    code: r.exitCode,
    err: r.stderr.toString(),
    out: r.stdout.toString(),
    state: JSON.parse(readFileSync(join(root, "fixture.json.state"), "utf8")),
  };
}

test("default dry-run reads reply page two and makes no mutation", () => {
  const r = run({ paged: true });
  expect(r.code).toBe(0);
  expect(r.out).toContain("Dry-run: ready");
  expect(r.state.mutations).toBe(0);
  expect(r.state.reads).toBe(3);
});
test("apply resolves exactly one selected thread and verifies fresh state", () => {
  const r = run({}, ["--apply"]);
  expect(r.code).toBe(0);
  expect(r.out).toContain("Verified resolved");
  expect(r.state.mutations).toBe(1);
  expect(r.state.mutationTargets).toEqual(["thread"]);
  expect(r.state.reads).toBe(4);
});
test("resolved no-op and explicitly selected outdated thread", () => {
  const noop = run({ resolved: true, noResolve: true, permission: "READ", prState: "MERGED" }, [
    "--apply",
  ]);
  expect(noop.code).toBe(0);
  expect(noop.state.mutations).toBe(0);
  const old = run({ outdated: true }, ["--apply"]);
  expect(old.code).toBe(0);
  expect(old.state.mutations).toBe(1);
});
const invalid = [
  { wrongPR: "https://github.com/owner/other/pull/7" },
  { badId: true },
  { nullNode: true },
  { noResolve: true },
  { permission: null },
  { permission: "TRIAGE" },
  { permission: ["ADMIN"] },
  { prState: "CLOSED" },
  { missingReply: true },
  { reply: { body: " \n" } },
  { reply: { isMinimized: true } },
  { reply: { state: "PENDING", publishedAt: null } },
  { reply: { state: ["SUBMITTED"] } },
  { reply: { publishedAt: null } },
  { reply: { replyTo: null } },
  { reply: { replyTo: { id: "missing" } } },
  { reply: { author: { __typename: "Bot", login: "maintainer" } } },
  { reply: { author: { __typename: "User", login: "other" } } },
  {
    reply: { lastEditedAt: "2026-10-04T00:00:00Z", editor: { __typename: "User", login: "other" } },
  },
  { actor: { __typename: ["User"], login: "maintainer" } },
  { malformed: true },
  { badBoolean: true },
  { missingPage: true },
  { loop: true },
  { errors: true },
  { invalidJSON: true },
];
test.each(invalid)("rejects invalid identity, reply, permission or partial reads %j", (f) => {
  const r = run(f, ["--apply"]);
  expect(r.code).toBe(2);
  expect(r.state.mutations).toBe(0);
  expect(r.out).not.toContain("Verified resolved");
});
// Enumerate pairs of external events at actual CLI request boundaries.
// Invariants: one mutation maximum, no mutation after an observed push,
// no successful report with a changed head or unresolved final state.
test("event sequences preserve head checks and lost-response safety", () => {
  const events = [
    ...[1, 2, 3, 4].map((changeAt) => ({ name: `push-before-read-${changeAt}`, changeAt })),
    { name: "lost-committed-response", lostResponse: true },
    { name: "lost-uncommitted-response", lostResponse: true, noCommit: true },
  ];
  const violations = [];
  const walk = (sequence, depth) => {
    if (sequence.length) {
      // Two alternative response outcomes cannot happen to the single mutation.
      if (sequence.filter((e) => e.lostResponse).length > 1) {
        return;
      }
      const pushes = sequence.filter((e) => e.changeAt).map((e) => e.changeAt);
      const changeAt = pushes.length ? Math.min(...pushes) : undefined;
      const f = { ...Object.assign({}, ...sequence), changeAt };
      const r = run(f, ["--apply"]);
      const label = sequence.map((e) => e.name).join(" -> ");
      if (r.state.mutations > 1) {
        violations.push(`duplicate mutation: ${label}`);
      }
      if (changeAt <= 2 && r.state.mutations) {
        violations.push(`mutation after observed push: ${label}`);
      }
      if (r.code === 0 && (changeAt || !r.state.resolved)) {
        violations.push(`unverified success: ${label}`);
      }
      if (!changeAt && !f.noCommit && r.code !== 0) {
        violations.push(`committed resolution not verified: ${label}`);
      }
      if (changeAt && !r.err.includes("head differs")) {
        violations.push(`push not detected: ${label}`);
      }
    }
    if (!depth) {
      return;
    }
    for (const event of events) {
      walk([...sequence, event], depth - 1);
    }
  };
  walk([], 2);
  expect(violations).toEqual([]);
}, 20_000);
test("head change during mutation is detected, never rolled back or retried", () => {
  const r = run({ changeOnMutation: true }, ["--apply"]);
  expect(r.code).toBe(2);
  expect(r.state.mutations).toBe(1);
  expect(r.state.resolved).toBe(true);
  expect(r.err).toContain("Mutation attempted once; final verification failed");
  expect(r.err).toContain("Thread may already be resolved");
});
test.each([
  ["lost", { lostResponse: true }],
  ["partial", { mutationErrors: true }],
  ["null", { nullMutation: true }],
])("%s mutation response is read before any retry", (_label, fault) => {
  for (const noCommit of [true, false]) {
    const r = run({ ...fault, noCommit }, ["--apply"]);
    expect(r.state.mutations).toBe(1);
    expect(r.state.reads).toBe(4);
    expect(r.code).toBe(noCommit ? 2 : 0);
    expect(noCommit ? r.err : r.out).toContain(noCommit ? "no retry made" : "fresh state verified");
  }
});
