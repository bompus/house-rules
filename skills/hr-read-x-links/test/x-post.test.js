import { describe, expect, test } from "bun:test";
import {
  articleText,
  expandedText,
  mediaOf,
  parseArgs,
  parseStatusUrl,
} from "../scripts/x-post.ts";

test("status URLs on x.com and mirrors parse; other URLs do not", () => {
  expect(parseStatusUrl("https://x.com/example_user/status/1234567890123456789?s=20")).toEqual({
    user: "example_user",
    id: "1234567890123456789",
  });
  expect(parseStatusUrl("https://mobile.twitter.com/a/statuses/12/photo/1")).toEqual({
    user: "a",
    id: "12",
  });
  expect(parseStatusUrl("https://fixupx.com/i/status/99")).toEqual({ user: "i", id: "99" });
  expect(parseStatusUrl("https://x.com/i/article/2101225288546029568")).toBeNull();
  expect(parseStatusUrl("https://notx.com/a/status/1")).toBeNull();
  expect(parseStatusUrl("not a url")).toBeNull();
});

test("t.co links expand in place, later links first so earlier indices stay valid", () => {
  const tweet = {
    raw_text: {
      text: "see https://t.co/AAA and https://t.co/BBB pic",
      facets: [
        {
          type: "url",
          indices: [4, 20],
          original: "https://t.co/AAA",
          replacement: "https://github.com/a/b",
        },
        {
          type: "url",
          indices: [25, 41],
          original: "https://t.co/BBB",
          replacement: "https://example.com/c",
        },
        {
          type: "media",
          indices: [42, 45],
          original: "https://t.co/CCC",
          replacement: "https://x.com/u/status/1/photo/1",
        },
      ],
    },
  };
  expect(expandedText(tweet)).toBe("see https://github.com/a/b and https://example.com/c pic");
});

test("article blocks render headings, lists, quotes and image markers numbered like the downloads", () => {
  const article = {
    content: {
      entityMap: [
        { key: "0", value: { type: "DIVIDER", data: {} } },
        { key: "1", value: { type: "MEDIA", data: { mediaItems: [{ mediaId: "222" }] } } },
      ],
      blocks: [
        { type: "header-two", text: "Setup" },
        { type: "ordered-list-item", text: "install" },
        { type: "ordered-list-item", text: "configure" },
        { type: "atomic", text: " ", entityRanges: [{ key: 1 }] },
        { type: "atomic", text: " ", entityRanges: [{ key: 0 }] },
        { type: "unstyled", text: "  " },
        { type: "blockquote", text: "pin the model" },
        { type: "ordered-list-item", text: "restart numbering" },
      ],
    },
  };
  const photos = [null, "111", "222"].map((id, i) => ({ url: `u${i}`, id }));
  expect(articleText(article, photos)).toBe(
    "## Setup\n1. install\n2. configure\n[image 3]\n> pin the model\n1. restart numbering",
  );
});

test("media collects post photos, article cover and inline images, and videos", () => {
  const tweet = {
    media: {
      photos: [{ url: "https://pbs.twimg.com/media/P1.jpg" }],
      videos: [
        {
          url: "https://video.twimg.com/v.mp4",
          thumbnail_url: "https://pbs.twimg.com/t.jpg",
          duration: 24,
        },
      ],
    },
    article: {
      cover_media: {
        media_id: "111",
        media_info: { original_img_url: "https://pbs.twimg.com/media/COVER.jpg" },
      },
      media_entities: [
        { media_id: "222", media_info: { original_img_url: "https://pbs.twimg.com/media/IN.jpg" } },
        { media_info: {} },
      ],
    },
  };
  expect(mediaOf(tweet)).toEqual({
    photos: [
      { url: "https://pbs.twimg.com/media/P1.jpg", id: null },
      { url: "https://pbs.twimg.com/media/COVER.jpg", id: "111" },
      { url: "https://pbs.twimg.com/media/IN.jpg", id: "222" },
    ],
    videos: [
      {
        url: "https://video.twimg.com/v.mp4",
        thumbnail: "https://pbs.twimg.com/t.jpg",
        duration: 24,
      },
    ],
  });
});

describe("x-post parseArgs", () => {
  const a = "https://x.com/a/status/1";
  const b = "https://x.com/b/status/2";

  test("takes URLs with an optional --media-dir anywhere", () => {
    expect(parseArgs([a, b])).toEqual({ mediaDir: null, urls: [a, b] });
    expect(parseArgs([a, "--media-dir", "/m", b])).toEqual({ mediaDir: "/m", urls: [a, b] });
  });

  test("rejects a --media-dir without a directory and unknown options", () => {
    expect(parseArgs(["--media-dir", a, b]).error).toContain("--media-dir");
    expect(parseArgs([a, "--media-dir"]).error).toContain("--media-dir");
    expect(parseArgs([a, "--media"]).error).toContain("--media");
  });
});
