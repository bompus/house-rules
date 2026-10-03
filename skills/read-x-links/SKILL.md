---
name: read-x-links
description: Read X/Twitter post links (x.com, twitter.com and mirrors) in full, including quoted posts, long-form articles, expanded links and attached images. Use whenever a task needs the content of an X post; generic web fetch returns truncated text and no images.
---

# Read X links

Generic web fetch usually sees X behind a login wall: text cut at "Show more", `t.co`
links, no images, and quoted articles reduced to a bare link. Read posts through
the bundled script instead. It calls the public [fxtwitter](https://github.com/FxEmbed/FxEmbed)
API and needs no key. It sends the post's handle and ID to that third-party
service and downloads attached images from the URLs it returns.

```bash
bun scripts/x-post.ts --media-dir <scratch-dir>/media <url> [<url>...]
```

Run it from this skill's directory. It prints, for each post and any quoted
post: author, date, full text with expanded links, the article body when the
post is an X article, and the local path of every downloaded image. Put
`--media-dir` in your task's scratch directory, on disk rather than in a
RAM-backed `/tmp`.

Then:

1. Open every downloaded image with the host's image-reading tool. Prompts,
   tables and charts are often posted only as screenshots.
2. Follow expanded links (GitHub repos, blog posts) with web fetch when the post
   only points at the substance.
3. Report what stayed unread: videos (the script prints the video URL and a
   thumbnail), earlier posts in a thread (a reply shows its parent's ID; fetch
   that URL to walk up), and any post the script reported as failed. Say so
   rather than rating content you did not see.

A deleted, protected or age-restricted post fails with the API's message; ask
the user for a screenshot. If the API itself is down, fall back to web fetch
and state that text and images may be incomplete.
