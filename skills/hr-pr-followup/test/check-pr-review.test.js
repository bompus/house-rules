import { expect, test } from "bun:test";
import {
  openFeedback,
  requiredCheckNames,
  reviewFeedback,
  waitForReview,
} from "../scripts/check-pr-review.ts";

const bot = { __typename: "Bot", login: "coderabbitai" };
const user = { __typename: "User", login: "maintainer" };

// Resolved threads can coexist with an unanswered outside-diff review finding.
// Returns `any`: tests pass partial nodes that omit fields the real query always returns.
/**
 * @param {{ threads?: any[], reviews?: any[], comments?: any[], contexts?: any[], files?: string[], requiredChecks?: string[] }} [parts]
 * @returns {any}
 */
function pr({
  threads = [],
  reviews = [],
  comments = [],
  contexts = [],
  files = [],
  requiredChecks = [],
} = {}) {
  const tree = { entries: files.map((name) => ({ name })) };
  return {
    headRefOid: "a".repeat(40),
    viewer: user,
    viewerPermission: "ADMIN",
    requiredChecks,
    reviewThreads: { nodes: threads },
    reviews: { nodes: reviews },
    comments: { nodes: comments },
    commits: {
      nodes: [
        {
          commit: {
            committedDate: "2026-10-18T09:00:00Z",
            tree,
            statusCheckRollup: { contexts: { nodes: contexts } },
          },
        },
      ],
    },
  };
}
const outsideDiff = {
  author: bot,
  body: "> **⚠️ Outside diff range comments (1)**",
  submittedAt: "2026-10-03T17:06:01Z",
  lastEditedAt: null,
  url: "https://example.test/review/2",
};

test("passes once threads are resolved, the bot is done and body findings were answered", () => {
  const state = pr({
    threads: [{ isResolved: true, comments: { nodes: [{ url: "u1" }] } }],
    reviews: [outsideDiff],
    comments: [ack()],
    contexts: [
      { context: "CodeRabbit", state: "SUCCESS", description: "Review completed" },
      { name: "check", status: "COMPLETED", conclusion: "SUCCESS" },
    ],
  });
  expect(openFeedback(state)).toEqual([]);
});

test("blocks an outside-diff finding with no human reply after it", () => {
  const state = pr({
    reviews: [outsideDiff],
    comments: [
      { author: user, createdAt: "2026-10-03T17:05:00Z" },
      { author: bot, createdAt: "2026-10-03T17:07:00Z" },
    ],
  });
  expect(openFeedback(state)).toEqual([
    "unanswered findings in a review body: https://example.test/review/2",
  ]);
});

test("a landing waits for the private reviewer's review of the current head", () => {
  /** @param {string} oid */
  const appReview = (oid) => ({
    author: { __typename: "Bot", login: "bompus-ai-review[bot]" },
    body: "**Bompus AI Review** (GPT-6.1 Sol, xhigh reasoning): 1 finding(s).",
    submittedAt: "2026-10-29T23:00:00Z",
    lastEditedAt: null,
    url: "r-app",
    commit: { oid },
  });
  // The App has reviewed this repository before, but only an older head: the gate waits.
  const older = pr({ reviews: [appReview("b".repeat(40))] });
  expect(openFeedback(older).join("\n")).toContain("app review pending");
  // A review of the current head clears it.
  const current = pr({ reviews: [appReview("a".repeat(40))] });
  expect(openFeedback(current).join("\n")).not.toContain("app review pending");
  // A repository the App has never reviewed is unaffected.
  const none = pr({
    reviews: [
      {
        author: { __typename: "Bot", login: "coderabbitai[bot]" },
        body: "",
        submittedAt: null,
        lastEditedAt: null,
        url: "r1",
        commit: null,
      },
    ],
  });
  expect(openFeedback(none).join("\n")).not.toContain("app review pending");
});

test("blocks nitpicks and unrelated later human reviews", () => {
  const nitpick = { ...outsideDiff, body: "🧹 Nitpick comments (2)" };
  expect(openFeedback(pr({ reviews: [nitpick] }))).toHaveLength(1);
  const reply = { author: user, body: "", submittedAt: "2026-10-03T17:10:00Z", url: "r3" };
  expect(openFeedback(pr({ reviews: [nitpick, reply] }))).toHaveLength(1);
});

test("duplicate body findings still need acknowledgement after the earlier thread resolves", () => {
  const duplicate = { ...outsideDiff, body: "♻️ Duplicate comments (1)" };
  const state = pr({
    threads: [{ isResolved: true, comments: { nodes: [{ url: "u1" }] } }],
    reviews: [duplicate],
  });
  expect(openFeedback(state)).toEqual([`unanswered findings in a review body: ${duplicate.url}`]);
  expect(openFeedback({ ...state, comments: { nodes: [ack()] } })).toEqual([]);
});

test("blocks unresolved threads, a review bot still running and another running check", () => {
  const state = pr({
    threads: [{ isResolved: false, comments: { nodes: [{ url: "https://example.test/t1" }] } }],
    contexts: [
      { context: "CodeRabbit", state: "PENDING" },
      { name: "build", status: "IN_PROGRESS" },
    ],
  });
  expect(openFeedback(state)).toEqual([
    "unresolved thread: https://example.test/t1",
    "review still running: CodeRabbit",
    "check still running: build",
  ]);
});

// A configured review with no check must not pass as "nothing running".
test("blocks a repository with .coderabbit.yaml whose head commit has no CodeRabbit check", () => {
  const state = pr({
    files: [".coderabbit.yaml", "README.md"],
    contexts: [{ name: "check", status: "COMPLETED", conclusion: "SUCCESS" }],
  });
  expect(openFeedback(state)).toEqual([
    "no CodeRabbit check on the head commit: check the review integration and repository review policy",
  ]);
  const reviewed = pr({
    files: [".coderabbit.yaml"],
    contexts: [{ context: "CodeRabbit", state: "SUCCESS", description: "Review completed" }],
  });
  expect(openFeedback(reviewed)).toEqual([]);
});

test("does not expect CodeRabbit in a repository without .coderabbit.yaml", () => {
  expect(openFeedback(pr({ files: ["README.md"] }))).toEqual([]);
});

// A skipped review reports success; only the completion description proves review.
test("blocks a CodeRabbit status that is not a completed review", () => {
  const skipped = "Review skipped: reviews are disabled for this base branch";
  const ctx = { context: "CodeRabbit", state: "SUCCESS", description: skipped };
  expect(openFeedback(pr({ contexts: [ctx] }))).toEqual([
    `CodeRabbit did not review the head commit ("${skipped}"): check the review integration and repository review policy`,
  ]);
  const failed = { context: "CodeRabbit", state: "FAILURE", description: "Review failed" };
  expect(openFeedback(pr({ contexts: [failed] }))).toHaveLength(1);
  const otherCheck = { context: "ci/other", state: "SUCCESS", description: "skipped" };
  expect(openFeedback(pr({ contexts: [otherCheck] }))).toEqual([]);
});

test("failed review statuses cannot pass with a completion description", () => {
  for (const state of ["FAILURE", "ERROR"]) {
    const ctx = { context: "CodeRabbit", state, description: "Review completed" };
    expect(openFeedback(pr({ contexts: [ctx] }))).toHaveLength(1);
  }
  const ctx = { context: "CodeRabbit", state: "SUCCESS", description: "Review completed" };
  expect(openFeedback(pr({ contexts: [ctx] }))).toEqual([]);
});

const CUBIC = "cubic · AI code reviewer";
const FOLLOW_UP = "check the review integration and repository review policy";
const CUBIC_RETRY = "comment `@cubic review`";

// cubic posts a CheckRun and its `cubic.yaml` is optional, so only a check that exists can block.
test("blocks a cubic check that is still running", () => {
  for (const status of ["QUEUED", "IN_PROGRESS", "PENDING"]) {
    const ctx = { name: CUBIC, status, conclusion: null };
    expect(openFeedback(pr({ contexts: [ctx] }))).toEqual([`review still running: ${CUBIC}`]);
  }
});

test("blocks a cubic check that concluded without reviewing the head", () => {
  for (const conclusion of ["NEUTRAL", "SKIPPED", "FAILURE", "CANCELLED", "TIMED_OUT", null]) {
    const ctx = { name: CUBIC, status: "COMPLETED", conclusion };
    expect(openFeedback(pr({ contexts: [ctx] }))).toEqual([
      `${CUBIC} review concluded ${conclusion ?? "(missing conclusion)"}: ${FOLLOW_UP}; ${CUBIC_RETRY}`,
    ]);
  }
});

test("passes a successful cubic check and a repository with no cubic check", () => {
  const done = { name: CUBIC, status: "COMPLETED", conclusion: "SUCCESS" };
  expect(openFeedback(pr({ contexts: [done] }))).toEqual([]);
  expect(
    openFeedback(pr({ contexts: [{ name: "check", status: "COMPLETED", conclusion: "SUCCESS" }] })),
  ).toEqual([]);
  // Names that merely contain "cubic" are ordinary checks: no cubic retry advice, same pass rules.
  for (const other of ["bicubic-resize tests", "cubic-tests", "cubic-lint"]) {
    const similar = { name: other, status: "COMPLETED", conclusion: "FAILURE" };
    expect(openFeedback(pr({ contexts: [similar] }))).toEqual([`check ${other} concluded FAILURE`]);
    expect(openFeedback(pr({ contexts: [{ ...similar, conclusion: "SUCCESS" }] }))).toEqual([]);
  }
});

// cubic's check must not stand in for CodeRabbit's when the repository configures CodeRabbit.
test("a successful cubic check does not satisfy the .coderabbit.yaml presence check", () => {
  const done = { name: CUBIC, status: "COMPLETED", conclusion: "SUCCESS" };
  expect(openFeedback(pr({ files: [".coderabbit.yaml"], contexts: [done] }))).toEqual([
    `no CodeRabbit check on the head commit: ${FOLLOW_UP}`,
  ]);
});

test("a cubic commit status needs success but no CodeRabbit description", () => {
  expect(openFeedback(pr({ contexts: [{ context: CUBIC, state: "SUCCESS" }] }))).toEqual([]);
  expect(openFeedback(pr({ contexts: [{ context: CUBIC, state: "FAILURE" }] }))).toHaveLength(1);
});

test("waitForReview polls while cubic runs and stops on its result", async () => {
  const running = pr({ contexts: [{ name: CUBIC, status: "IN_PROGRESS", conclusion: null }] });
  const neutral = pr({ contexts: [{ name: CUBIC, status: "COMPLETED", conclusion: "NEUTRAL" }] });
  let clock = 0;
  const opts = {
    pollMs: 30_000,
    sleep: async (/** @type {number} */ ms) => (clock += ms),
    now: () => clock,
  };
  const reads = [running, running, neutral];
  const open = await waitForReview(() => reads.shift(), { ...opts, timeoutMs: 600_000 });
  expect(clock).toBe(60_000);
  expect(open).toHaveLength(1);
  expect(open[0]).toContain("NEUTRAL");
});

// Hand-written wait loops read a field that stays blank and never stopped; --wait polls this way.
test("waitForReview polls while the review runs and stops when it finishes or time runs out", async () => {
  const running = pr({ contexts: [{ context: "CodeRabbit", state: "PENDING" }] });
  const done = pr({
    contexts: [{ context: "CodeRabbit", state: "SUCCESS", description: "Review completed" }],
  });
  let clock = 0;
  const opts = {
    pollMs: 30_000,
    sleep: async (/** @type {number} */ ms) => (clock += ms),
    now: () => clock,
  };
  const reads = [running, running, done];
  expect(await waitForReview(() => reads.shift(), { ...opts, timeoutMs: 600_000 })).toEqual([]);
  expect(clock).toBe(60_000);

  clock = 0;
  const stuck = await waitForReview(() => running, { ...opts, timeoutMs: 90_000 });
  expect(stuck).toEqual(["review still running: CodeRabbit"]);
  expect(clock).toBe(90_000);

  // Other open feedback alone does not wait: nothing will change it without a person.
  const thread = { isResolved: false, comments: { nodes: [{ url: "t" }] } };
  clock = 0;
  await waitForReview(() => pr({ threads: [thread] }), { ...opts, timeoutMs: 600_000 });
  expect(clock).toBe(0);
});

// Right after a push CodeRabbit has not posted its check yet; --wait used to give up at once.
test("waitForReview waits a few minutes for a CodeRabbit check that has not appeared yet", async () => {
  const files = [".coderabbit.yaml"];
  const missing = pr({
    files,
    contexts: [{ name: "check", status: "COMPLETED", conclusion: "SUCCESS" }],
  });
  const running = pr({ files, contexts: [{ context: "CodeRabbit", state: "PENDING" }] });
  const done = pr({
    files,
    contexts: [{ context: "CodeRabbit", state: "SUCCESS", description: "Review completed" }],
  });
  let clock = 0;
  const opts = {
    pollMs: 30_000,
    sleep: async (/** @type {number} */ ms) => (clock += ms),
    now: () => clock,
  };
  const reads = [missing, missing, running, done];
  expect(await waitForReview(() => reads.shift(), { ...opts, timeoutMs: 1_800_000 })).toEqual([]);

  // A review that never starts stops the wait after the grace period, not the full timeout.
  clock = 0;
  const never = await waitForReview(() => missing, { ...opts, timeoutMs: 1_800_000 });
  expect(never).toEqual([
    "no CodeRabbit check on the head commit: check the review integration and repository review policy",
  ]);
  expect(clock).toBe(180_000);
});

test("blocks any other check that failed, was cancelled or is unfinished, and passes finished ones", () => {
  /**
   * @param {string | null} conclusion
   * @param {string} [status]
   */
  const run = (conclusion, status = "COMPLETED") => ({ name: "build", status, conclusion });
  for (const conclusion of [
    "FAILURE",
    "CANCELLED",
    "TIMED_OUT",
    "ACTION_REQUIRED",
    "STARTUP_FAILURE",
    "STALE",
  ]) {
    expect(openFeedback(pr({ contexts: [run(conclusion)] }))).toEqual([
      `check build concluded ${conclusion}`,
    ]);
  }
  expect(openFeedback(pr({ contexts: [run(null)] }))).toEqual([
    "check build concluded (missing conclusion)",
  ]);
  for (const conclusion of ["SUCCESS", "NEUTRAL", "SKIPPED"]) {
    expect(openFeedback(pr({ contexts: [run(conclusion)] }))).toEqual([]);
  }
  for (const status of ["QUEUED", "IN_PROGRESS", "WAITING", "PENDING", "REQUESTED"]) {
    expect(openFeedback(pr({ contexts: [run(null, status)] }))).toEqual([
      "check still running: build",
    ]);
  }
});

test("never blocks on the advisory shadow review check, whatever its state", () => {
  /** @param {string} status @param {string | null} conclusion */
  const run = (status, conclusion) => ({ name: "shadow review", status, conclusion });
  /** @type {[string, string | null][]} */
  const states = [
    ["QUEUED", null],
    ["IN_PROGRESS", null],
    ["COMPLETED", "FAILURE"],
    ["COMPLETED", "CANCELLED"],
    ["COMPLETED", "STARTUP_FAILURE"],
  ];
  for (const [status, conclusion] of states) {
    expect(openFeedback(pr({ contexts: [run(status, conclusion)] }))).toEqual([]);
  }
  // Other checks keep their authority beside it, including one with a similar name.
  const build = { name: "build", status: "COMPLETED", conclusion: "FAILURE" };
  const similar = { name: "shadow review 2", status: "COMPLETED", conclusion: "FAILURE" };
  expect(openFeedback(pr({ contexts: [run("QUEUED", null), build, similar] }))).toEqual([
    "check build concluded FAILURE",
    "check shadow review 2 concluded FAILURE",
  ]);
});

test("blocks a commit status that is not SUCCESS", () => {
  /** @param {string} state */
  const status = (state) => ({ context: "ci/legacy", state, description: null });
  expect(openFeedback(pr({ contexts: [status("SUCCESS")] }))).toEqual([]);
  for (const state of ["PENDING", "EXPECTED"]) {
    expect(openFeedback(pr({ contexts: [status(state)] }))).toEqual([
      "check still running: ci/legacy",
    ]);
  }
  for (const state of ["FAILURE", "ERROR"]) {
    expect(openFeedback(pr({ contexts: [status(state)] }))).toEqual([
      `check ci/legacy reported ${state}`,
    ]);
  }
});

test("waitForReview polls while another check runs and returns its failure", async () => {
  const running = pr({ contexts: [{ name: "build", status: "IN_PROGRESS", conclusion: null }] });
  const failed = pr({ contexts: [{ name: "build", status: "COMPLETED", conclusion: "FAILURE" }] });
  let clock = 0;
  const opts = {
    pollMs: 30_000,
    sleep: async (/** @type {number} */ ms) => (clock += ms),
    now: () => clock,
  };
  const reads = [running, running, failed];
  expect(await waitForReview(() => reads.shift(), { ...opts, timeoutMs: 600_000 })).toEqual([
    "check build concluded FAILURE",
  ]);
  expect(clock).toBe(60_000);
});

function ack(overrides = {}) {
  return {
    author: user,
    editor: null,
    lastEditedAt: null,
    isMinimized: false,
    createdAt: "2026-10-03T17:08:31Z",
    body: `Review: ${outsideDiff.url}\nHead: ${"a".repeat(40)}\nReason: The finding was fixed and verified in the current head.`,
    ...overrides,
  };
}

test("only an explicit acknowledgement by the authorized viewer clears its review and head", () => {
  const valid = ack();
  expect(openFeedback(pr({ reviews: [outsideDiff], comments: [valid] }))).toEqual([]);
  for (const invalid of [
    ack({ body: "Thanks, I will look at it." }),
    ack({ body: valid.body.replace(outsideDiff.url, "https://example.test/review/other") }),
    ack({ body: valid.body.replace("a".repeat(40), "b".repeat(40)) }),
    ack({ body: valid.body.replace(/Reason:.*/, "Reason: ") }),
    ack({ author: { __typename: "User", login: "stranger" } }),
    ack({ author: bot }),
    ack({ author: null }),
    ack({ isMinimized: true }),
    ack({ createdAt: outsideDiff.submittedAt }),
    ack({ lastEditedAt: "2026-10-03T17:09:00Z", editor: bot }),
    ack({ lastEditedAt: "2026-10-03T17:09:00Z", editor: null }),
  ]) {
    expect(openFeedback(pr({ reviews: [outsideDiff], comments: [invalid] }))).toHaveLength(1);
  }
  for (const permission of [null, "READ", "TRIAGE"]) {
    const state = pr({ reviews: [outsideDiff], comments: [valid] });
    state.viewerPermission = permission;
    expect(openFeedback(state)).toHaveLength(1);
  }
  const editedReview = { ...outsideDiff, lastEditedAt: "2026-10-03T17:10:00Z" };
  expect(openFeedback(pr({ reviews: [editedReview], comments: [valid] }))).toHaveLength(1);
  const selfEdited = ack({ lastEditedAt: "2026-10-03T17:09:00Z", editor: user });
  expect(openFeedback(pr({ reviews: [outsideDiff], comments: [selfEdited] }))).toEqual([]);
});

test("one acknowledgement does not clear another body review", () => {
  const other = { ...outsideDiff, url: "https://example.test/review/other" };
  expect(openFeedback(pr({ reviews: [outsideDiff, other], comments: [ack()] }))).toEqual([
    `unanswered findings in a review body: ${other.url}`,
  ]);
});

// A bot that reports no quota or capacity is skipped with its reason; the bots that reviewed still gate.
const cubicBot = { __typename: "Bot", login: "cubic-dev-ai" };
const lineLimit = {
  name: CUBIC,
  status: "COMPLETED",
  conclusion: "NEUTRAL",
  title: "AI review line limit reached",
  completedAt: "2026-10-18T10:00:00Z",
};
/**
 * @param {string} createdAt
 * @param {{ __typename: string, login: string }} [author]
 */
const outOfQuota = (createdAt, author = cubicBot) => ({
  author,
  isMinimized: false,
  body: "@bompus cubic can't start this review because your workspace has reached its free monthly review limit.",
  createdAt,
});
const rateLimitComment = {
  author: bot,
  body: "<!-- This is an auto-generated comment: rate limited by coderabbit.ai -->\n> ## Review limit reached",
  createdAt: "2026-10-18T10:00:00Z",
};

test("skips a cubic check that ran out of its line quota and names the reason", () => {
  expect(reviewFeedback(pr({ contexts: [lineLimit] }))).toEqual({
    open: [],
    skipped: [`${CUBIC}: no quota (check title "AI review line limit reached")`],
  });
  // A NEUTRAL check with another title is skipped only when cubic said, after that check, that it is out of quota.
  const rewrite = { ...lineLimit, title: "Automatic AI review not started after branch rewrite" };
  expect(openFeedback(pr({ contexts: [rewrite] }))).toHaveLength(1);
  expect(
    reviewFeedback(pr({ contexts: [rewrite], comments: [outOfQuota("2026-10-18T10:05:00Z")] })),
  ).toEqual({
    open: [],
    skipped: [
      `${CUBIC}: no quota (it commented after this check that the monthly review limit is reached)`,
    ],
  });
  // An older limit comment, the same words from a person or another bot, a check with no completion
  // time, or a failed cubic check still refuse.
  for (const comment of [
    outOfQuota("2026-09-18T10:00:00Z"),
    { ...outOfQuota("2026-10-18T10:05:00Z"), isMinimized: true },
    outOfQuota("2026-10-18T10:05:00Z", user),
    outOfQuota("2026-10-18T10:05:00Z", { __typename: "Bot", login: "bicubic-bot" }),
  ]) {
    expect(openFeedback(pr({ contexts: [rewrite], comments: [comment] }))).toHaveLength(1);
  }
  const undated = { ...rewrite, completedAt: null };
  expect(
    openFeedback(pr({ contexts: [undated], comments: [outOfQuota("2026-10-18T10:05:00Z")] })),
  ).toHaveLength(1);
  expect(openFeedback(pr({ contexts: [{ ...lineLimit, conclusion: "FAILURE" }] }))).toHaveLength(1);
});

test("skips a rate-limited CodeRabbit and keeps every other reason to refuse", () => {
  const files = [".coderabbit.yaml"];
  for (const description of ["Review rate limited", "Review limit reached"]) {
    const status = { context: "CodeRabbit", state: "SUCCESS", description };
    expect(reviewFeedback(pr({ files, contexts: [status] }))).toEqual({
      open: [],
      skipped: [`CodeRabbit: no capacity (status "${description}")`],
    });
  }
  // A rate-limit comment alone skips nothing: a missing check, a failed status and other skipped
  // statuses still refuse.
  expect(openFeedback(pr({ files, comments: [rateLimitComment] }))).toEqual([
    `no CodeRabbit check on the head commit: ${FOLLOW_UP}`,
  ]);
  const failed = { context: "CodeRabbit", state: "FAILURE", description: "Review rate limited" };
  expect(openFeedback(pr({ contexts: [failed], comments: [rateLimitComment] }))).toHaveLength(1);
  for (const description of [
    "Review skipped: reviews are disabled for this base branch",
    "Review skipped: manual review required for this OSS repository",
  ]) {
    const ctx = { context: "CodeRabbit", state: "SUCCESS", description };
    expect(openFeedback(pr({ contexts: [ctx], comments: [rateLimitComment] }))).toHaveLength(1);
  }
  // A skipped bot does not clear an open thread or a failing check from elsewhere.
  const status = { context: "CodeRabbit", state: "SUCCESS", description: "Review rate limited" };
  const thread = { isResolved: false, comments: { nodes: [{ url: "u1" }] } };
  const ci = { name: "check", status: "COMPLETED", conclusion: "FAILURE" };
  expect(reviewFeedback(pr({ threads: [thread], contexts: [status, lineLimit, ci] }))).toEqual({
    open: ["unresolved thread: u1", "check check concluded FAILURE"],
    skipped: [
      'CodeRabbit: no capacity (status "Review rate limited")',
      `${CUBIC}: no quota (check title "AI review line limit reached")`,
    ],
  });
});

// CodeRabbit answers a review command at its limit with a comment, and its check run for the head
// concludes SKIPPED with only the title "Review skipped".
const skippedRun = {
  name: "CodeRabbit",
  status: "COMPLETED",
  conclusion: "SKIPPED",
  title: "Review skipped",
  completedAt: "2026-10-18T10:05:00Z",
};
const limitReply = {
  author: bot,
  editor: null,
  lastEditedAt: null,
  isMinimized: false,
  createdAt: "2026-10-18T10:00:00Z",
  body: "<!-- coderabbit-ai-generated:v1 -->\n<details>\n<summary>⚠️ Action not completed</summary>\n<dl>\n<dd>\n\nReview rate limited.\n\n---\n\nYour included review limit is currently reached. Your next included review will be available in 51 minutes.\n\n</dd>\n</dl>\n</details>",
};

test("skips a SKIPPED CodeRabbit check when its latest reply said the review limit is reached", () => {
  const files = [".coderabbit.yaml"];
  const result = reviewFeedback(pr({ files, contexts: [skippedRun], comments: [limitReply] }));
  expect(result.open).toEqual([]);
  expect(result.skipped).toHaveLength(1);
  expect(result.skipped[0]).toContain("CodeRabbit: no capacity");
  // A push made while limited gets the SKIPPED check with no new reply, so the reply may precede the head commit.
  const earlier = { ...limitReply, createdAt: "2026-10-18T08:00:00Z" };
  expect(openFeedback(pr({ files, contexts: [skippedRun], comments: [earlier] }))).toEqual([]);
  // A newer reply that is not the limit message (even one a person edited), a CodeRabbit review after
  // the reply, no reply, a hidden or foreign reply, another skip title, or another conclusion still refuse.
  const failure = {
    ...limitReply,
    createdAt: "2026-10-18T10:06:00Z",
    body: "<details><summary>❌ Action failed</summary><dl><dd>Review failed. The pull request is too large to review.</dd></dl></details>",
  };
  const review = { author: bot, body: "", submittedAt: "2026-10-18T10:30:00Z", url: "r1" };
  const sameSecond = { ...failure, createdAt: limitReply.createdAt };
  const performed = {
    ...limitReply,
    createdAt: "2026-10-18T10:01:00Z",
    body: "<details><summary>✅ Action performed</summary><dl><dd>Full review finished.</dd></dl></details>",
  };
  for (const { ctx, comments } of [
    { ctx: skippedRun, comments: [] },
    { ctx: skippedRun, comments: [limitReply, performed] },
    { ctx: skippedRun, comments: [limitReply, failure] },
    {
      ctx: skippedRun,
      comments: [limitReply, { ...failure, lastEditedAt: "2026-10-18T10:07:00Z", editor: user }],
    },
    { ctx: skippedRun, comments: [limitReply, sameSecond] },
    { ctx: skippedRun, comments: [sameSecond, limitReply] },
    {
      ctx: skippedRun,
      comments: [limitReply, { ...failure, body: `A note a person added.\n${failure.body}` }],
    },
    {
      ctx: skippedRun,
      comments: [
        limitReply,
        { ...failure, body: "Review failed.", lastEditedAt: "2026-10-18T10:07:00Z", editor: user },
      ],
    },
    {
      ctx: skippedRun,
      comments: [
        limitReply,
        {
          ...limitReply,
          createdAt: "2026-10-18T10:06:00Z",
          body: "<!-- summary -->\n> ## Review skipped\n> This PR contains 154 files, which is 54 over the limit of 100.",
        },
      ],
    },
    {
      ctx: skippedRun,
      comments: [limitReply, { ...failure, isMinimized: true }],
    },
    {
      ctx: skippedRun,
      comments: [{ ...failure, isMinimized: true }, limitReply, { ...failure, isMinimized: true }],
    },
    { ctx: skippedRun, comments: [{ ...limitReply, isMinimized: true }] },
    { ctx: skippedRun, comments: [{ ...limitReply, author: user }] },
    { ctx: skippedRun, comments: [{ ...limitReply, body: "Review rate limited." }] },
    { ctx: { ...skippedRun, title: "Review failed" }, comments: [limitReply] },
    { ctx: { ...skippedRun, conclusion: "FAILURE" }, comments: [limitReply] },
  ]) {
    expect(openFeedback(pr({ files, contexts: [ctx], comments }))).toHaveLength(1);
  }
  expect(
    openFeedback(pr({ files, contexts: [skippedRun], comments: [earlier], reviews: [review] })),
  ).toHaveLength(1);
  const sameTime = { ...review, submittedAt: limitReply.createdAt };
  expect(
    openFeedback(
      pr({ files, contexts: [skippedRun], comments: [limitReply], reviews: [sameTime] }),
    ),
  ).toHaveLength(1);
});

test("accepts a neutral CodeRabbit rate-limit reply only after the head commit", () => {
  const neutral = { ...skippedRun, conclusion: "NEUTRAL", title: null };
  const result = reviewFeedback(pr({ contexts: [neutral], comments: [limitReply] }));
  expect(result.open).toEqual([]);
  expect(result.skipped).toHaveLength(1);
  expect(result.skipped[0]).toContain("CodeRabbit: no capacity");
  for (const createdAt of ["2026-10-18T08:00:00Z", "2026-10-18T09:00:00Z"]) {
    expect(
      openFeedback(pr({ contexts: [neutral], comments: [{ ...limitReply, createdAt }] })),
    ).toHaveLength(1);
  }
  const failure = {
    ...limitReply,
    createdAt: "2026-10-18T10:06:00Z",
    body: "<details><summary>❌ Action failed</summary><dd>Review failed.</dd></details>",
  };
  for (const comments of [
    [],
    [{ ...limitReply, author: user }],
    [{ ...limitReply, isMinimized: true }],
    [{ ...limitReply, lastEditedAt: "2026-10-18T10:01:00Z", editor: user }],
    [
      {
        ...limitReply,
        createdAt: "2026-10-18T08:00:00Z",
        lastEditedAt: limitReply.createdAt,
        editor: bot,
      },
    ],
    [limitReply, failure],
    [limitReply, { ...failure, createdAt: limitReply.createdAt }],
  ]) {
    expect(openFeedback(pr({ contexts: [neutral], comments }))).toHaveLength(1);
  }
  const review = { author: bot, body: "", submittedAt: limitReply.createdAt, url: "r1" };
  expect(
    openFeedback(pr({ contexts: [neutral], comments: [limitReply], reviews: [review] })),
  ).toHaveLength(1);
  for (const context of [
    { ...neutral, status: "IN_PROGRESS" },
    { ...neutral, conclusion: "FAILURE" },
    { ...neutral, conclusion: "CANCELLED" },
  ]) {
    expect(openFeedback(pr({ contexts: [context], comments: [limitReply] }))).toHaveLength(1);
  }
  expect(
    openFeedback(
      pr({
        contexts: [neutral],
        comments: [limitReply],
        threads: [{ isResolved: false, comments: { nodes: [{ url: "u1" }] } }],
      }),
    ),
  ).toEqual(["unresolved thread: u1"]);
});

const fileLimit = {
  context: "CodeRabbit",
  state: "SUCCESS",
  description: "Review skipped: 154 files exceed the limit of 100",
};
const capacityComment = {
  author: bot,
  editor: null,
  lastEditedAt: null,
  isMinimized: false,
  createdAt: "2026-10-18T10:00:00Z",
  body: `> ## Review skipped
> This PR contains 154 files, which is 54 over the limit of 100.
> This review couldn't start because sufficient usage credits or metered capacity aren't available.
> Reviewing files that changed from the base of the PR and between ${"b".repeat(40)} and ${"a".repeat(40)}.`,
};

test("accepts explicit current-head CodeRabbit credit capacity evidence, not a file limit alone", () => {
  expect(openFeedback(pr({ contexts: [fileLimit] }))).toHaveLength(1);
  const result = reviewFeedback(pr({ contexts: [fileLimit], comments: [capacityComment] }));
  expect(result.open).toEqual([]);
  expect(result.skipped).toHaveLength(1);
  expect(result.skipped[0]).toContain("CodeRabbit: no capacity");
  expect(result.skipped[0]).toContain("current-head");
  // CodeRabbit updates its original summary for later heads, rather than posting a new one.
  expect(
    openFeedback(
      pr({
        contexts: [fileLimit],
        comments: [
          {
            ...capacityComment,
            createdAt: "2026-10-18T08:00:00Z",
            lastEditedAt: "2026-10-18T10:00:00Z",
            editor: bot,
          },
        ],
      }),
    ),
  ).toEqual([]);
});

test("rejects stale, foreign, hidden or unbound CodeRabbit capacity evidence", () => {
  for (const comment of [
    { ...capacityComment, body: "> Too many files! This PR exceeds the limit of 100." },
    {
      ...capacityComment,
      body: capacityComment.body.replace(
        "This review couldn't start because sufficient usage credits or metered capacity aren't available.",
        "Upgrade to a paid plan to raise the file limit.",
      ),
    },
    { ...capacityComment, body: capacityComment.body.replace("a".repeat(40), "c".repeat(40)) },
    { ...capacityComment, body: capacityComment.body.split("\n").slice(0, -1).join("\n") },
    {
      ...capacityComment,
      body: capacityComment.body.replace("a".repeat(40), "a".repeat(40) + "1"),
    },
    {
      ...capacityComment,
      body:
        capacityComment.body +
        "\nReviewing files that changed from the base of the PR and between " +
        "a".repeat(40) +
        " and " +
        "c".repeat(40) +
        ".",
    },
    { ...capacityComment, author: user },
    { ...capacityComment, author: { __typename: "Bot", login: "other-review-bot" } },
    { ...capacityComment, isMinimized: true },
    { ...capacityComment, createdAt: "2026-10-18T08:59:59Z" },
    { ...capacityComment, createdAt: "2026-10-18T09:00:00Z" },
    { ...capacityComment, createdAt: "invalid date" },
    { ...capacityComment, lastEditedAt: "2026-10-18T10:01:00Z", editor: user },
    { ...capacityComment, lastEditedAt: "2026-10-18T10:01:00Z", editor: null },
    {
      ...capacityComment,
      lastEditedAt: "2026-10-18T10:01:00Z",
      editor: { __typename: "Bot", login: "other-review-bot" },
    },
  ]) {
    const result = reviewFeedback(pr({ contexts: [fileLimit], comments: [comment] }));
    expect(result.open).toHaveLength(1);
    expect(result.skipped).toEqual([]);
  }
});

const neutralCodeRabbit = { name: "CodeRabbit", status: "COMPLETED", conclusion: "NEUTRAL" };
const quotaComment = {
  ...capacityComment,
  body: capacityComment.body.replace(
    "This review couldn't start because sufficient usage credits or metered capacity aren't available.",
    "Review limit reached. You've used all free OSS reviews for now.",
  ),
};

test("accepts a neutral CodeRabbit check only with authenticated current-head quota evidence", () => {
  for (const phrase of ["Review limit reached", "Review rate limited"]) {
    const result = reviewFeedback(
      pr({
        contexts: [neutralCodeRabbit],
        comments: [
          { ...quotaComment, body: quotaComment.body.replace("Review limit reached", phrase) },
        ],
      }),
    );
    expect(result.open).toEqual([]);
    expect(result.skipped).toEqual([
      "CodeRabbit: no quota (authenticated current-head comment reports a review limit)",
    ]);
  }
  for (const comment of [
    { ...quotaComment, author: user },
    { ...quotaComment, isMinimized: true },
    { ...quotaComment, createdAt: "2026-10-18T08:00:00Z" },
    { ...quotaComment, lastEditedAt: "2026-10-18T11:00:00Z", editor: user },
    { ...quotaComment, body: quotaComment.body.replace("a".repeat(40), "c".repeat(40)) },
    { ...quotaComment, body: "Review limit reached" },
    {
      ...quotaComment,
      body: quotaComment.body.replace("Review limit reached", "<!-- Review limit reached -->"),
    },
    capacityComment,
  ]) {
    const result = reviewFeedback(pr({ contexts: [neutralCodeRabbit], comments: [comment] }));
    expect(result.open).toHaveLength(1);
    expect(result.skipped).toEqual([]);
  }
});

test("quota evidence cannot clear failed, running or superseding failure gates", () => {
  for (const context of [
    { ...neutralCodeRabbit, status: "IN_PROGRESS" },
    ...["FAILURE", "CANCELLED", "TIMED_OUT", "SKIPPED"].map((conclusion) => ({
      ...neutralCodeRabbit,
      conclusion,
    })),
  ]) {
    const result = reviewFeedback(pr({ contexts: [context], comments: [quotaComment] }));
    expect(result.open).toHaveLength(1);
    expect(result.skipped).toEqual([]);
  }
  const result = reviewFeedback(
    pr({
      contexts: [neutralCodeRabbit],
      comments: [quotaComment, bareFailure("2026-10-18T11:00:00Z")],
    }),
  );
  expect(result.open).toHaveLength(1);
  expect(result.skipped).toEqual([]);
});

test("capacity comments cannot clear pending, failed, missing or unrelated review gates", () => {
  for (const state of ["PENDING", "FAILURE", "ERROR"]) {
    const result = reviewFeedback(
      pr({ contexts: [{ ...fileLimit, state }], comments: [capacityComment] }),
    );
    expect(result.open).toHaveLength(1);
    expect(result.skipped).toEqual([]);
  }
  expect(
    openFeedback(pr({ files: [".coderabbit.yaml"], comments: [capacityComment] })),
  ).toHaveLength(1);
  const result = reviewFeedback(
    pr({
      contexts: [fileLimit, { name: "check", status: "COMPLETED", conclusion: "FAILURE" }],
      comments: [capacityComment],
      threads: [{ isResolved: false, comments: { nodes: [{ url: "unresolved" }] } }],
      reviews: [outsideDiff],
    }),
  );
  expect(result.open).toEqual([
    "unresolved thread: unresolved",
    "check check concluded FAILURE",
    `unanswered findings in a review body: ${outsideDiff.url}`,
  ]);
  expect(result.skipped).toHaveLength(1);
});

// CodeRabbit answers a review command that failed without a reason with "Review failed." and leaves
// the status on "Review skipped". One re-trigger is expected; a second failure an hour or more later
// is treated like a bot with no capacity.
const manualOnly = {
  context: "CodeRabbit",
  state: "SUCCESS",
  description: "Review skipped: manual review required for this OSS repository",
};
/** @param {string} createdAt @param {string} [reason] */
const bareFailure = (createdAt, reason = "Review failed.") => ({
  author: bot,
  isMinimized: false,
  createdAt,
  body: `<!-- This is an auto-generated reply by CodeRabbit -->\n<!-- CodeRabbit review command invocation: v2:abc -->\n<details>\n<summary>❌ Action failed</summary>\n\n${reason}\n\n</details>`,
});
/** @param {string} createdAt */
const retrigger = (createdAt) => ({
  author: user,
  isMinimized: false,
  createdAt,
  body: "@coderabbitai full review",
});
const skippedStatus = `CodeRabbit did not review the head commit ("${manualOnly.description}"): ${FOLLOW_UP}`;

test("credit evidence cannot be hidden in HTML comments", () => {
  for (const body of [
    `<!-- ${capacityComment.body} -->`,
    capacityComment.body.replace(
      "This review couldn't start because sufficient usage credits or metered capacity aren't available.",
      "<!-- This review couldn't start because sufficient usage credits or metered capacity aren't available. -->",
    ),
    capacityComment.body.replace(/Reviewing files[^\n]+/, (range) => `<!-- ${range} -->`),
  ]) {
    expect(
      reviewFeedback(pr({ contexts: [fileLimit], comments: [{ ...capacityComment, body }] })),
    ).toMatchObject({ open: [expect.any(String)], skipped: [] });
  }
});

test("credit evidence does not excuse manual or disabled review statuses", () => {
  for (const description of [
    manualOnly.description,
    "Review skipped: reviews are disabled for this base branch",
  ]) {
    expect(
      reviewFeedback(
        pr({ contexts: [{ ...fileLimit, description }], comments: [capacityComment] }),
      ),
    ).toMatchObject({ open: [expect.any(String)], skipped: [] });
  }
});

test("a later failure supersedes credit evidence for the same head", () => {
  for (const reason of [
    "Review failed.",
    "Review failed. The pull request is too large to review.",
  ]) {
    for (const comments of [
      [capacityComment, bareFailure("2026-10-18T11:30:00Z", reason)],
      [bareFailure("2026-10-18T11:30:00Z", reason), capacityComment],
      [
        capacityComment,
        {
          ...bareFailure("2026-10-18T09:30:00Z", reason),
          lastEditedAt: "2026-10-18T11:30:00Z",
          editor: bot,
        },
      ],
    ]) {
      expect(reviewFeedback(pr({ contexts: [fileLimit], comments }))).toMatchObject({
        open: [expect.any(String)],
        skipped: [],
      });
    }
  }
  // A newer explicit capacity summary can supersede an earlier failure.
  expect(
    openFeedback(
      pr({
        contexts: [fileLimit],
        comments: [bareFailure("2026-10-18T09:30:00Z"), capacityComment],
      }),
    ),
  ).toEqual([]);
});

test("foreign edits cannot erase a later CodeRabbit failure", () => {
  for (const editor of [user, null, { __typename: "Bot", login: "other-review-bot" }]) {
    const failure = {
      ...bareFailure(
        "2026-10-18T11:00:00Z",
        "Review failed. The pull request is too large to review.",
      ),
      lastEditedAt: "2026-10-18T11:30:00Z",
      editor,
    };
    expect(
      reviewFeedback(pr({ contexts: [fileLimit], comments: [capacityComment, failure] })),
    ).toMatchObject({
      open: [expect.any(String)],
      skipped: [],
    });
  }
});

test("a first bare CodeRabbit failure asks for one re-trigger and says when it failed", () => {
  const state = pr({
    contexts: [manualOnly],
    comments: [retrigger("2026-10-18T09:26:00Z"), bareFailure("2026-10-18T09:52:11Z")],
  });
  expect(reviewFeedback(state)).toEqual({
    open: [
      "CodeRabbit failed without a stated reason at 2026-10-18T09:52:11.000Z; re-trigger it once with `@coderabbitai full review`, then rerun this check",
    ],
    skipped: [],
  });
});

test("after the re-trigger the pull request waits for the new review", () => {
  const state = pr({
    contexts: [manualOnly],
    comments: [bareFailure("2026-10-18T09:52:11Z"), retrigger("2026-10-18T09:54:17Z")],
  });
  expect(openFeedback(state)).toEqual([
    `CodeRabbit was re-triggered at 2026-10-18T09:54:17.000Z after a failure without a stated reason at 2026-10-18T09:52:11.000Z; wait for its review to start, then rerun this check (${FOLLOW_UP} if it never does)`,
  ]);
  // A review that finished clears the earlier failure.
  const done = { context: "CodeRabbit", state: "SUCCESS", description: "Review completed" };
  expect(openFeedback({ ...state, commits: pr({ contexts: [done] }).commits })).toEqual([]);
});

test("a second bare failure inside an hour of the re-trigger still refuses and says when to look again", () => {
  const state = pr({
    contexts: [manualOnly],
    comments: [
      bareFailure("2026-10-18T09:52:11Z"),
      retrigger("2026-10-18T09:54:17Z"),
      bareFailure("2026-10-18T10:54:16Z"),
    ],
  });
  expect(reviewFeedback(state)).toEqual({
    open: [
      "CodeRabbit failed again without a stated reason at 2026-10-18T10:54:16.000Z, inside an hour of the re-trigger at 2026-10-18T09:54:17.000Z; after 2026-10-18T10:54:17.000Z comment `@coderabbitai full review` once more: a bare failure at or after that time counts as no capacity",
    ],
    skipped: [],
  });
});

test("a second bare failure an hour or more after the re-trigger skips CodeRabbit as out of capacity", () => {
  const state = pr({
    contexts: [manualOnly],
    comments: [
      bareFailure("2026-10-18T09:52:11Z"),
      retrigger("2026-10-18T09:54:17Z"),
      bareFailure("2026-10-18T10:54:17Z"),
    ],
  });
  expect(reviewFeedback(state)).toEqual({
    open: [],
    skipped: [
      "CodeRabbit: no capacity (it failed without a stated reason at 2026-10-18T09:52:11.000Z and again at 2026-10-18T10:54:17.000Z, an hour or more after the re-trigger at 2026-10-18T09:54:17.000Z)",
    ],
  });
  // The skip clears only CodeRabbit: an open thread elsewhere still refuses.
  const thread = { isResolved: false, comments: { nodes: [{ url: "u1" }] } };
  expect(reviewFeedback({ ...state, reviewThreads: { nodes: [thread] } }).open).toEqual([
    "unresolved thread: u1",
  ]);
});

test("a later re-trigger does not restart the hour", () => {
  const state = pr({
    contexts: [manualOnly],
    comments: [
      bareFailure("2026-10-18T09:52:11Z"),
      retrigger("2026-10-18T09:54:17Z"),
      bareFailure("2026-10-18T09:56:00Z"),
      retrigger("2026-10-18T11:00:00Z"),
      bareFailure("2026-10-18T11:02:00Z"),
    ],
  });
  expect(reviewFeedback(state).skipped).toEqual([
    "CodeRabbit: no capacity (it failed without a stated reason at 2026-10-18T09:52:11.000Z and again at 2026-10-18T11:02:00.000Z, an hour or more after the re-trigger at 2026-10-18T09:54:17.000Z)",
  ]);
});

test("a CodeRabbit failure that states a reason keeps the usual refusal", () => {
  const comments = [
    bareFailure("2026-10-18T09:52:11Z", "Review failed. The pull request is too large to review."),
    retrigger("2026-10-18T09:54:17Z"),
    bareFailure("2026-10-18T10:54:17Z", "Review failed. The pull request is too large to review."),
  ];
  expect(reviewFeedback(pr({ contexts: [manualOnly], comments }))).toEqual({
    open: [skippedStatus],
    skipped: [],
  });
});

test("a later failure with a stated reason restores the usual refusal", () => {
  const comments = [
    bareFailure("2026-10-18T09:52:11Z"),
    retrigger("2026-10-18T09:54:17Z"),
    bareFailure("2026-10-18T10:54:17Z"),
    bareFailure("2026-10-18T11:30:00Z", "Review failed. The pull request is too large to review."),
  ];
  expect(reviewFeedback(pr({ contexts: [manualOnly], comments }))).toEqual({
    open: [skippedStatus],
    skipped: [],
  });
});

test("only a visible bare failure from CodeRabbit after the head commit counts", () => {
  const stale = bareFailure("2026-10-17T09:52:11Z");
  const hidden = { ...bareFailure("2026-10-18T09:52:11Z"), isMinimized: true };
  const human = { ...bareFailure("2026-10-18T09:52:11Z"), author: user };
  const lookalike = { ...bareFailure("2026-10-18T09:52:11Z"), author: cubicBot };
  for (const comment of [stale, hidden, human, lookalike]) {
    expect(openFeedback(pr({ contexts: [manualOnly], comments: [comment] }))).toEqual([
      skippedStatus,
    ]);
  }
  // A re-trigger from the bot itself, or before the failure, is not the person's re-trigger.
  const botRetrigger = { ...retrigger("2026-10-18T09:54:17Z"), author: bot };
  const early = retrigger("2026-10-18T09:26:00Z");
  for (const comment of [botRetrigger, early]) {
    expect(
      openFeedback(
        pr({ contexts: [manualOnly], comments: [bareFailure("2026-10-18T09:52:11Z"), comment] }),
      ),
    ).toEqual([
      "CodeRabbit failed without a stated reason at 2026-10-18T09:52:11.000Z; re-trigger it once with `@coderabbitai full review`, then rerun this check",
    ]);
  }
});

test("waitForReview still waits for a bot that is merely slow", async () => {
  let clock = 0;
  const opts = {
    pollMs: 30_000,
    sleep: async (/** @type {number} */ ms) => (clock += ms),
    now: () => clock,
  };
  // cubic still running, even after an earlier limit comment, is waited for until it finishes.
  const running = pr({
    contexts: [{ name: CUBIC, status: "IN_PROGRESS", conclusion: null }],
    comments: [outOfQuota("2026-10-18T10:05:00Z")],
  });
  const done = pr({ contexts: [{ name: CUBIC, status: "COMPLETED", conclusion: "SUCCESS" }] });
  const reads = [running, running, running, done];
  expect(await waitForReview(() => reads.shift(), { ...opts, timeoutMs: 1_800_000 })).toEqual([]);
  expect(clock).toBe(90_000);
  // A CodeRabbit check that has not appeared gets the full grace period, even after a rate-limit comment.
  clock = 0;
  const files = [".coderabbit.yaml"];
  const missing = pr({ files, comments: [rateLimitComment] });
  const never = await waitForReview(() => missing, { ...opts, timeoutMs: 1_800_000 });
  expect(never).toEqual([`no CodeRabbit check on the head commit: ${FOLLOW_UP}`]);
  expect(clock).toBe(180_000);
  // A pending CodeRabbit status is waited for even with a rate-limit comment on the PR.
  clock = 0;
  const reviewed = pr({
    files,
    contexts: [{ context: "CodeRabbit", state: "SUCCESS", description: "Review completed" }],
  });
  const pending = pr({
    files,
    contexts: [{ context: "CodeRabbit", state: "PENDING" }],
    comments: [rateLimitComment],
  });
  const finished = [pending, pending, reviewed];
  expect(await waitForReview(() => finished.shift(), { ...opts, timeoutMs: 1_800_000 })).toEqual(
    [],
  );
  expect(clock).toBe(60_000);
});

test("a required check that has not reported on the head is not green by omission", () => {
  const passing = { name: "check", status: "COMPLETED", conclusion: "SUCCESS" };
  const required = ["check", "windows"];
  expect(openFeedback(pr({ requiredChecks: required, contexts: [passing] }))).toEqual([
    "required check has not reported: windows",
  ]);
  // Either kind of check satisfies the name: a check run or a commit status.
  const status = { context: "windows", state: "SUCCESS" };
  expect(openFeedback(pr({ requiredChecks: required, contexts: [passing, status] }))).toEqual([]);
  // A required check that reported and failed keeps its own reason, not the missing one.
  const failed = { name: "windows", status: "COMPLETED", conclusion: "FAILURE" };
  expect(openFeedback(pr({ requiredChecks: required, contexts: [passing, failed] }))).toEqual([
    "check windows concluded FAILURE",
  ]);
  // An advisory check never refuses, even when a ruleset lists it.
  expect(openFeedback(pr({ requiredChecks: ["shadow review"] }))).toEqual([]);
  // With nothing required the old behavior stands: a head with no checks is not blocked.
  expect(openFeedback(pr())).toEqual([]);
});

test("waitForReview gives a required check a few minutes to appear, then reports it", async () => {
  const required = ["check"];
  const missing = pr({ requiredChecks: required });
  const done = pr({
    requiredChecks: required,
    contexts: [{ name: "check", status: "COMPLETED", conclusion: "SUCCESS" }],
  });
  let clock = 0;
  const opts = {
    pollMs: 30_000,
    sleep: async (/** @type {number} */ ms) => (clock += ms),
    now: () => clock,
  };
  const reads = [missing, missing, done];
  expect(await waitForReview(() => reads.shift(), { ...opts, timeoutMs: 1_800_000 })).toEqual([]);
  clock = 0;
  expect(await waitForReview(() => missing, { ...opts, timeoutMs: 1_800_000 })).toEqual([
    "required check has not reported: check",
  ]);
  expect(clock).toBe(180_000);
});

test("requiredCheckNames merges classic protection with active rulesets and rejects partial data", () => {
  const rules = (/** @type {any[]} */ nodes, hasNextPage = false) => ({
    pageInfo: { hasNextPage },
    nodes,
  });
  const ruleset = {
    type: "REQUIRED_STATUS_CHECKS",
    parameters: { requiredStatusChecks: [{ context: "Test" }, { context: "Check" }] },
  };
  const other = { type: "PULL_REQUEST", parameters: {} };
  const protection = {
    requiredStatusCheckContexts: ["Legacy", "Check"],
    requiredStatusChecks: [{ context: "Legacy" }],
  };
  expect(
    requiredCheckNames({ branchProtectionRule: protection, rules: rules([ruleset, other]) }),
  ).toEqual(["Check", "Legacy", "Test"]);
  expect(requiredCheckNames({ branchProtectionRule: null, rules: rules([other]) })).toEqual([]);
  expect(() =>
    requiredCheckNames({ branchProtectionRule: null, rules: rules([ruleset], true) }),
  ).toThrow("incomplete");
  expect(() => requiredCheckNames(null)).toThrow();
  // Missing or mistyped fields fail closed instead of reading as "nothing required".
  for (const bad of [
    { branchProtectionRule: {}, rules: rules([]) },
    {
      branchProtectionRule: { requiredStatusCheckContexts: [], requiredStatusChecks: "x" },
      rules: rules([]),
    },
    { branchProtectionRule: null, rules: rules([{ parameters: {} }]) },
  ]) {
    expect(() => requiredCheckNames(bad)).toThrow("malformed");
  }
  expect(() =>
    requiredCheckNames({
      branchProtectionRule: null,
      rules: rules([{ type: "REQUIRED_STATUS_CHECKS", parameters: null }]),
    }),
  ).toThrow("malformed");
});
