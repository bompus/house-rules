#!/usr/bin/env node
// Lists the spots in a draft that the plain-prose skill asks you to reread:
// dash stand-ins, colons between two clauses, curly quotes, and the words in
// SKILL.md's two word tables. Every finding is a cue, not a verdict.
// Runs on Node 22+ or Bun with no dependencies.
//
//   check.mjs [--json] [<file>...]   (no file, or -, reads standard input)
//
// Skipped as material to keep: fenced code, inline code, URLs, text in
// straight double quotes, block quotes, and the paragraph after a
// `plain-prose: keep` comment.
// Exit codes: 0 no findings, 1 findings, 2 bad usage or an unreadable file.

import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const SKILL = join(dirname(fileURLToPath(import.meta.url)), "..", "SKILL.md");

// A term matches its inflections: the first word keeps its stem without a
// final "e" or "s" ("elevate" matches "elevating", "pillars" matches
// "pillar"); later words match exactly.
function termPattern(term) {
  const [first, ...rest] = term.toLowerCase().split(/\s+/);
  const stem = first.length > 4 ? first.replace(/[es]$/, "") : first;
  return [`${stem}\\w*`, ...rest].join("\\s+");
}

// The word tables are the rows whose first cell is a plain term and second a
// replacement: "| delve into | look at, read, test |".
export function parseWordTables(markdown) {
  const terms = [];
  for (const line of markdown.split("\n")) {
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length !== 4 || cells[0] !== "" || cells[3] !== "") continue;
    const [, words, hint] = cells;
    if (!/^[a-z][a-z ,]*$/.test(words)) continue;
    for (const term of words.split(/,\s*/)) {
      terms.push({ term, hint, re: new RegExp(`\\b${termPattern(term)}\\b`, "gi") });
    }
  }
  return terms;
}

const CHAT = [
  "great question",
  "i hope this helps",
  "let me know if",
  "here's a breakdown",
  "as an ai",
  "it is worth noting",
  "it's worth noting",
  "in order to",
  "at the end of the day",
].map((p) => ({ term: p, re: new RegExp(`\\b${p.replace(/ /g, "\\s+")}\\b`, "gi") }));

const DASHES = [
  { re: /—/g, rule: "em-dash" },
  { re: /\s–\s/g, rule: "spaced-en-dash" },
  // A spaced hyphen between two numbers is a range or a date heading.
  { re: /(?<=[A-Za-z_])\s--?\s(?=\w)|(?<=\d)\s--?\s(?=[A-Za-z_])/g, rule: "spaced-hyphen" },
];

// Replaces kept spans with spaces of the same length, so columns still line up.
const blank = (s) => " ".repeat(s.length);
function prose(line) {
  return line
    .replace(/(`+)[^`]*?\1/g, blank)
    .replace(/"[^"]*"/g, blank)
    .replace(/\]\([^)]*\)/g, blank)
    .replace(/<?\bhttps?:\/\/\S+/g, blank)
    .replace(/<!--.*?-->/g, blank);
}

// A colon between two clauses in a sentence: at least four words before it,
// a sentence after it, and no comma there that would make it a list.
function colonReveals(text) {
  const found = [];
  for (const m of text.matchAll(/: +(?=[A-Za-z])/g)) {
    const before = text
      .slice(0, m.index)
      .split(/[.!?]\s+/)
      .pop()
      .replace(/^\s*([-*+]|\d+\.)\s+/, "");
    const after = text.slice(m.index + m[0].length).split(/[.!?](\s|$)/)[0];
    if (before.trim().split(/\s+/).length < 4 || /\*\*|__/.test(before)) continue;
    if (after.includes(",") || after.trim().split(/\s+/).length < 2) continue;
    found.push({ index: m.index, text: text.slice(m.index, m.index + m[0].length + after.length) });
  }
  return found;
}

export function check(markdown, terms = parseWordTables(readFileSync(SKILL, "utf8"))) {
  const findings = [];
  let fence = null;
  let keep = false;
  markdown.split("\n").forEach((raw, i) => {
    const line = i + 1;
    const fenceMark = raw.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      if (fenceMark && fenceMark[1][0] === fence[0] && fenceMark[1].length >= fence.length)
        fence = null;
      return;
    }
    if (fenceMark) {
      fence = fenceMark[1];
      return;
    }
    if (/plain-prose:\s*keep/.test(raw)) {
      keep = true;
      return;
    }
    if (raw.trim() === "") {
      keep = false;
      return;
    }
    if (keep || /^\s*>/.test(raw)) return;
    const text = prose(raw);
    const add = (rule, index, match, hint) =>
      findings.push({ line, col: index + 1, rule, text: match.trim(), ...(hint && { hint }) });
    for (const { re, rule } of DASHES) {
      for (const m of text.matchAll(re))
        add(rule, m.index, m[0], "end the sentence or use a comma");
    }
    for (const m of text.matchAll(/[‘’“”]/g)) {
      add("curly-quote", m.index, m[0], "use straight quotes");
    }
    if (!/^\s*(#|\|)/.test(raw)) {
      for (const c of colonReveals(text))
        add("colon-reveal", c.index, c.text, "state the point directly");
    }
    for (const { term, hint, re } of terms) {
      for (const m of text.matchAll(re)) add("word", m.index, m[0], `${term}: ${hint}`);
    }
    for (const { term, re } of CHAT) {
      for (const m of text.matchAll(re)) add("filler", m.index, m[0], `cut "${term}"`);
    }
  });
  return findings.sort((a, b) => a.line - b.line || a.col - b.col);
}

function main() {
  let parsed;
  try {
    parsed = parseArgs({ options: { json: { type: "boolean" } }, allowPositionals: true });
  } catch (e) {
    console.error(e.message);
    return 2;
  }
  const files = parsed.positionals.length ? parsed.positionals : ["-"];
  let terms;
  try {
    terms = parseWordTables(readFileSync(SKILL, "utf8"));
  } catch (e) {
    console.error(`cannot read the word tables in ${SKILL}: ${e.message}`);
    return 2;
  }
  const all = [];
  for (const file of files) {
    let body;
    try {
      body = readFileSync(file === "-" ? 0 : file, "utf8");
    } catch (e) {
      console.error(`${file}: ${e.message}`);
      return 2;
    }
    for (const f of check(body, terms)) all.push({ file: file === "-" ? "<stdin>" : file, ...f });
  }
  if (parsed.values.json) {
    console.log(JSON.stringify(all, null, 2));
  } else {
    for (const f of all) {
      console.log(
        `${f.file}:${f.line}:${f.col} ${f.rule} "${f.text}"${f.hint ? ` (${f.hint})` : ""}`,
      );
    }
    if (all.length) console.log(`${all.length} spot(s) to reread. Each is a cue, not a verdict.`);
  }
  return all.length ? 1 : 0;
}

if (
  process.argv[1] &&
  realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])
) {
  process.exitCode = main();
}
