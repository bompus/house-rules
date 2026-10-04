import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { check, parseWordTables } from "../scripts/check.mjs";

const SCRIPT = join(import.meta.dir, "../scripts/check.mjs");
const rules = (text) => check(text).map((f) => `${f.line} ${f.rule} ${f.text}`);

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
  ].join("\n");
  expect(rules(draft)).toEqual([
    "1 word robust",
    "4 word robust",
    "5 colon-reveal : a stale cache",
    "6 word elevated",
    "7 colon-reveal : the turns that break are rare",
    "8 spaced-en-dash –",
  ]);
});

test("the CLI reads standard input and exits 1 on findings, 0 when clean", () => {
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
