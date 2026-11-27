#!/usr/bin/env bun
// Read Reddit threads and subreddit searches through Reddit's public Atom (RSS)
// feeds: no key, full post and comment bodies, links kept inline.
// A thread read falls back to the Arctic Shift archive when the feed fails.
import { parseArgs as parseCli } from "node:util";

const ORIGIN = "https://www.reddit.com";
// Keyless public archive of Reddit; the thread fallback when the feed fails.
const ARCHIVE = "https://arctic-shift.photon-reddit.com/api";
// One archive request returns at most this many comments of a thread.
const ARCHIVE_COMMENTS = 2000;
// Reddit blocks generic agents; its API rules ask for a descriptive user agent.
const HEADERS = { "user-agent": "linux:agent-read-reddit:v1 (read-only research)" };
const HOSTS = /^(?:www\.|old\.|new\.|np\.|m\.)?reddit\.com$/;

export type Entry = {
  id: string;
  kind: "post" | "comment" | "other";
  author: string;
  published: string;
  title: string;
  url: string;
  text: string;
  /** Archive reads only: the vote score when the archive captured the item, not now. */
  score?: number;
};
export type Options = {
  command: string | undefined;
  args: string[];
  json: boolean;
  archive: boolean;
  pages: number;
  since: number | null;
  sort: string;
};

/** `{ sub, id }` for a thread URL on reddit.com (any subdomain) or redd.it; null otherwise. */
export function parseThreadUrl(input: string): { sub: string | null; id: string } | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.hostname === "redd.it") {
    const id = /^\/([a-z0-9]+)$/i.exec(url.pathname)?.[1];
    return id ? { sub: null, id } : null;
  }
  if (!HOSTS.test(url.hostname)) {
    return null;
  }
  const match = /^\/r\/([^/]+)\/comments\/([a-z0-9]+)/i.exec(url.pathname);
  return match ? { sub: match[1]!, id: match[2]! } : null;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      return String.fromCodePoint(
        e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1)),
      );
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Entry HTML as plain text; a link becomes `text (url)`, or the bare URL when the text says nothing. */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, label: string) => {
      const url = decodeEntities(href).replace(/^\//, `${ORIGIN}/`);
      const words = decodeEntities(label.replace(/<[^>]+>/g, "")).trim();
      return !words || /^\[(link|comments)\]$/.test(words) || words === url
        ? url
        : `${words} (${url})`;
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d|pre|blockquote|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(text)
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Atom feed entries: `{ id, kind, author, published, title, url, text }`; kind is post (t3) or comment (t1). */
export function parseFeed(xml: string): Entry[] {
  const tag = (s: string, name: string) =>
    new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(s)?.[1] ?? "";
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e = ""]) => {
    const id = tag(e, "id");
    return {
      id,
      kind: id.startsWith("t3_") ? "post" : id.startsWith("t1_") ? "comment" : ("other" as const),
      author: tag(tag(e, "author"), "name").replace(/^\/u\//, ""),
      published: tag(e, "published") || tag(e, "updated"),
      title: decodeEntities(tag(e, "title")),
      url: decodeEntities(/<link href="([^"]*)"/.exec(e)?.[1] ?? ""),
      text: htmlToText(decodeEntities(tag(e, "content"))),
    };
  });
}

type ArchiveItem = {
  id?: string;
  author?: string;
  created_utc?: number;
  title?: string;
  selftext?: string;
  body?: string;
  permalink?: string;
  url?: string;
  score?: number;
  replies?: { data?: { children?: { data?: ArchiveItem }[] } } | "";
};

/** Markdown as plain text with a link as `text (url)`, matching the feed output. */
export function markdownToText(md: string): string {
  return decodeEntities(md)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, words: string, url: string) =>
      words === url ? url : `${words} (${url})`,
    )
    .trim();
}

/** Archive post then its comments in thread order (replies follow their parent), as feed-shaped entries. */
export function archiveEntries(post: ArchiveItem, tree: { data?: ArchiveItem }[]): Entry[] {
  const when = (item: ArchiveItem) =>
    item.created_utc ? new Date(item.created_utc * 1000).toISOString() : "";
  const link = (item: ArchiveItem) => (item.permalink ? `${ORIGIN}${item.permalink}` : "");
  const out: Entry[] = [
    {
      id: `t3_${post.id}`,
      kind: "post",
      author: post.author ?? "[deleted]",
      published: when(post),
      title: post.title ?? "",
      url: link(post),
      text: markdownToText(post.selftext ?? post.url ?? ""),
      score: post.score,
    },
  ];
  const walk = (nodes: { data?: ArchiveItem }[]) => {
    for (const { data } of nodes) {
      if (!data) {
        continue;
      }
      out.push({
        id: `t1_${data.id}`,
        kind: "comment",
        author: data.author ?? "[deleted]",
        published: when(data),
        title: "",
        url: link(data),
        text: markdownToText(data.body ?? ""),
        score: data.score,
      });
      walk(
        data.replies && typeof data.replies === "object" ? (data.replies.data?.children ?? []) : [],
      );
    }
  };
  walk(tree);
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let waitUntil = 0;

/** GET a feed, spacing requests by Reddit's rate-limit headers and retrying a 429 twice. */
async function getFeed(url: string): Promise<Entry[]> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const wait = waitUntil - Date.now();
    if (wait > 0) {
      console.error(`rate limit: waiting ${Math.ceil(wait / 1000)} s`);
      await sleep(wait);
    }
    const res = await fetch(url, { headers: HEADERS });
    const reset = Number(res.headers.get("x-ratelimit-reset")) || 60;
    const remaining = Number(res.headers.get("x-ratelimit-remaining") ?? 1);
    if (res.status === 429 || remaining < 1) {
      waitUntil = Date.now() + (reset + 1) * 1000;
    }
    if (res.status === 429) {
      continue;
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${url}`);
    }
    return parseFeed(await res.text());
  }
  throw new Error(`HTTP 429 three times for ${url}`);
}

/** GET archive JSON, waiting out one 429 for the `x-ratelimit-reset` seconds (at most 60). */
async function getArchive<T>(path: string): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${ARCHIVE}${path}`, { headers: HEADERS });
    if (res.status === 429 && attempt === 0) {
      const reset = Math.min(Number(res.headers.get("x-ratelimit-reset")) || 30, 60);
      console.error(`archive rate limit: waiting ${reset + 1} s`);
      await sleep((reset + 1) * 1000);
      continue;
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${ARCHIVE}${path}`);
    }
    return (await res.json()) as T;
  }
  throw new Error(`HTTP 429 twice for ${ARCHIVE}${path}`);
}

/** A thread from the archive: the post and up to ARCHIVE_COMMENTS comments; throws when the archive lacks it. */
async function getArchiveThread(id: string): Promise<Entry[]> {
  const posts = await getArchive<{ data?: ArchiveItem[] }>(`/posts/ids?ids=${id}`);
  const post = posts.data?.[0];
  if (!post) {
    throw new Error(`thread ${id} is not in the archive`);
  }
  const tree = await getArchive<{ data?: { data?: ArchiveItem }[] }>(
    `/comments/tree?link_id=${id}&limit=${ARCHIVE_COMMENTS}`,
  );
  return archiveEntries(post, tree.data ?? []);
}

const SORTS = new Set(["new", "relevance", "top"]);

export function parseArgs(argv: string[]): Options | { error: string } {
  let parsed;
  try {
    parsed = parseCli({
      args: argv,
      allowPositionals: true,
      options: {
        json: { type: "boolean" },
        archive: { type: "boolean" },
        pages: { type: "string" },
        since: { type: "string" },
        sort: { type: "string" },
      },
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  const { values, positionals } = parsed;
  const [command, ...args] = positionals;
  const pages = Number(values.pages ?? 1);
  const since = values.since === undefined ? null : Date.parse(values.since);
  const sort = values.sort ?? "new";
  if (!Number.isInteger(pages) || pages < 1) {
    return { error: `bad --pages value ${values.pages}` };
  }
  if (Number.isNaN(since)) {
    return { error: `bad --since value ${values.since}` };
  }
  if (!SORTS.has(sort)) {
    return { error: `bad --sort value ${sort}` };
  }
  const opts: Options = {
    command,
    args,
    json: values.json === true,
    archive: values.archive === true,
    pages,
    since,
    sort,
  };
  if (opts.archive && command !== "thread") {
    return { error: "--archive applies to the thread command only" };
  }
  if (command === "thread" && args.length > 0) {
    return opts;
  }
  if (command === "search" && args.length === 2) {
    return opts;
  }
  return { error: command ? `bad arguments for ${command}` : "missing command" };
}

function print(entry: Entry, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(entry));
    return;
  }
  const head = entry.kind === "post" ? `### ${entry.title}\n${entry.url}\n` : "#### comment ";
  const score = entry.score === undefined ? "" : ` · score ${entry.score} at capture`;
  console.log(`${head}u/${entry.author} · ${entry.published}${score}\n\n${entry.text}\n`);
}

async function main(argv: string[]): Promise<number> {
  const opts = parseArgs(argv);
  if ("error" in opts) {
    console.error(opts.error);
    console.error("usage: reddit.ts thread <url>... [--archive] [--json]");
    console.error(
      "       reddit.ts search <subreddit|all> <query> [--pages N] [--since ISO-date] [--sort new|relevance|top] [--json]",
    );
    return 2;
  }
  if (opts.command === "thread") {
    let failed = 0;
    for (const input of opts.args) {
      const ref = parseThreadUrl(input);
      if (!ref) {
        console.log(`## ${input}\nnot a Reddit thread URL\n`);
        failed++;
        continue;
      }
      const path = ref.sub ? `/r/${ref.sub}/comments/${ref.id}` : `/comments/${ref.id}`;
      if (!opts.json) {
        console.log(`## ${input}`);
      }
      let entries: Entry[] | undefined;
      let feedError = "";
      if (!opts.archive) {
        try {
          entries = await getFeed(`${ORIGIN}${path}/.rss?limit=500`);
        } catch (error) {
          feedError = `${error instanceof Error ? error.message : String(error)}; `;
        }
      }
      try {
        if (!entries) {
          // The feed failed (or --archive): read the archive and say so, since its copy can lag.
          entries = await getArchiveThread(ref.id);
          console.error(
            `${feedError}source: Arctic Shift archive (scores and counts are as of capture, comments may lag)`,
          );
        }
        for (const entry of entries) {
          print(entry, opts.json);
        }
      } catch (error) {
        console.log(
          `fetch failed: ${feedError}${error instanceof Error ? error.message : String(error)}\n`,
        );
        failed++;
      }
    }
    return failed ? 1 : 0;
  }
  const [sub, query = ""] = opts.args;
  const base =
    sub === "all" ? `${ORIGIN}/search.rss?` : `${ORIGIN}/r/${sub}/search.rss?restrict_sr=on&`;
  let after = "";
  for (let page = 0; page < opts.pages; page++) {
    const url = `${base}q=${encodeURIComponent(query)}&sort=${opts.sort}&limit=100${after && `&after=${after}`}`;
    let entries: Entry[];
    try {
      entries = await getFeed(url);
    } catch (error) {
      console.log(`fetch failed: ${error instanceof Error ? error.message : String(error)}\n`);
      return 1;
    }
    let old = false;
    for (const entry of entries) {
      if (opts.since && Date.parse(entry.published) < opts.since) {
        old = opts.sort === "new";
        continue;
      }
      print(entry, opts.json);
    }
    console.error(`page ${page + 1}: ${entries.length} results`);
    if (entries.length < 100 || old) {
      break;
    }
    after = entries.at(-1)!.id;
  }
  return 0;
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}
