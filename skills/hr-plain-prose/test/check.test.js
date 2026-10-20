import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { check, parseWordTables } from "../scripts/check.mjs";

const SCRIPT = join(import.meta.dir, "../scripts/check.mjs");
/** @param {string} text */
const rules = (text) => check(text).map((f) => `${f.line} ${f.rule} ${f.text}`);

test("joined counts, units and surrounding prose are flagged before sending", () => {
  const draft =
    "The run has208 accepted/54unfinished cases after2GiBNodeOOM.\nRemaining work took3.86CPU-s during2.808s.";
  const spacing = check(draft).filter((f) => f.rule === "missing-space");
  expect(spacing.map((f) => f.text)).toEqual([
    "has",
    "unfinished",
    "after",
    "2GiB",
    "took",
    "3.86CPU-s",
    "during",
    "2.808s",
  ]);
  expect(
    check(
      "The run has 208 accepted cases and 54 unfinished cases.\nIt used 2 GiB and took 3.86 CPU-s during 2.808 s.",
    ),
  ).toEqual([]);
});

test("spacing checks preserve literal code and ordinary names", () => {
  expect(
    check(
      "Use `run2GiB.py`, `phase208accepted`, `NodeOOM`, and `v12`.\nSee https://example.com/after2GiB or [receipt](./run2GiB.json).\nHTTP/2 and SHA256 identifiers stay unchanged.",
    ),
  ).toEqual([]);
});

test("reported count, revision and punctuation joins are missing-space cues", () => {
  const draft = [
    "Required checks exited0. All8 selected files match.",
    "Both reviews passed;26 tests pass after15minutes.",
    "Installed froma1b2c3d using the existing installer.",
    "All12 managed files match. Backups retained;103 entries checked; repeat changed0 files.",
  ].join("\n");
  const spacing = check(draft).filter((f) => f.rule === "missing-space");
  expect(spacing.map((f) => f.text)).toEqual([
    "exited",
    "All",
    "passed;",
    "after",
    "from",
    "All",
    "retained;",
    "changed",
  ]);
  for (const finding of spacing) {
    expect(draft.split("\n")[finding.line - 1]?.slice(finding.col - 1)).toStartWith(finding.text);
  }
  expect(
    check(
      draft
        .replace(/exited0/g, "exited 0")
        .replace(/All(\d+)/g, "All $1")
        .replace(/;(\d+)/g, "; $1")
        .replace("after15minutes", "after 15 minutes")
        .replace("froma1b2c3d", "from a1b2c3d")
        .replace("changed0", "changed 0"),
    ),
  ).toEqual([]);
  for (const input of [
    "All8 files match.",
    "Checks exited0.",
    "Repeat changed0 files.",
    "Installed froma1b2c3d.",
    "Checks passed;26 tests pass.",
    "Backups retained;103 entries checked.",
  ]) {
    const result = spawnSync(process.execPath, [SCRIPT, "--json"], { input, encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toContainEqual(
      expect.objectContaining({ rule: "missing-space" }),
    );
  }
});

test("new spacing cues preserve technical tokens and explicitly kept text", () => {
  const draft = [
    "Use `All8`, `exited0`, `changed0`, `froma1b2c3d` and `passed;26`.",
    'The quoted output is "All12 exited0 froma1b2c3d;26".',
    "See https://example.com/All8/froma1b2c3d or [log](./changed0.txt).",
    "See logs/archive;26, ./archive,26 and src/retained;103 for the saved files.",
    "Use /logs/All8, ./exited0.txt, src/changed0.json and C:\\logs\\froma1b2c3d.txt.",
    "Keep task-All8, changed0.json, exited0_status, froma1b2c3d.json and All8Parser identifiers.",
    "HTTP/2, SHA256, H264, UTF8, IPv6, v1.2.3 and a1b2c3d remain literal.",
    "The ID is 123e4567-e89b-12d3-a456-426614174000; ports are 127.0.0.1:8080.",
    "> All8 exited0 froma1b2c3d;26",
    "```text",
    "All8 exited0 froma1b2c3d;26",
    "```",
  ].join("\n");
  expect(check(draft)).toEqual([]);
});

test("every term in SKILL.md's two word tables is loaded", () => {
  const terms = parseWordTables(readFileSync(join(import.meta.dir, "../SKILL.md"), "utf8"));
  // 17 terms in "Choose plain words" and 12 in "Name the actual thing". A
  // reformatted table that the parser no longer reads fails here.
  expect(terms.length).toBe(29);
  expect(terms.map((t) => t.term)).toContain("center of gravity");
});

test("dash stand-ins, a colon reveal, curly quotes, table words and filler are flagged", () => {
  const draft = [
    "The cause was simple: a stale cache.",
    "This design is robust — it delves into the landscape.",
    "Retry once – then stop - or wait.",
    "Let me know if the “fix” works.",
  ].join("\n");
  expect(rules(draft)).toEqual([
    "1 colon-reveal : a stale cache",
    "2 word robust",
    "2 em-dash —",
    "2 word delves into",
    "2 word landscape",
    "3 spaced-en-dash –",
    "3 spaced-hyphen -",
    "4 filler Let me know if",
    "4 curly-quote “",
    "4 curly-quote ”",
  ]);
});

test("inflections of a table word match", () => {
  expect(rules("It elevated the pillar and fostering helped.").map((r) => r.split(" ")[2])).toEqual(
    ["elevated", "pillar", "fostering"],
  );
});

test("lists, labels, samples and plain colons are not reveals", () => {
  const draft = [
    "Three files changed: a.ts, b.ts and c.ts.",
    "Note: this is fine.",
    "**Fix**: the parser now rejects tabs.",
    "Run it from the skill's directory: `bun check.mjs draft.md`",
    "The meeting starts at 10:30 today.",
    "The steps are:",
    "# Heading with a colon: and more words here",
  ].join("\n");
  expect(rules(draft)).toEqual([]);
});

test("code, URLs, quotations and kept passages are left alone", () => {
  const draft = [
    "```",
    "robust — code",
    "```",
    "Use `a — b` and see [the docs](https://example.com/robust) or https://robust.dev.",
    "> a robust quotation",
    'The table lists "robust" and "in order to" as cues.',
    "<!-- plain-prose: keep -->",
    "A robust tapestry the author wants kept.",
    "",
    "Hyphenated well-known words and ranges such as 10-20 or 10–20 stay.",
    "## 0.5.12 - 2026-10-04",
  ].join("\n");
  expect(rules(draft)).toEqual([]);
});

test("word-table rows, wrapped quotes, list labels and technical senses are not cues", () => {
  const draft = [
    "| robust | name the failure it survives |",
    "Delete announcements (\"Here's a breakdown",
    'of...") and keep the title "Version 2 - is the',
    'old parser dead".',
    "- Weekly Sunday 05:00 (task `nightly-image`): shadow copy of the live disk",
    "2. Tests for what changed: the files the doc names",
    "Run an elevated PowerShell session; the script self-elevates. In an elevated",
    "**Windows** shell the shadows keep their elevation.",
    "Both the `50`–`950` and `1`–`12` scales map to roles.",
    "| — | `C:\\System Volume Information` | out of scope |",
    "| – | empty | cell |",
    "Count the distinct shadows; nine means each page invented its own elevation.",
  ].join("\n");
  expect(rules(draft)).toEqual([]);
});

test("the same cues outside those shapes are still flagged", () => {
  const draft = [
    "| Area | A robust plan |",
    'A "stray quote opens here.',
    "",
    "A robust plan.",
    "- It ran twice. The cause was simple: a stale cache.",
    "It elevated the brand.",
    "- Semantic risk is the larger tax: the turns that break are rare.",
    "Run `make` – then stop.",
    "| setting | robust plan |",
    "- Semantic risk is the larger tax : the turns that break are rare.",
    "The elevation of the brand matters.",
  ].join("\n");
  expect(rules(draft)).toEqual([
    "1 word robust",
    "4 word robust",
    "5 colon-reveal : a stale cache",
    "6 word elevated",
    "7 colon-reveal : the turns that break are rare",
    "8 spaced-en-dash –",
    "9 word robust",
    "10 colon-reveal : the turns that break are rare",
    "11 word elevation",
  ]);
});

test("the CLI reads standard input and exits 1 on findings, 0 when clean", () => {
  /**
   * @param {string} input
   * @param {string[]} args
   */
  const run = (input, ...args) =>
    spawnSync(process.execPath, [SCRIPT, ...args], { input, encoding: "utf8" });
  const dirty = run("A robust plan.\n");
  expect(dirty.status).toBe(1);
  expect(dirty.stdout).toContain('<stdin>:1:3 word "robust"');
  expect(run("A plan that survives a restart.\n").status).toBe(0);
  const json = JSON.parse(run("A robust plan.\n", "--json").stdout);
  expect(json[0]).toMatchObject({ file: "<stdin>", line: 1, col: 3, rule: "word" });
  expect(run("", "--nope").status).toBe(2);
  expect(run("", "/no/such/file.md").status).toBe(2);
});

test("a sentence over 30 words is flagged once, even when it wraps", () => {
  const long = Array.from({ length: 31 }, (_, i) => `w${i}`);
  const draft = [
    "A short sentence stays quiet.",
    `${long.slice(0, 15).join(" ")}`,
    `${long.slice(15).join(" ")}.`,
    "",
    `- ${long.slice(0, 30).join(" ")}.`,
    "",
    "```",
    `${long.join(" ")}.`,
    "```",
  ].join("\n");
  expect(rules(draft)).toEqual(["2 long-sentence w0 w1 w2 w3 w4"]);
});

test("front matter is not read as a sentence", () => {
  const long = Array.from({ length: 31 }, (_, i) => `w${i}`).join(" ");
  expect(rules(`---\ndescription: ${long}.\n---\n\nShort.`)).toEqual([]);
});

test("initialisms and version numbers do not end a sentence", () => {
  /** @param {number} n */
  const words = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
  expect(rules(`${words(20)}, e.g. ${words(5)} in v0.5.19 ${words(5)}.`)).toEqual([
    "1 long-sentence w0 w1 w2 w3 w4",
  ]);
  expect(rules(`${words(25)} e.g. w25 w26 w27 w28.`)).toEqual([]);
});

test("a final initialism ends a sentence, while internal abbreviations stay together", () => {
  /** @param {number} n */
  const words = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
  const draft = `${words(28)} U.S. We agree.`;
  expect(rules(draft)).toEqual([]);
  const cli = spawnSync(process.execPath, [SCRIPT], { input: draft, encoding: "utf8" });
  expect(cli.status).toBe(0);
  expect(rules(`${words(28)} U.S. policy applies.`)).toEqual(["1 long-sentence w0 w1 w2 w3 w4"]);
  expect(rules(`${words(28)} e.g. JSON data follows.`)).toEqual(["1 long-sentence w0 w1 w2 w3 w4"]);
});
