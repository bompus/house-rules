#!/usr/bin/env bun
// See ../references/review-helpers.md. One selected thread, dry-run by default, no mutation retries.
import { parseArgs } from "node:util";
import { author, date, githubGraphQL, record, text } from "./check-pr-review";

type Selection = { pr: string; thread: string; head: string; reply: string; apply: boolean };
type Thread = { id: string; isResolved: boolean; isOutdated: boolean; viewerCanResolve: boolean };
const ACTOR = "{__typename login}";
const META = `id isResolved isOutdated viewerCanResolve pullRequest{url headRefOid state repository{viewerPermission}}`;
const COMMENTS = `comments(first:100,after:$cursor){pageInfo{hasNextPage endCursor} nodes{id url body state publishedAt isMinimized author${ACTOR} editor${ACTOR} lastEditedAt replyTo{id}}}`;

function selection(): Selection {
  const { values, positionals } = parseArgs({
    options: {
      thread: { type: "string" },
      "expect-head": { type: "string" },
      "reply-url": { type: "string" },
      apply: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });
  const [pr] = positionals;
  if (
    positionals.length !== 1 ||
    !pr ||
    !/^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]*$/.test(pr) ||
    !values.thread?.trim() ||
    !values["expect-head"] ||
    !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(values["expect-head"]) ||
    !values["reply-url"]?.startsWith(`${pr}#discussion_r`) ||
    !/^#discussion_r[1-9][0-9]*$/.test(values["reply-url"].slice(pr.length))
  ) {
    throw new Error(
      "usage: resolve-pr-thread.ts <GitHub PR URL> --thread <id> --expect-head <full SHA> --reply-url <reply URL> [--apply]",
    );
  }
  return {
    pr,
    thread: values.thread,
    head: values["expect-head"],
    reply: values["reply-url"],
    apply: values.apply === true,
  };
}

function metadata(data: Record<string, unknown>, s: Selection): Thread {
  const t = record(data.node);
  const pr = record(t.pullRequest);
  const permission = record(pr.repository).viewerPermission;
  if (
    t.__typename !== "PullRequestReviewThread" ||
    t.id !== s.thread ||
    pr.url !== s.pr ||
    typeof t.isResolved !== "boolean" ||
    typeof t.isOutdated !== "boolean" ||
    typeof t.viewerCanResolve !== "boolean" ||
    !author(data.viewer) ||
    !(
      permission === null ||
      (text(permission) && ["READ", "TRIAGE", "WRITE", "MAINTAIN", "ADMIN"].includes(permission))
    ) ||
    !text(pr.state) ||
    !["OPEN", "CLOSED", "MERGED"].includes(pr.state)
  ) {
    throw new Error("malformed or mismatched thread/PR metadata");
  }
  if (pr.headRefOid !== s.head) {
    throw new Error("PR head differs from expected head; stop and re-read");
  }
  if (
    !t.isResolved &&
    (pr.state !== "OPEN" ||
      !t.viewerCanResolve ||
      !["WRITE", "MAINTAIN", "ADMIN"].includes(permission as string))
  ) {
    throw new Error("open PR and write/resolve permission required");
  }
  return t as unknown as Thread;
}

function request(s: Selection, comments: boolean, cursor?: string): Record<string, unknown> {
  const query = `query($thread:ID!${comments ? ",$cursor:String" : ""}){viewer${ACTOR} node(id:$thread){__typename ... on PullRequestReviewThread{${META} ${comments ? COMMENTS : ""}}}}`;
  return githubGraphQL(query, { thread: s.thread, ...(cursor ? { cursor } : {}) }, "github.com");
}

function comment(value: unknown): Record<string, unknown> {
  const c = record(value);
  if (
    !text(c.id) ||
    !text(c.url) ||
    !text(c.body) ||
    !text(c.state) ||
    !["PENDING", "SUBMITTED"].includes(c.state) ||
    !(c.publishedAt === null || date(c.publishedAt)) ||
    typeof c.isMinimized !== "boolean" ||
    !author(c.author) ||
    !author(c.editor) ||
    !(c.lastEditedAt === null || date(c.lastEditedAt)) ||
    !(c.replyTo === null || text(record(c.replyTo).id))
  ) {
    throw new Error("malformed thread comment");
  }
  return c;
}

function readSelection(s: Selection): Thread {
  const seen = new Set<string>();
  const comments: Record<string, unknown>[] = [];
  let cursor: string | undefined;
  let viewer: Record<string, unknown>;
  for (;;) {
    const data = request(s, true, cursor);
    metadata(data, s);
    viewer = record(data.viewer);
    const page = record(record(data.node).comments);
    const info = record(page.pageInfo);
    if (
      !Array.isArray(page.nodes) ||
      typeof info.hasNextPage !== "boolean" ||
      !(info.endCursor === null || text(info.endCursor))
    ) {
      throw new Error("malformed thread comment page");
    }
    comments.push(...page.nodes.map(comment));
    if (!info.hasNextPage) {
      break;
    }
    if (!text(info.endCursor) || !info.endCursor || seen.has(info.endCursor)) {
      throw new Error("non-advancing thread comment cursor");
    }
    seen.add(info.endCursor);
    cursor = info.endCursor;
  }
  const matches = comments.filter((c) => c.url === s.reply);
  if (matches.length !== 1) {
    throw new Error("selected reply is missing or ambiguous in this thread");
  }
  const reply = matches[0]!;
  const writer = record(reply.author);
  const editor = reply.editor === null ? null : record(reply.editor);
  if (
    viewer.__typename !== "User" ||
    writer.__typename !== "User" ||
    writer.login !== viewer.login ||
    reply.state !== "SUBMITTED" ||
    reply.publishedAt === null ||
    !String(reply.body).trim() ||
    reply.isMinimized ||
    reply.replyTo === null ||
    !comments.some((c) => c.id === record(reply.replyTo).id && c.id !== reply.id) ||
    (reply.lastEditedAt !== null &&
      (editor?.__typename !== "User" || editor.login !== viewer.login))
  ) {
    throw new Error(
      "reply must be published, submitted, visible, nonblank, authored by the authenticated human and edited only by that human",
    );
  }
  const final = request(s, false);
  const currentViewer = record(final.viewer);
  if (currentViewer.__typename !== viewer.__typename || currentViewer.login !== viewer.login) {
    throw new Error("authenticated viewer changed during read");
  }
  return metadata(final, s);
}

function resolve(s: Selection): void {
  const before = readSelection(s);
  if (before.isResolved) {
    console.log(`Already resolved: ${s.thread}; no mutation`);
    return;
  }
  if (!s.apply) {
    console.log(
      `Dry-run: ready to resolve ${s.thread}${before.isOutdated ? " (outdated)" : ""}; judge the selected reply's explanation before applying`,
    );
    return;
  }
  let uncertain = false;
  try {
    const data = githubGraphQL(
      "mutation($thread:ID!){resolveReviewThread(input:{threadId:$thread}){thread{id isResolved}}}",
      { thread: s.thread },
      "github.com",
    );
    const result = record(record(data.resolveReviewThread).thread);
    if (result.id !== s.thread || result.isResolved !== true) {
      throw new Error("unverified mutation payload");
    }
  } catch {
    uncertain = true;
  }
  // A lost response may hide a successful mutation. Read before any user-initiated retry.
  let after: Thread;
  try {
    after = readSelection(s);
  } catch (error) {
    throw new Error(
      `Mutation attempted once; final verification failed (${error instanceof Error ? error.message : "unknown error"}). Thread may already be resolved; re-read before any retry`,
      { cause: error },
    );
  }
  if (!after.isResolved) {
    throw new Error(
      "thread remains unresolved after mutation attempt; no retry made; re-read before retrying",
    );
  }
  console.log(
    `Verified resolved: ${s.thread} at ${s.head}${uncertain ? "; mutation response uncertain, fresh state verified" : ""}`,
  );
}

if (import.meta.main) {
  try {
    resolve(selection());
  } catch (error) {
    console.error(`resolve-pr-thread: ${error instanceof Error ? error.message : "failed"}`);
    process.exitCode = 2;
  }
}
