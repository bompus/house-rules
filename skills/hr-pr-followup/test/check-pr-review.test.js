import { expect, test } from "bun:test";
import { openFeedback, waitForReview } from "../scripts/check-pr-review.ts";

const bot = { __typename: "Bot", login: "coderabbitai" };
const user = { __typename: "User", login: "maintainer" };

// Resolved threads can coexist with an unanswered outside-diff review finding.
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
      nodes: [{ commit: { tree, statusCheckRollup: { contexts: { nodes: contexts } } } }],
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
      { name: "check", status: "COMPLETED" },
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

test("blocks unresolved threads and a review bot still running, but not other pending checks", () => {
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
  ]);
});

// After CodeRabbit's trial, public repositories under 10 stars get a review only on request, so a
// push can leave no CodeRabbit check at all; that used to pass as "nothing running".
test("blocks a repository with .coderabbit.yaml whose head commit has no CodeRabbit check", () => {
  const state = pr({
    files: [".coderabbit.yaml", "README.md"],
    contexts: [{ name: "check", status: "COMPLETED" }],
  });
  expect(openFeedback(state)).toEqual([
    'no CodeRabbit check on the head commit: comment "@coderabbitai full review"',
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
    `CodeRabbit did not review the head commit ("${skipped}"): comment "@coderabbitai full review"`,
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

// Hand-written wait loops read a field that stays blank and never stopped; --wait polls this way.
test("waitForReview polls while the review runs and stops when it finishes or time runs out", async () => {
  const running = pr({ contexts: [{ context: "CodeRabbit", state: "PENDING" }] });
  const done = pr({
    contexts: [{ context: "CodeRabbit", state: "SUCCESS", description: "Review completed" }],
  });
  let clock = 0;
  const opts = { pollMs: 30_000, sleep: async (ms) => (clock += ms), now: () => clock };
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
  const missing = pr({ files, contexts: [{ name: "check", status: "COMPLETED" }] });
  const running = pr({ files, contexts: [{ context: "CodeRabbit", state: "PENDING" }] });
  const done = pr({
    files,
    contexts: [{ context: "CodeRabbit", state: "SUCCESS", description: "Review completed" }],
  });
  let clock = 0;
  const opts = { pollMs: 30_000, sleep: async (ms) => (clock += ms), now: () => clock };
  const reads = [missing, missing, running, done];
  expect(await waitForReview(() => reads.shift(), { ...opts, timeoutMs: 1_800_000 })).toEqual([]);

  // A review that never starts stops the wait after the grace period, not the full timeout.
  clock = 0;
  const never = await waitForReview(() => missing, { ...opts, timeoutMs: 1_800_000 });
  expect(never).toEqual([
    'no CodeRabbit check on the head commit: comment "@coderabbitai full review"',
  ]);
  expect(clock).toBe(180_000);
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
