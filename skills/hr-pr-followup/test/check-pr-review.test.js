import { expect, test } from "bun:test";
import { openFeedback, reviewFeedback, waitForReview } from "../scripts/check-pr-review.ts";

const bot = { __typename: "Bot", login: "coderabbitai" };
const user = { __typename: "User", login: "maintainer" };

// Resolved threads can coexist with an unanswered outside-diff review finding.
// Returns `any`: tests pass partial nodes that omit fields the real query always returns.
/**
 * @param {{ threads?: any[], reviews?: any[], comments?: any[], contexts?: any[], files?: string[] }} [parts]
 * @returns {any}
 */
function pr({ threads = [], reviews = [], comments = [], contexts = [], files = [] } = {}) {
  const tree = { entries: files.map((name) => ({ name })) };
  return {
    headRefOid: "a".repeat(40),
    viewer: user,
    viewerPermission: "ADMIN",
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
