import { describe, expect, test } from "bun:test";
import { htmlToText, parseArgs, parseFeed, parseThreadUrl } from "../scripts/reddit.ts";

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

describe("reddit parseArgs", () => {
  test("thread takes URLs; search takes a subreddit and a query", () => {
    expect(parseArgs(["thread", "u1", "u2", "--json"])).toMatchObject({
      command: "thread",
      args: ["u1", "u2"],
      json: true,
    });
    expect(
      parseArgs(["search", "selfhosted", "backup tools", "--pages", "3", "--since", "2026-06-01"]),
    ).toMatchObject({
      args: ["selfhosted", "backup tools"],
      pages: 3,
      since: Date.parse("2026-06-01"),
    });
  });

  test("rejects missing values, bad values, unknown options and wrong arity", () => {
    expect(parseArgs(["search", "a", "q", "--pages"]).error).toContain("--pages");
    expect(parseArgs(["search", "a", "q", "--pages", "0"]).error).toContain("--pages");
    expect(parseArgs(["search", "a", "q", "--pages", "2.5"]).error).toContain("--pages");
    expect(parseArgs(["search", "a", "q", "--since", "soon"]).error).toContain("--since");
    expect(parseArgs(["search", "a", "q", "--sort", "hot"]).error).toContain("--sort");
    expect(parseArgs(["thread", "u", "--media"]).error).toContain("--media");
    expect(parseArgs(["search", "a"]).error).toContain("search");
    expect(parseArgs([]).error).toBe("missing command");
  });
});
