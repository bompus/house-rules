---
name: hr-read-reddit
description: Read Reddit threads (post plus comments) and search subreddits in full text, with links kept inline. Use whenever a task needs Reddit content or needs to collect links posted on Reddit; generic web fetch and reddit.com JSON are blocked for agents.
---

# Read Reddit

Reddit usually answers agent fetches of pages and `.json` with 403, and its
mirrors are unreliable. Pullpush's archive answers agents with 429 and asks for a
paid plan, so do not scrape it. The bundled script reads post and comment bodies
returned by Reddit's public Atom feeds without a key. Feed output can omit
comments; do not present it as an exhaustive thread.

[Reddit's announcement](https://www.reddit.com/r/modnews/comments/1wubgvt/continuing_our_infrastructure_updates_whats/)
says RSS support ends November 13, 2026. Until then, try the feeds below and
report any retrieval failure. After the cutoff, use the partial search fallback
below rather than assuming the feeds remain supported.

Read feeds with:

```bash
bun scripts/reddit.ts thread <reddit or redd.it URL>... [--json]
bun scripts/reddit.ts search <subreddit|all> "<query>" [--pages N] [--since 2026-06-01] [--sort new|relevance|top] [--json]
```

Run it from this skill's directory. Text output gives each post's title, URL,
author, date and body, then each comment. Every link appears as
`text (url)`, so `grep -o` can harvest links. `--json` prints one object per
entry (`id`, `kind`, `author`, `published`, `title`, `url`, `text`) for scripted
collection. Search pages hold 100 results. With `--sort new`, `--since` stops
paging at the first older result.

Limits to state when they matter:

1. Unauthenticated feeds allow about one request per minute. The script waits
   out Reddit's `x-ratelimit-reset` between requests and retries a 429 twice,
   so run long searches in the background and keep `--pages` small.
2. A thread feed is flat: comments come without reply nesting. Images and
   videos appear only as links.
3. Search covers what Reddit's own search indexes. A deleted, removed or
   private thread fails with its HTTP status.

If the feeds are blocked, fall back to the host's web search tool with
`site:reddit.com`. Say that the results are partial snippets.
