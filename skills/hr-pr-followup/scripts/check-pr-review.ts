#!/usr/bin/env bun
// Refuses to land a pull request while review feedback is open: an unresolved review thread, a
// review bot (CodeRabbit) whose check is still running, or a bot review whose body carries findings
// GitHub cannot show as threads ("Outside diff range comments", "Nitpick comments") with no human
// explicit acknowledgement for that review and the current head. Run only when the repository
// selects this gate. It also refuses when CodeRabbit's status on the
// head commit says anything but "Review completed": CodeRabbit marks a skipped review (for example
// on a non-default base) as success with "Review skipped: …". When the head commit has
// `.coderabbit.yaml` but no CodeRabbit check, it refuses too: CodeRabbit's open-source tier reviews
// public repositories under 10 stars only on request, so a review may never start. Both say to
// comment `@coderabbitai full review`.
//   bun scripts/check-pr-review.ts <pr> [--repo <owner>/<name>] [--wait [--timeout <minutes>]]
// Exit 1 while feedback is open, 2 when gh fails. Without --repo, gh resolves the repository from
// the current checkout. --wait polls every 30 s while CodeRabbit's review is still running, and for
// up to 3 minutes while the head commit has no CodeRabbit check yet (CodeRabbit posts it a little
// after a push), then reports as usual; after --timeout minutes (default 30) it reports what is
// still open.
//
// A review-body acknowledgement is one PR conversation comment by the authenticated human
// viewer, who must have WRITE, MAINTAIN or ADMIN permission. Use this exact format:
//   Review: <exact review permalink>
//   Head: <current full head SHA>
//   Reason: <why each finding is fixed or does not apply>
// It must be posted after that review and its latest body edit. A changed head needs a new
// acknowledgement. Minimized comments and edits by another account do not count. The check
// validates association and nonblank reason; the agent or maintainer judges the explanation.
// Missing permission evidence cannot clear body findings. Generic later replies never clear them.
// Connections are paginated; partial/malformed API results and head changes exit 2.
// Only the first thread comment is fetched for its permalink: resolution is a thread-level flag.
// The reader makes a final head check, not an atomic snapshot of changing review feedback.
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

const REVIEW_BOTS = /coderabbit/i;
const REVIEW_BOT_CONFIG = ".coderabbit.yaml";
const BODY_FINDINGS = /Outside diff range comments|Nitpick comments/;
const REVIEWED = /^Review completed/;
const ASK = 'comment "@coderabbitai full review"';
const RUNNING = "review still running: ";
const NO_CHECK = "no CodeRabbit check on the head commit";
const POLL_MS = 30_000;
const NO_CHECK_GRACE_MS = 180_000;

type Author = { __typename: string; login: string } | null;
type Context = {
  context?: string;
  state?: string;
  description?: string | null;
  name?: string;
  status?: string;
  conclusion?: string | null;
};
export type ReviewState = {
  headRefOid: string;
  viewer: Author;
  viewerPermission: string | null;
  reviewThreads: { nodes: { isResolved: boolean; comments: { nodes: { url: string }[] } }[] };
  reviews: {
    nodes: {
      author: Author;
      body: string;
      submittedAt: string | null;
      lastEditedAt: string | null;
      url: string;
    }[];
  };
  comments: {
    nodes: {
      author: Author;
      editor: Author;
      body: string;
      createdAt: string;
      lastEditedAt: string | null;
      isMinimized: boolean;
    }[];
  };
  commits: {
    nodes: {
      commit: {
        tree: { entries: { name: string }[] };
        statusCheckRollup: {
          contexts: {
            nodes: {
              context?: string;
              state?: string;
              description?: string | null;
              name?: string;
              status?: string;
              conclusion?: string | null;
            }[];
          };
        } | null;
      };
    }[];
  };
};

const PAGE_INFO = "pageInfo{hasNextPage endCursor}";
const CONNECTIONS = {
  reviewThreads: `reviewThreads(first:100,after:$reviewThreadsCursor){${PAGE_INFO} nodes{isResolved comments(first:1){nodes{url}}}}`,
  reviews: `reviews(first:100,after:$reviewsCursor){${PAGE_INFO} nodes{author{__typename login} body submittedAt lastEditedAt url}}`,
  comments: `comments(first:100,after:$commentsCursor){${PAGE_INFO} nodes{author{__typename login} editor{__typename login} body createdAt lastEditedAt isMinimized}}`,
  contexts: `statusCheckRollup{contexts(first:100,after:$contextsCursor){${PAGE_INFO} nodes{... on StatusContext{context state description} ... on CheckRun{name status conclusion}}}}`,
};
type Connection = keyof typeof CONNECTIONS;
type Page = { nodes: unknown[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("malformed API object");
  }
  return value as Record<string, unknown>;
}
export function text(value: unknown): value is string {
  return typeof value === "string";
}
export function date(value: unknown): boolean {
  return text(value) && Number.isFinite(Date.parse(value));
}
export function author(value: unknown): boolean {
  if (value === null) {
    return true;
  }
  const a = record(value);
  return (
    text(a.__typename) &&
    ["Bot", "EnterpriseUserAccount", "Mannequin", "Organization", "User"].includes(a.__typename) &&
    text(a.login)
  );
}
function validNode(key: Connection, value: unknown): boolean {
  const n = record(value);
  switch (key) {
    case "reviewThreads": {
      const comments = record(n.comments).nodes;
      return (
        typeof n.isResolved === "boolean" &&
        Array.isArray(comments) &&
        comments.every((c: unknown) => text(record(c).url))
      );
    }
    case "reviews":
      return (
        author(n.author) &&
        text(n.body) &&
        text(n.url) &&
        (n.submittedAt === null || date(n.submittedAt)) &&
        (n.lastEditedAt === null || date(n.lastEditedAt))
      );
    case "comments":
      return (
        author(n.author) &&
        author(n.editor) &&
        text(n.body) &&
        date(n.createdAt) &&
        (n.lastEditedAt === null || date(n.lastEditedAt)) &&
        typeof n.isMinimized === "boolean"
      );
    case "contexts":
      return (
        (text(n.context) &&
          text(n.state) &&
          ["EXPECTED", "ERROR", "FAILURE", "PENDING", "SUCCESS"].includes(n.state) &&
          (n.description === null || text(n.description))) ||
        (text(n.name) &&
          text(n.status) &&
          ["QUEUED", "IN_PROGRESS", "COMPLETED", "WAITING", "PENDING", "REQUESTED"].includes(
            n.status,
          ) &&
          (n.conclusion === null ||
            (text(n.conclusion) &&
              [
                "ACTION_REQUIRED",
                "CANCELLED",
                "FAILURE",
                "NEUTRAL",
                "SKIPPED",
                "STALE",
                "STARTUP_FAILURE",
                "SUCCESS",
                "TIMED_OUT",
              ].includes(n.conclusion))))
      );
  }
}
function page(key: Connection, value: unknown): Page {
  const p = record(value);
  const info = record(p.pageInfo);
  if (
    !Array.isArray(p.nodes) ||
    !p.nodes.every((n: unknown) => validNode(key, n)) ||
    typeof info.hasNextPage !== "boolean" ||
    !(info.endCursor === null || text(info.endCursor))
  ) {
    throw new Error(`malformed ${key} page`);
  }
  return p as unknown as Page;
}

function requestReviewPage(
  owner: string,
  name: string,
  n: number,
  pending: Connection[],
  cursors: Partial<Record<Connection, string>>,
): Record<string, unknown> {
  const declarations = pending.map((k) => `$${k}Cursor:String`).join(",");
  const fields = pending
    .filter((k) => k !== "contexts")
    .map((k) => CONNECTIONS[k])
    .join("\n");
  const query = `query($owner:String!,$name:String!,$n:Int!${declarations ? "," + declarations : ""}){viewer{__typename login} repository(owner:$owner,name:$name){viewerPermission pullRequest(number:$n){headRefOid ${fields} commits(last:1){nodes{commit{oid tree{entries{name}} ${pending.includes("contexts") ? CONNECTIONS.contexts : ""}}}}}}}`;
  const variables: Record<string, string | number> = { owner, name, n };
  for (const key of pending) {
    if (cursors[key]) {
      variables[`${key}Cursor`] = cursors[key]!;
    }
  }
  return githubGraphQL(query, variables);
}

/** Shared transport: rejects command failures, partial errors and malformed envelopes. */
export function githubGraphQL(
  query: string,
  variables: Record<string, string | number>,
  hostname?: string,
): Record<string, unknown> {
  const args = ["api", "graphql", "-f", `query=${query}`];
  if (hostname) {
    args.push("--hostname", hostname);
  }
  for (const [key, value] of Object.entries(variables)) {
    const placeholder =
      (key === "owner" && value === "{owner}") || (key === "name" && value === "{repo}");
    args.push(typeof value === "number" || placeholder ? "-F" : "-f", `${key}=${value}`);
  }
  const run = spawnSync("gh", args, { encoding: "utf8" });
  if (run.status !== 0) {
    throw new Error("gh api graphql failed");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(run.stdout);
  } catch {
    throw new Error("invalid GraphQL JSON");
  }
  const response = record(decoded);
  if (
    response.errors !== undefined &&
    (!Array.isArray(response.errors) || response.errors.length > 0)
  ) {
    throw new Error("GraphQL returned errors; coverage is incomplete");
  }
  return record(response.data);
}

/** Reads complete connections; rejects partial responses and head changes during pagination. */
function readReviewState(owner: string, name: string, n: number): ReviewState {
  const collected: Record<Connection, unknown[]> = {
    reviewThreads: [],
    reviews: [],
    comments: [],
    contexts: [],
  };
  const cursors: Partial<Record<Connection, string>> = {};
  const seen: Record<Connection, Set<string>> = {
    reviewThreads: new Set(),
    reviews: new Set(),
    comments: new Set(),
    contexts: new Set(),
  };
  let pending = Object.keys(CONNECTIONS) as Connection[];
  let expectedHead: string | undefined;
  let viewer: Author = null;
  let viewerPermission: string | null = null;
  let tree: ReviewState["commits"]["nodes"][number]["commit"]["tree"];
  for (;;) {
    const data = requestReviewPage(owner, name, n, pending, cursors);
    const repo = record(data.repository);
    const pr = record(repo.pullRequest);
    if (
      !text(pr.headRefOid) ||
      !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(pr.headRefOid) ||
      !author(data.viewer) ||
      !(repo.viewerPermission === null || text(repo.viewerPermission))
    ) {
      throw new Error("malformed PR metadata");
    }
    if (expectedHead && expectedHead !== pr.headRefOid) {
      throw new Error("PR head changed during feedback read; rerun");
    }
    expectedHead = pr.headRefOid;
    viewer = data.viewer as Author;
    viewerPermission = repo.viewerPermission as string | null;
    const commits = record(pr.commits).nodes;
    if (!Array.isArray(commits) || commits.length !== 1) {
      throw new Error("missing head commit");
    }
    const commit = record(record(commits[0]).commit);
    const entries = record(commit.tree).entries;
    if (
      commit.oid !== expectedHead ||
      !Array.isArray(entries) ||
      !entries.every((e: unknown) => text(record(e).name))
    ) {
      throw new Error("malformed or inconsistent head commit");
    }
    tree = { entries: entries as { name: string }[] };
    if (pending.length === 0) {
      break;
    }
    const next: Connection[] = [];
    for (const key of pending) {
      const value =
        key === "contexts"
          ? commit.statusCheckRollup === null
            ? null
            : record(commit.statusCheckRollup).contexts
          : pr[key];
      if (key === "contexts" && value === null) {
        if (cursors.contexts) {
          throw new Error("status rollup disappeared during pagination");
        }
        continue;
      }
      const p = page(key, value);
      collected[key].push(...p.nodes);
      if (p.pageInfo.hasNextPage) {
        const cursor = p.pageInfo.endCursor;
        if (!cursor || seen[key].has(cursor)) {
          throw new Error(`non-advancing ${key} cursor`);
        }
        seen[key].add(cursor);
        cursors[key] = cursor;
        next.push(key);
      }
    }
    pending = next;
  }
  const commit = {
    tree: tree!,
    statusCheckRollup: { contexts: { nodes: collected.contexts as Context[] } },
  };
  return {
    headRefOid: expectedHead!,
    viewer,
    viewerPermission,
    reviewThreads: { nodes: collected.reviewThreads as ReviewState["reviewThreads"]["nodes"] },
    reviews: { nodes: collected.reviews as ReviewState["reviews"]["nodes"] },
    comments: { nodes: collected.comments as ReviewState["comments"]["nodes"] },
    commits: { nodes: [{ commit }] },
  };
}

const isBot = (author: Author) => author?.__typename === "Bot";

/** Every reason the pull request is not ready to land; empty when it is. */
export function openFeedback(pr: ReviewState): string[] {
  const open: string[] = [];
  for (const thread of pr.reviewThreads.nodes) {
    if (!thread.isResolved) {
      open.push(`unresolved thread: ${thread.comments.nodes[0]?.url ?? "(no comments)"}`);
    }
  }
  const head = pr.commits.nodes[0]?.commit;
  const contexts = head?.statusCheckRollup?.contexts.nodes ?? [];
  const hasConfig = head?.tree.entries.some((e) => e.name === REVIEW_BOT_CONFIG) ?? false;
  if (hasConfig && !contexts.some((ctx) => REVIEW_BOTS.test(ctx.context ?? ctx.name ?? ""))) {
    open.push(`${NO_CHECK}: ${ASK}`);
  }
  for (const ctx of contexts) {
    const name = ctx.context ?? ctx.name ?? "";
    const running =
      ctx.state === "PENDING" || (ctx.status !== undefined && ctx.status !== "COMPLETED");
    if (!REVIEW_BOTS.test(name)) {
      continue;
    }
    if (running) {
      open.push(`${RUNNING}${name}`);
    } else if (ctx.name !== undefined && ctx.conclusion !== "SUCCESS") {
      open.push(`${name} review concluded ${ctx.conclusion ?? "(missing conclusion)"}: ${ASK}`);
    } else if (ctx.context !== undefined && !REVIEWED.test(ctx.description ?? "")) {
      open.push(`${name} did not review the head commit ("${ctx.description ?? ""}"): ${ASK}`);
    }
  }
  for (const review of pr.reviews.nodes) {
    if (isBot(review.author) && BODY_FINDINGS.test(review.body)) {
      const reviewedAt = Math.max(
        Date.parse(review.submittedAt ?? ""),
        Date.parse(review.lastEditedAt ?? review.submittedAt ?? ""),
      );
      const authorized =
        pr.viewer?.__typename === "User" &&
        ["WRITE", "MAINTAIN", "ADMIN"].includes(pr.viewerPermission ?? "");
      const answered =
        authorized &&
        pr.comments.nodes.some((comment) => {
          if (
            comment.author?.__typename !== "User" ||
            comment.author.login !== pr.viewer?.login ||
            comment.isMinimized !== false ||
            Date.parse(comment.createdAt) <= reviewedAt ||
            !Number.isFinite(reviewedAt)
          ) {
            return false;
          }
          if (
            comment.lastEditedAt &&
            (comment.editor?.__typename !== "User" || comment.editor.login !== pr.viewer.login)
          ) {
            return false;
          }
          const ack =
            /^Review: (\S+)\r?\nHead: ((?:[a-f0-9]{40}|[a-f0-9]{64}))\r?\nReason: ([\s\S]+)$/.exec(
              comment.body.trim(),
            );
          return ack?.[1] === review.url && ack[2] === pr.headRefOid && Boolean(ack[3]?.trim());
        });
      if (!answered) {
        open.push(`unanswered findings in a review body: ${review.url}`);
      }
    }
  }
  return open;
}

const reviewRunning = (open: string[]) => open.some((line) => line.startsWith(RUNNING));

/**
 * Re-reads the pull request while a review is still running, or briefly while its check has not
 * appeared, until the review finishes or time runs out.
 */
export async function waitForReview(
  read: () => ReviewState,
  {
    timeoutMs,
    pollMs = POLL_MS,
    sleep = Bun.sleep,
    now = Date.now,
  }: {
    timeoutMs: number;
    pollMs?: number;
    sleep?: (ms: number) => Promise<unknown>;
    now?: () => number;
  },
): Promise<string[]> {
  const start = now();
  const pending = (open: string[]) =>
    reviewRunning(open) ||
    (now() - start < NO_CHECK_GRACE_MS && open.some((line) => line.startsWith(NO_CHECK)));
  let open = openFeedback(read());
  while (pending(open) && now() - start < timeoutMs) {
    await sleep(pollMs);
    open = openFeedback(read());
  }
  return open;
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      repo: { type: "string" },
      wait: { type: "boolean" },
      timeout: { type: "string", default: "30" },
    },
  });
  if (values.repo && !/^[^/\s]+\/[^/\s]+$/.test(values.repo)) {
    console.error("--repo must be owner/name");
    process.exit(2);
  }
  const pr = Number(positionals[0]);
  const waitMinutes = Number(values.timeout);
  if (!Number.isInteger(pr) || pr < 1 || !(waitMinutes > 0)) {
    console.error(
      "usage: check-pr-review.ts <pr> [--repo <owner>/<name>] [--wait [--timeout <minutes>]]",
    );
    process.exit(2);
  }
  const [owner, name] = values.repo ? values.repo.split("/") : ["{owner}", "{repo}"];
  let open: string[];
  try {
    const read = () => readReviewState(owner!, name!, pr);
    open = values.wait
      ? await waitForReview(read, { timeoutMs: waitMinutes * 60_000 })
      : openFeedback(read());
  } catch (error) {
    console.error(
      `cannot verify PR ${pr} review feedback: ${error instanceof Error ? error.message : "API read failed"}`,
    );
    process.exit(2);
  }
  if (open.length > 0) {
    console.error(`PR ${pr} has open review feedback; fix or answer each, then resolve threads:`);
    for (const line of open) {
      console.error(`  ${line}`);
    }
    if (reviewRunning(open) && !values.wait) {
      console.error("  rerun with --wait to poll until the review finishes");
    }
    process.exit(1);
  }
  console.log(`review feedback: none open on PR ${pr}`);
}
