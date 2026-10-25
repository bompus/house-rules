#!/usr/bin/env bun
// Refuses to land a pull request while review feedback is open: an unresolved review thread, a
// review bot (CodeRabbit or cubic) whose check is still running, or a bot review whose body carries findings
// GitHub cannot show as threads ("Outside diff range comments", "Nitpick comments", "Duplicate comments") with no human
// explicit acknowledgement for that review and the current head. Run only when the repository
// selects this gate. It also refuses when CodeRabbit's status on the
// head commit says anything but "Review completed": CodeRabbit marks a skipped review (for example
// on a non-default base) as success with "Review skipped: …". When the head commit has
// `.coderabbit.yaml` but no CodeRabbit check, it refuses too. A cubic check ("cubic · AI code
// reviewer") on the head commit must also complete with SUCCESS: a running one refuses, and so does
// any other conclusion, NEUTRAL and skipped included, because NEUTRAL means cubic did not review the
// head ("Incremental review could not start", "Automatic AI review not started after branch rewrite").
// That PR stays blocked until someone comments `@cubic review`. A head commit with no cubic check is
// not blocked, since cubic's `cubic.yaml` is optional and its absence does not show that cubic
// is expected, and --wait does not wait for one to appear. Missing or incomplete reviews
// require inspection of the review integration and the repository's selected review policy.
// A review bot that reports it has no quota or capacity for the pull request is skipped instead,
// with no end date, and the gate prints which bot it skipped and why: a NEUTRAL cubic check titled
// "AI review line limit reached", or a NEUTRAL cubic check followed, after it completed, by a cubic
// comment that the monthly review limit is reached; and a CodeRabbit success status saying "Review
// rate limited" or "Review limit reached". A successful file-limit skipped CodeRabbit status also
// qualifies when its authenticated, visible current-head summary explicitly reports insufficient
// credits or capacity and no later failure supersedes it; a file limit alone does not.
// A bot that is still running is waited for, and a failed
// result, any other skipped review, an open thread or an unanswered review body still refuses.
// A CodeRabbit reply that is only "Review failed." (no reason) on a head commit it has not reviewed
// refuses once and names the single re-trigger, `@coderabbitai full review`; when a second bare failure
// lands at least an hour after that re-trigger, CodeRabbit is skipped as out of capacity, like the
// rate-limit case. A failure that states a reason keeps the usual refusal.
// Every other check on the head commit must have finished and passed too: a check run that is not
// COMPLETED, or that concluded anything but SUCCESS, NEUTRAL or SKIPPED, and a commit status that
// is not SUCCESS, refuse. A head commit with no checks is not blocked.
//   bun scripts/check-pr-review.ts <pr> [--repo <owner>/<name>] [--wait [--timeout <minutes>]]
// Exit 1 while feedback is open, 2 when gh fails. Without --repo, gh resolves the repository from
// the current checkout. --wait polls every 30 s while CodeRabbit's or cubic's review or any other check is still running, and for
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

const CODERABBIT = /coderabbit/i;
const CUBIC = /^cubic · AI code reviewer$/i;
const isReviewBot = (name: string) => CODERABBIT.test(name) || CUBIC.test(name);
const REVIEW_BOT_CONFIG = ".coderabbit.yaml";
const BODY_FINDINGS = /Outside diff range comments|Nitpick comments|Duplicate comments/;
const REVIEWED = /^Review completed/;
const FOLLOW_UP = "check the review integration and repository review policy";
const RUNNING = "review still running: ";
const CHECK_RUNNING = "check still running: ";
// Check-run conclusions that do not block a merge; every other conclusion does.
const PASSING_CONCLUSIONS = ["SUCCESS", "NEUTRAL", "SKIPPED"];
const NO_CHECK = "no CodeRabbit check on the head commit";
// Checks that only observe a pull request. Queued, running or failed, they never refuse a landing.
const ADVISORY_CHECKS = new Set(["shadow review"]);
// A neutral cubic result means it did not review the head; a person has to ask again.
const CUBIC_RETRY = "comment `@cubic review`";
// Signs that a review bot has no quota or capacity for this pull request.
const CUBIC_LIMIT_TITLE = /line limit reached/i;
const CUBIC_LIMIT_COMMENT = /reached its (?:free )?monthly review limit/i;
const CUBIC_BOT = /^cubic-dev-ai$/i;
const CODERABBIT_LIMIT = /^Review (?:rate limited|limit reached)/i;
const CODERABBIT_FILE_LIMIT = /^Review skipped: \d+ files exceed the limit of \d+$/i;
const CODERABBIT_CREDITS =
  /This review couldn't start because sufficient usage credits or metered capacity aren't available\./i;
// CodeRabbit's reply to a review command that failed without saying why: the whole comment, once
// its markers and tags are removed, is "Action failed Review failed." A failure that states a
// reason does not match.
const CODERABBIT_BOT = /^coderabbitai$/i;
const CODERABBIT_FAILURE = /^(?:❌\uFE0F?\s*)?Action failed\b/;
const CODERABBIT_BARE_FAILURE = /^(?:❌\uFE0F?\s*)?Action failed\s+Review failed\.$/;
const CODERABBIT_RETRIGGER = /^@coderabbitai\s+(?:full\s+)?review\b/i;
const CODERABBIT_RETRIGGER_COMMAND = "`@coderabbitai full review`";
// A second bare failure this long after the re-trigger shows CodeRabbit cannot review the pull request.
const CODERABBIT_RETRY_WAIT_MS = 3_600_000;
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
  title?: string | null;
  completedAt?: string | null;
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
        committedDate: string;
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
              title?: string | null;
              completedAt?: string | null;
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
  contexts: `statusCheckRollup{contexts(first:100,after:$contextsCursor){${PAGE_INFO} nodes{... on StatusContext{context state description} ... on CheckRun{name status conclusion title completedAt}}}}`,
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
              ].includes(n.conclusion))) &&
          (n.title === undefined || n.title === null || text(n.title)) &&
          (n.completedAt === undefined || n.completedAt === null || date(n.completedAt)))
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
  const query = `query($owner:String!,$name:String!,$n:Int!${declarations ? "," + declarations : ""}){viewer{__typename login} repository(owner:$owner,name:$name){viewerPermission pullRequest(number:$n){headRefOid ${fields} commits(last:1){nodes{commit{oid committedDate tree{entries{name}} ${pending.includes("contexts") ? CONNECTIONS.contexts : ""}}}}}}}`;
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
  let committedDate: string;
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
      !date(commit.committedDate) ||
      !Array.isArray(entries) ||
      !entries.every((e: unknown) => text(record(e).name))
    ) {
      throw new Error("malformed or inconsistent head commit");
    }
    tree = { entries: entries as { name: string }[] };
    committedDate = commit.committedDate as string;
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
    committedDate: committedDate!,
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

const botText = (comment: ReviewState["comments"]["nodes"][number]) =>
  comment.body
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Review bodies from bots that carry findings GitHub cannot show as threads and have no acknowledgement. */
function unansweredReviewBodies(pr: ReviewState): string[] {
  const unanswered: string[] = [];
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
        unanswered.push(`unanswered findings in a review body: ${review.url}`);
      }
    }
  }
  return unanswered;
}

/**
 * What a bare CodeRabbit "Review failed." on the head commit means. The first one needs a single
 * re-trigger; a second one at least an hour after that re-trigger is treated as no capacity.
 * Returns nothing when CodeRabbit has not failed without a reason since the head commit.
 */
function codeRabbitBareFailure(
  pr: ReviewState,
  name: string,
): { open?: string; skipped?: string } | undefined {
  const headAt = Date.parse(pr.commits.nodes[0]?.commit.committedDate ?? "");
  const visible = pr.comments.nodes.filter(
    (comment) => comment.isMinimized === false && Date.parse(comment.createdAt) > headAt,
  );
  const times = (keep: (comment: ReviewState["comments"]["nodes"][number]) => boolean) =>
    visible
      .filter(keep)
      .map((comment) => Date.parse(comment.createdAt))
      .sort((a, b) => a - b);
  const failed = (comment: ReviewState["comments"]["nodes"][number]) =>
    isBot(comment.author) &&
    CODERABBIT_BOT.test(comment.author!.login) &&
    CODERABBIT_FAILURE.test(botText(comment));
  // The latest failure decides: one that states a reason keeps the usual refusal, whatever bare
  // failures came before it.
  const latest = visible
    .filter(failed)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  if (latest && !CODERABBIT_BARE_FAILURE.test(botText(latest))) {
    return undefined;
  }
  const failures = times(
    (comment) => failed(comment) && CODERABBIT_BARE_FAILURE.test(botText(comment)),
  );
  const first = failures[0];
  if (first === undefined) {
    return undefined;
  }
  const at = (ms: number) => new Date(ms).toISOString();
  const retriggers = times(
    (comment) =>
      comment.author?.__typename === "User" && CODERABBIT_RETRIGGER.test(comment.body.trim()),
  ).filter((ms) => ms > first);
  const retrigger = retriggers[0];
  if (retrigger === undefined) {
    return {
      open: `${name} failed without a stated reason at ${at(first)}; re-trigger it once with ${CODERABBIT_RETRIGGER_COMMAND}, then rerun this check`,
    };
  }
  const later = failures.filter((ms) => ms > retrigger);
  const second = later.find((ms) => ms - retrigger >= CODERABBIT_RETRY_WAIT_MS);
  if (second !== undefined) {
    return {
      skipped: `${name}: no capacity (it failed without a stated reason at ${at(first)} and again at ${at(second)}, an hour or more after the re-trigger at ${at(retrigger)})`,
    };
  }
  if (later.length > 0) {
    return {
      open: `${name} failed again without a stated reason at ${at(later.at(-1)!)}, inside an hour of the re-trigger at ${at(retrigger)}; after ${at(retrigger + CODERABBIT_RETRY_WAIT_MS)} comment ${CODERABBIT_RETRIGGER_COMMAND} once more: a bare failure at or after that time counts as no capacity`,
    };
  }
  return {
    open: `${name} was re-triggered at ${at(retrigger)} after a failure without a stated reason at ${at(first)}; wait for its review to start, then rerun this check (${FOLLOW_UP} if it never does)`,
  };
}

/** Whether cubic commented, after its check completed, that the workspace is out of review quota. */
const cubicSaidOutOfQuota = (pr: ReviewState, completedAt: string | null | undefined) =>
  pr.comments.nodes.some(
    (comment) =>
      isBot(comment.author) &&
      CUBIC_BOT.test(comment.author!.login) &&
      comment.isMinimized === false &&
      Date.parse(comment.createdAt) > Date.parse(completedAt ?? "") &&
      CUBIC_LIMIT_COMMENT.test(comment.body),
  );

/** Effective time of visible CodeRabbit evidence; foreign edits cannot supply it. */
const codeRabbitCommentAt = (comment: ReviewState["comments"]["nodes"][number]) =>
  isBot(comment.author) &&
  CODERABBIT_BOT.test(comment.author!.login) &&
  comment.isMinimized === false &&
  (!comment.lastEditedAt || (isBot(comment.editor) && CODERABBIT_BOT.test(comment.editor!.login)))
    ? Date.parse(comment.lastEditedAt ?? comment.createdAt)
    : NaN;

/** A credit-capacity summary must identify the final head and not precede a later failure. */
const codeRabbitSaidOutOfCredits = (pr: ReviewState) => {
  let latestFailure = -Infinity;
  for (const comment of pr.comments.nodes) {
    if (
      isBot(comment.author) &&
      CODERABBIT_BOT.test(comment.author!.login) &&
      comment.isMinimized === false &&
      CODERABBIT_FAILURE.test(botText(comment))
    ) {
      // A foreign edit cannot grant a capacity skip or remove a failure that would block it.
      const at = Date.parse(comment.lastEditedAt ?? comment.createdAt);
      latestFailure = Number.isFinite(at) ? Math.max(latestFailure, at) : Infinity;
    }
  }
  return pr.comments.nodes.some((comment) => {
    const at = codeRabbitCommentAt(comment);
    if (
      !(at > Date.parse(pr.commits.nodes[0]?.commit.committedDate ?? "")) ||
      at <= latestFailure
    ) {
      return false;
    }
    const body = botText(comment);
    const ranges = [
      ...body.matchAll(
        /Reviewing files that changed from the base of the PR and between `?[a-f0-9]{40}`? and `?([a-f0-9]{40})`?\./gi,
      ),
    ];
    return (
      CODERABBIT_CREDITS.test(body) &&
      ranges.length === 1 &&
      ranges[0]?.[1]?.toLowerCase() === pr.headRefOid.toLowerCase()
    );
  });
};

/** Every reason the pull request is not ready to land; empty when it is. */
export function openFeedback(pr: ReviewState): string[] {
  return reviewFeedback(pr).open;
}

/**
 * Splits review feedback into reasons that refuse the landing and review bots skipped because
 * they reported no quota or capacity, each with the reason.
 */
export function reviewFeedback(pr: ReviewState): { open: string[]; skipped: string[] } {
  const open: string[] = [];
  const skipped: string[] = [];
  for (const thread of pr.reviewThreads.nodes) {
    if (!thread.isResolved) {
      open.push(`unresolved thread: ${thread.comments.nodes[0]?.url ?? "(no comments)"}`);
    }
  }
  const head = pr.commits.nodes[0]?.commit;
  const contexts = head?.statusCheckRollup?.contexts.nodes ?? [];
  const hasConfig = head?.tree.entries.some((e) => e.name === REVIEW_BOT_CONFIG) ?? false;
  if (hasConfig && !contexts.some((ctx) => CODERABBIT.test(ctx.context ?? ctx.name ?? ""))) {
    open.push(`${NO_CHECK}: ${FOLLOW_UP}`);
  }
  for (const ctx of contexts) {
    const name = ctx.context ?? ctx.name ?? "";
    if (ADVISORY_CHECKS.has(name)) {
      continue;
    }
    const running =
      ctx.state === "PENDING" || (ctx.status !== undefined && ctx.status !== "COMPLETED");
    if (!isReviewBot(name)) {
      if (ctx.status !== undefined) {
        if (ctx.status !== "COMPLETED") {
          open.push(`${CHECK_RUNNING}${name}`);
        } else if (!PASSING_CONCLUSIONS.includes(ctx.conclusion ?? "")) {
          open.push(`check ${name} concluded ${ctx.conclusion ?? "(missing conclusion)"}`);
        }
      } else if (ctx.state === "PENDING" || ctx.state === "EXPECTED") {
        open.push(`${CHECK_RUNNING}${name}`);
      } else if (ctx.state !== "SUCCESS") {
        open.push(`check ${name} reported ${ctx.state ?? "(missing state)"}`);
      }
      continue;
    }
    if (running) {
      open.push(`${RUNNING}${name}`);
    } else if (ctx.name !== undefined && ctx.conclusion !== "SUCCESS") {
      const byTitle = CUBIC_LIMIT_TITLE.test(ctx.title ?? "");
      const limited =
        CUBIC.test(name) &&
        ctx.conclusion === "NEUTRAL" &&
        (byTitle || cubicSaidOutOfQuota(pr, ctx.completedAt));
      if (limited) {
        skipped.push(
          `${name}: no quota (${byTitle ? `check title "${ctx.title}"` : "it commented after this check that the monthly review limit is reached"})`,
        );
      } else {
        const retry = CUBIC.test(name) ? `; ${CUBIC_RETRY}` : "";
        open.push(
          `${name} review concluded ${ctx.conclusion ?? "(missing conclusion)"}: ${FOLLOW_UP}${retry}`,
        );
      }
    } else if (
      ctx.context !== undefined &&
      (ctx.state !== "SUCCESS" || (CODERABBIT.test(name) && !REVIEWED.test(ctx.description ?? "")))
    ) {
      const description = ctx.description ?? "";
      const bare =
        CODERABBIT.test(name) && ctx.state === "SUCCESS"
          ? codeRabbitBareFailure(pr, name)
          : undefined;
      if (CODERABBIT.test(name) && ctx.state === "SUCCESS" && CODERABBIT_LIMIT.test(description)) {
        skipped.push(`${name}: no capacity (status "${description}")`);
      } else if (
        CODERABBIT.test(name) &&
        ctx.state === "SUCCESS" &&
        CODERABBIT_FILE_LIMIT.test(description) &&
        codeRabbitSaidOutOfCredits(pr)
      ) {
        skipped.push(
          `${name}: no capacity (authenticated current-head comment reports insufficient usage credits or metered capacity)`,
        );
      } else if (bare?.skipped) {
        skipped.push(bare.skipped);
      } else if (bare?.open) {
        open.push(bare.open);
      } else {
        open.push(`${name} did not review the head commit ("${description}"): ${FOLLOW_UP}`);
      }
    }
  }
  open.push(...unansweredReviewBodies(pr));
  return { open, skipped };
}

const reviewRunning = (open: string[]) =>
  open.some((line) => line.startsWith(RUNNING) || line.startsWith(CHECK_RUNNING));

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
  let state: ReviewState | undefined;
  try {
    const read = () => (state = readReviewState(owner!, name!, pr));
    if (values.wait) {
      await waitForReview(read, { timeoutMs: waitMinutes * 60_000 });
    } else {
      read();
    }
  } catch (error) {
    console.error(
      `cannot verify PR ${pr} review feedback: ${error instanceof Error ? error.message : "API read failed"}`,
    );
    process.exit(2);
  }
  const { open, skipped } = reviewFeedback(state!);
  for (const line of skipped) {
    console.log(`skipped review bot ${line}`);
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
  console.log(
    `review feedback: none open on PR ${pr}${skipped.length ? ` (${skipped.length} review bot(s) skipped)` : ""}`,
  );
}
