---
name: hr-read-reddit
description: Read Reddit posts and comments from Reddit's public feeds (output can omit comments) and search subreddits, with links kept inline; a thread read falls back to a public archive when the feed fails. Use whenever a task needs Reddit content or needs to collect links posted on Reddit; generic web fetch and reddit.com JSON are blocked for agents. Reddit announced that RSS support ends November 13, 2026, so feeds can fail; search has only a partial web-search fallback.
---

# Read Reddit

Reddit usually answers agent fetches of pages and `.json` with 403, and its
mirrors are unreliable. Pullpush's archive answers agents with 429 and asks for a
paid plan, so do not scrape it. The bundled script reads post and comment bodies
returned by Reddit's public Atom feeds without a key. Feed output can omit
comments; do not present it as an exhaustive thread.

[Reddit's announcement](https://www.reddit.com/r/modnews/comments/1wubgvt/continuing_our_infrastructure_updates_whats/)
says RSS support ends November 13, 2026, so a feed request can fail. Try the feeds
below, report any retrieval failure and use the fallbacks below when one fails; do
not assume a feed is supported. On that day search feeds answered
HTTP 403 while a thread feed still answered.

Read feeds with:

```bash
bun scripts/reddit.ts thread <reddit or redd.it URL>... [--archive] [--json]
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

When a thread feed fails, `thread` reads the thread from the keyless
[Arctic Shift](https://arctic-shift.photon-reddit.com) archive instead and says so
on stderr; `--archive` goes there directly. Its limits:

1. The copy is a snapshot. Scores and comment counts are as of capture (a post
   can show score 0 and the comment total from its first minute), and the output
   marks each score "at capture". New posts of a busy subreddit appeared within
   about two minutes; the newest comments of a live thread may lag, so do not
   call the result current.
2. One read returns the post and up to 2000 comments, with replies after their
   parent and no nesting marks. An archive thread with more says nothing about
   the rest.
3. The archive promises no uptime and states no request budget, and the script
   handles one 429 by waiting. In a test, 142 reads within about three minutes
   all succeeded; `--archive` has no search, so search failures fall back below.
4. A thread the archive never captured fails as "not in the archive".

If the feeds are blocked and the thread is not in the archive, fall back to the host's web search tool with
`site:reddit.com`. Say that the results are partial snippets.
