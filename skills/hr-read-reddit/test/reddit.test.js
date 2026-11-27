import { describe, expect, test } from "bun:test";
import {
  archiveEntries,
  getThreadFeed,
  htmlToText,
  markdownToText,
  parseArgs,
  parseFeed,
  parseThreadUrl,
} from "../scripts/reddit.ts";

test("thread URLs on reddit.com subdomains and redd.it parse; other URLs do not", () => {
  expect(
    parseThreadUrl("https://www.reddit.com/r/selfhosted/comments/1wkr1ck/anybody_wanting/?utm=x"),
  ).toEqual({
    sub: "selfhosted",
    id: "1wkr1ck",
  });
  expect(parseThreadUrl("https://old.reddit.com/r/a/comments/abc/t/def/")).toEqual({
    sub: "a",
    id: "abc",
  });
  expect(parseThreadUrl("https://redd.it/1wkr1ck")).toEqual({ sub: null, id: "1wkr1ck" });
  expect(parseThreadUrl("https://www.reddit.com/r/selfhosted/")).toBeNull();
  expect(parseThreadUrl("https://notreddit.com/r/a/comments/abc")).toBeNull();
  expect(parseThreadUrl("not a url")).toBeNull();
});

test("entry HTML keeps links inline, relative links absolute, [link] as the bare URL", () => {
  const html =
    '<!-- SC_OFF --><div class="md"><p>Join <a href="https://example.org/join?team=1&amp;invite=x">here</a> &amp; ' +
    'see <a href="/message/compose/?to=/r/x">mods</a></p><ul><li>PPR</li><li>10 teams</li></ul></div>' +
    '<span><a href="https://example.com/p">[link]</a></span>';
  expect(htmlToText(html)).toBe(
    "Join here (https://example.org/join?team=1&invite=x) & see mods (https://www.reddit.com/message/compose/?to=/r/x)\n- PPR\n- 10 teams\n\nhttps://example.com/p",
  );
});

test("feed entries split into posts and comments with decoded text", () => {
  const xml =
    '<feed><title>t</title><entry><author><name>/u/example_user</name></author><content type="html">&lt;p&gt;Draft &amp;amp; go&lt;/p&gt;</content>' +
    '<id>t3_1wkr1ck</id><link href="https://www.reddit.com/r/f/comments/1wkr1ck/x/" /><updated>2026-09-19T16:45:03+00:00</updated>' +
    "<published>2026-09-19T16:45:03+00:00</published><title>Knockout &amp; more</title></entry>" +
    '<entry><author><name>/u/b</name></author><content type="html">&lt;p&gt;in&lt;/p&gt;</content><id>t1_zz</id>' +
    '<link href="https://www.reddit.com/r/f/comments/1wkr1ck/x/zz/" /><updated>2026-09-20T00:00:00+00:00</updated><title>/u/b on x</title></entry></feed>';
  expect(parseFeed(xml)).toEqual([
    {
      id: "t3_1wkr1ck",
      kind: "post",
      author: "example_user",
      published: "2026-09-19T16:45:03+00:00",
      title: "Knockout & more",
      url: "https://www.reddit.com/r/f/comments/1wkr1ck/x/",
      text: "Draft & go",
    },
    {
      id: "t1_zz",
      kind: "comment",
      author: "b",
      published: "2026-09-20T00:00:00+00:00",
      title: "/u/b on x",
      url: "https://www.reddit.com/r/f/comments/1wkr1ck/x/zz/",
      text: "in",
    },
  ]);
});

test("archive Markdown links become `text (url)`, matching the feed output", () => {
  expect(
    markdownToText(
      "see [the post](https://example.org/a?x=1&amp;y=2) and [https://b.test](https://b.test)",
    ),
  ).toBe("see the post (https://example.org/a?x=1&y=2) and https://b.test");
});

test("archive post and nested comments flatten in thread order with capture scores", () => {
  const child = {
    data: {
      id: "c2",
      author: "b",
      created_utc: 1790000100,
      body: "reply",
      score: 3,
      permalink: "/r/f/comments/p1/x/c2/",
    },
  };
  const entries = archiveEntries(
    {
      id: "p1",
      author: "a",
      created_utc: 1790000000,
      title: "T",
      selftext: "body",
      permalink: "/r/f/comments/p1/x/",
      score: 5,
    },
    [
      {
        data: {
          id: "c1",
          author: "[deleted]",
          created_utc: 1790000050,
          body: "[removed]",
          score: 1,
          replies: { data: { children: [child] } },
        },
      },
      { data: { id: "c3", created_utc: 1790000200, body: "later", score: 2, replies: "" } },
    ],
  );
  expect(entries.map((e) => [e.id, e.kind, e.score])).toEqual([
    ["t3_p1", "post", 5],
    ["t1_c1", "comment", 1],
    ["t1_c2", "comment", 3],
    ["t1_c3", "comment", 2],
  ]);
  expect(entries[0]).toMatchObject({
    url: "https://www.reddit.com/r/f/comments/p1/x/",
    published: "2026-09-21T14:13:20.000Z",
    text: "body",
  });
  expect(entries[3]?.author).toBe("[deleted]");
});

test("archive posts keep the submitted link and decode the title", () => {
  const first = (/** @type {object} */ post) => archiveEntries(post, [])[0];
  expect(
    first({
      id: "p1",
      title: "Q&amp;A &lt;2026&gt;",
      selftext: "",
      url: "https://example.org/a?x=1&amp;y=2",
      permalink: "/r/f/comments/p1/x/",
    }),
  ).toMatchObject({ title: "Q&A <2026>", text: "https://example.org/a?x=1&y=2" });
  expect(
    first({
      id: "p2",
      title: "t",
      selftext: "caption",
      url: "https://i.redd.it/pic.jpg",
      permalink: "/r/f/comments/p2/x/",
    })?.text,
  ).toBe("caption\n\nhttps://i.redd.it/pic.jpg");
  expect(
    first({
      id: "p3",
      title: "t",
      selftext: "body",
      url: "https://www.reddit.com/r/f/comments/p3/x/",
      permalink: "/r/f/comments/p3/x/",
    })?.text,
  ).toBe("body");
});

test("a thread feed answer with no entries is a failed read", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = Object.assign(
    async () => new Response("<html>blocked</html>", { status: 200 }),
    { preconnect: real.preconnect },
  );
  try {
    const error = await getThreadFeed("https://www.reddit.com/r/f/comments/p1/.rss").catch(
      (/** @type {unknown} */ e) => e,
    );
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain("no entries");
  } finally {
    globalThis.fetch = real;
  }
});

describe("reddit parseArgs", () => {
  test("thread takes URLs; search takes a subreddit and a query", () => {
    expect(parseArgs(["thread", "u1", "u2", "--json"])).toMatchObject({
      command: "thread",
      args: ["u1", "u2"],
      json: true,
    });
    expect(parseArgs(["thread", "u", "--archive"])).toMatchObject({ archive: true });
    expect(
      parseArgs(["search", "selfhosted", "backup tools", "--pages", "3", "--since", "2026-06-01"]),
    ).toMatchObject({
      args: ["selfhosted", "backup tools"],
      pages: 3,
      since: Date.parse("2026-06-01"),
    });
  });

  /** @param {string[]} args */
  const errorOf = (args) => {
    const parsed = parseArgs(args);
    return "error" in parsed ? parsed.error : undefined;
  };

  test("rejects missing values, bad values, unknown options and wrong arity", () => {
    expect(errorOf(["search", "a", "q", "--pages"])).toContain("--pages");
    expect(errorOf(["search", "a", "q", "--pages", "0"])).toContain("--pages");
    expect(errorOf(["search", "a", "q", "--pages", "2.5"])).toContain("--pages");
    expect(errorOf(["search", "a", "q", "--since", "soon"])).toContain("--since");
    expect(errorOf(["search", "a", "q", "--sort", "hot"])).toContain("--sort");
    expect(errorOf(["thread", "u", "--media"])).toContain("--media");
    expect(errorOf(["search", "a", "q", "--archive"])).toContain("--archive");
    expect(errorOf(["search", "a"])).toContain("search");
    expect(errorOf([])).toBe("missing command");
  });
});
