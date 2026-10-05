#!/usr/bin/env bun
// Read Reddit threads and subreddit searches through Reddit's public Atom (RSS)
// feeds: no key, full post and comment bodies, links kept inline.
import { parseArgs as parseCli } from "node:util";

const ORIGIN = "https://www.reddit.com";
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
};
export type Options = {
  command: string | undefined;
  args: string[];
  json: boolean;
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

const SORTS = ["new", "relevance", "top"];

export function parseArgs(argv: string[]): Options | { error: string } {
  let parsed;
  try {
    parsed = parseCli({
      args: argv,
      allowPositionals: true,
      options: {
        json: { type: "boolean" },
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
  if (!SORTS.includes(sort)) {
    return { error: `bad --sort value ${sort}` };
  }
  const opts: Options = { command, args, json: values.json === true, pages, since, sort };
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
  console.log(`${head}u/${entry.author} · ${entry.published}\n\n${entry.text}\n`);
}

async function main(argv: string[]): Promise<number> {
  const opts = parseArgs(argv);
  if ("error" in opts) {
    console.error(opts.error);
    console.error("usage: reddit.ts thread <url>... [--json]");
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
      try {
        if (!opts.json) {
          console.log(`## ${input}`);
        }
        for (const entry of await getFeed(`${ORIGIN}${path}/.rss?limit=500`)) {
          print(entry, opts.json);
        }
      } catch (error) {
        console.log(`fetch failed: ${error instanceof Error ? error.message : String(error)}\n`);
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
