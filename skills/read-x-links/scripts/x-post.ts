#!/usr/bin/env bun
// Read X/Twitter posts through the public fxtwitter API: full text, expanded
// links, quoted posts, long-form articles, and downloadable images.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs as parseCli } from "node:util";

const API = "https://api.fxtwitter.com";
// pbs.twimg.com answers 403 without a browser-like user agent.
const HEADERS = { "user-agent": "Mozilla/5.0" };
const HOSTS = /^(?:www\.|mobile\.)?(?:x|twitter|fixupx|fxtwitter|vxtwitter|fixvx)\.com$/;

// The parts of fxtwitter's response this script reads.
type Facet = { type?: string; original?: string; replacement?: string; indices: [number, number] };
type ArticleMedia = { media_id?: string; media_info?: { original_img_url?: string } };
type Block = { type?: string; text?: string; entityRanges?: { key?: number | string }[] };
type Entity = { type?: string; data?: { mediaItems?: { mediaId?: string }[] } };
export type Article = {
  title?: string;
  content?: { blocks?: Block[]; entityMap?: { key: number | string; value: Entity }[] };
  cover_media?: ArticleMedia;
  media_entities?: ArticleMedia[];
};
export type Tweet = {
  id: string;
  url?: string;
  text?: string;
  created_at?: string;
  raw_text?: { text?: string; facets?: Facet[] };
  author?: { screen_name?: string; name?: string };
  replying_to?: string;
  replying_to_status?: string;
  media?: {
    photos?: { url: string }[];
    videos?: { url: string; thumbnail_url?: string; duration?: number }[];
  };
  article?: Article;
  quote?: Tweet;
};

/** `{ user, id }` for a post URL on x.com or a known mirror; null otherwise. */
export function parseStatusUrl(input: string): { user: string; id: string } | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (!HOSTS.test(url.hostname)) {
    return null;
  }
  const match = /^\/([^/]+)\/status(?:es)?\/(\d+)/.exec(url.pathname);
  return match ? { user: match[1]!, id: match[2]! } : null;
}

/** Post text with t.co links replaced by their targets. */
export function expandedText(tweet: Tweet): string {
  const text = tweet.raw_text?.text ?? tweet.text ?? "";
  const facets = (tweet.raw_text?.facets ?? [])
    .filter((f) => f.type === "url" && f.original && f.replacement)
    .sort((a, b) => b.indices[0] - a.indices[0]);
  let out = text;
  for (const f of facets) {
    out = out.slice(0, f.indices[0]) + f.replacement + out.slice(f.indices[1]);
  }
  return out;
}

export type Photo = { url: string; id: string | null };

/**
 * Article body as Markdown-ish text. An image block becomes `[image N]`, where N
 * is that image's position in `mediaOf(tweet).photos` (and its downloaded file).
 */
export function articleText(article: Article | undefined, photos: Photo[] = []): string {
  const blocks = article?.content?.blocks ?? [];
  const entities = new Map(
    (article?.content?.entityMap ?? []).map((e) => [String(e.key), e.value]),
  );
  const lines: string[] = [];
  let ordered = 0;
  for (const block of blocks) {
    const text = (block.text ?? "").trim();
    if (block.type !== "ordered-list-item") {
      ordered = 0;
    }
    if (block.type === "atomic") {
      const entity = entities.get(String(block.entityRanges?.[0]?.key));
      const mediaId = entity?.type === "MEDIA" ? entity.data?.mediaItems?.[0]?.mediaId : null;
      if (mediaId) {
        const n = photos.findIndex((p) => p.id === mediaId);
        lines.push(n >= 0 ? `[image ${n + 1}]` : "[image]");
      }
      continue;
    }
    if (!text) {
      continue;
    }
    if (block.type === "header-one") {
      lines.push(`# ${text}`);
    } else if (block.type === "header-two") {
      lines.push(`## ${text}`);
    } else if (block.type === "unordered-list-item") {
      lines.push(`- ${text}`);
    } else if (block.type === "ordered-list-item") {
      lines.push(`${++ordered}. ${text}`);
    } else if (block.type === "blockquote") {
      lines.push(`> ${text}`);
    } else {
      lines.push(text);
    }
  }
  return lines.join("\n");
}

/** Every image and video a post carries, including article images. */
export function mediaOf(tweet: Tweet): {
  photos: Photo[];
  videos: { url: string; thumbnail?: string; duration?: number }[];
} {
  const photos: Photo[] = (tweet.media?.photos ?? []).map((p) => ({ url: p.url, id: null }));
  const article = tweet.article;
  for (const m of [article?.cover_media, ...(article?.media_entities ?? [])]) {
    if (m?.media_info?.original_img_url) {
      photos.push({ url: m.media_info.original_img_url, id: m.media_id ?? null });
    }
  }
  const videos = (tweet.media?.videos ?? []).map((v) => ({
    url: v.url,
    thumbnail: v.thumbnail_url,
    duration: v.duration,
  }));
  return { photos, videos };
}

async function fetchPost(user: string, id: string): Promise<Tweet> {
  const res = await fetch(`${API}/${user}/status/${id}`, { headers: HEADERS });
  const body = (await res.json().catch(() => null)) as { tweet?: Tweet; message?: string } | null;
  if (!res.ok || !body?.tweet) {
    throw new Error(`${user}/status/${id}: HTTP ${res.status} ${body?.message ?? ""}`.trim());
  }
  return body.tweet;
}

async function download(url: string, path: string): Promise<string> {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  return path;
}

async function render(tweet: Tweet, mediaDir: string | null, label: string): Promise<string> {
  const out: string[] = [];
  const a = tweet.author ?? {};
  out.push(`### ${label}: @${a.screen_name} (${a.name ?? ""}) · ${tweet.created_at}`);
  out.push(tweet.url ?? "");
  if (tweet.replying_to) {
    out.push(
      `Reply to @${tweet.replying_to} (${tweet.replying_to_status}); earlier thread posts are not included.`,
    );
  }
  out.push("", expandedText(tweet));
  const { photos, videos } = mediaOf(tweet);
  if (tweet.article) {
    out.push("", `#### Article: ${tweet.article.title}`, "", articleText(tweet.article, photos));
  }
  for (const [i, { url }] of photos.entries()) {
    if (!mediaDir) {
      out.push(`image ${i + 1}: ${url}`);
      continue;
    }
    const ext = /\.(\w+)(?:\?|$)/.exec(url)?.[1] ?? "jpg";
    const path = join(mediaDir, `${tweet.id}-${i + 1}.${ext}`);
    out.push(
      `image ${i + 1}: ${await download(url, path).catch((e: unknown) => `${url} (download failed: ${e instanceof Error ? e.message : String(e)})`)}`,
    );
  }
  for (const [i, v] of videos.entries()) {
    out.push(
      `video ${i + 1} (${v.duration ?? "?"}s, not readable as text): ${v.url} thumbnail: ${v.thumbnail}`,
    );
  }
  return out.join("\n");
}

export function parseArgs(argv: string[]): {
  mediaDir: string | null;
  urls: string[];
  error?: string;
} {
  let parsed;
  try {
    parsed = parseCli({
      args: argv,
      allowPositionals: true,
      options: { "media-dir": { type: "string" } },
    });
  } catch (error) {
    return {
      mediaDir: null,
      urls: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
  const mediaDir = parsed.values["media-dir"] ?? null;
  // A forgotten directory would otherwise take the first URL as its value.
  if (mediaDir !== null && /^https?:/i.test(mediaDir)) {
    return { mediaDir: null, urls: [], error: "--media-dir needs a directory value" };
  }
  return { mediaDir, urls: parsed.positionals };
}

async function main(argv: string[]): Promise<number> {
  const { mediaDir, urls, error } = parseArgs(argv);
  if (error || urls.length === 0) {
    if (error) {
      console.error(error);
    }
    console.error("usage: x-post.ts [--media-dir DIR] <x.com status URL>...");
    return 2;
  }
  if (mediaDir) {
    mkdirSync(mediaDir, { recursive: true });
  }
  let failed = 0;
  for (const input of urls) {
    const ref = parseStatusUrl(input);
    if (!ref) {
      console.log(`## ${input}\nnot an X post URL\n`);
      failed++;
      continue;
    }
    try {
      const tweet = await fetchPost(ref.user, ref.id);
      const parts = [await render(tweet, mediaDir, "Post")];
      // The embedded quote omits its article and full media; fetch it directly.
      if (tweet.quote) {
        const embedded = tweet.quote;
        let quote = embedded;
        try {
          quote = await fetchPost(embedded.author?.screen_name ?? "i", embedded.id);
        } catch (error) {
          parts.push(
            `Quoted post fetch failed (${error instanceof Error ? error.message : String(error)}); showing the embedded copy, which can lack its article and full media.`,
          );
        }
        parts.push(await render(quote, mediaDir, "Quoted post"));
      }
      console.log(`## ${input}\n${parts.join("\n\n")}\n`);
    } catch (error) {
      console.log(
        `## ${input}\nfetch failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      failed++;
    }
  }
  return failed ? 1 : 0;
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}
