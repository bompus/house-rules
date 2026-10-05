#!/usr/bin/env node
// Lists the spots in a draft that the plain-prose skill asks you to reread:
// dash stand-ins, colons between two clauses, curly quotes, the words in
// SKILL.md's two word tables and sentences over 30 words. Every finding is a
// cue, not a verdict.
// Runs on Node 22+ or Bun with no dependencies.
//
//   check.mjs [--json] [<file>...]   (no file, or -, reads standard input)
//
// Skipped as material to keep: fenced code, inline code, URLs, text in
// straight double quotes (also when the quote wraps onto the next line), block
// quotes, the paragraph after a `plain-prose: keep` comment, and the rows of a
// word table like SKILL.md's own.
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

// A word-table row has a plain term in its first cell and a replacement in its
// second: "| delve into | look at, read, test |". Returns the two cells.
function wordTableRow(line) {
  const cells = line.split("|").map((c) => c.trim());
  if (cells.length !== 4 || cells[0] !== "" || cells[3] !== "") return null;
  return /^[a-z][a-z ,]*$/.test(cells[1]) ? cells.slice(1, 3) : null;
}

export function parseWordTables(markdown) {
  const terms = [];
  for (const line of markdown.split("\n")) {
    const row = wordTableRow(line);
    if (!row) continue;
    const [words, hint] = row;
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

// Technical senses of a table word, not the inflated usage the table targets:
// an administrator ("elevated") shell on Windows, and "elevation" as shadow
// depth in an interface (a "shadow" within 120 characters, same paragraph).
const NEAR = String.raw`(?:(?!\n[ \t]*\n)[\s\S]){0,120}?`;
const TECHNICAL = [
  /\bself-elevat\w*/gi,
  /\belevated(?:\*\*|__)?\s+(?:\*\*|__)?(?:shell|prompt|session|terminal|powershell|windows|command|capture|recording|follow-up|privileges?|rights|token)\b/gi,
  new RegExp(String.raw`\bshadow${NEAR}\belevation\b|\belevation\b(?=${NEAR}\bshadow)`, "gi"),
];

const DASHES = [
  { re: /—/g, rule: "em-dash" },
  { re: /\s–\s/g, rule: "spaced-en-dash" },
  // A spaced hyphen between two numbers is a range or a date heading.
  { re: /(?<=[A-Za-z_])\s--?\s(?=\w)|(?<=\d)\s--?\s(?=[A-Za-z_])/g, rule: "spaced-hyphen" },
];

// Replaces kept spans with spaces of the same length and keeps line breaks, so
// lines and columns still line up. Code spans and quotes may wrap onto the next
// line but never cross a blank line. A code span becomes KEPT characters,
// neither space nor word, so `50`–`950` does not read as a spaced dash.
const KEPT = "\u2063";
const blank = (s) => s.replace(/[^\n]/g, " ");
const keptCode = (s) => s.replace(/[^\n]/g, KEPT);
const WRAP = String.raw`(?:[^"\n]|\n(?![ \t]*\n))`;
function prose(doc) {
  return doc
    .replace(new RegExp(String.raw`(\`+)(?:[^\`\n]|\n(?![ \t]*\n))*?\1`, "g"), keptCode)
    .replace(new RegExp(`"${WRAP}*"`, "g"), blank)
    .replace(/\]\([^)\n]*\)/g, blank)
    .replace(/<?\bhttps?:\/\/\S+/g, blank)
    .replace(/<!--[\s\S]*?-->/g, blank);
}

// The first colon of a list item ends a label when the text before it ends in
// a parenthesis or code, or is a phrase of up to six words with no linking
// verb: "- Weekly backup (task): a shadow copy", "2. Tests for what changed:
// the files". "- Semantic risk is the larger tax: ..." stays a reveal.
const LINKING = /\b(is|are|was|were|be|been|has|have|had|do|does|did|can|will|should|must)\b/i;
function listLabel(head) {
  if (/[.!?]\s|: /.test(head)) return false;
  if (new RegExp(`(\\)|${KEPT})$`).test(head.trimEnd())) return true;
  return head.trim().split(/\s+/).length <= 6 && !LINKING.test(head);
}

// A colon between two clauses in a sentence: at least four words before it,
// a sentence after it, and no comma there that would make it a list.
function colonReveals(text) {
  const found = [];
  const marker = text.match(/^\s*([-*+]|\d+\.)\s+/)?.[0].length;
  for (const m of text.matchAll(/: +(?=[A-Za-z])/g)) {
    const head = text.slice(marker ?? 0, m.index);
    if (marker && listLabel(head)) continue;
    const before = head.split(/[.!?]\s+/).pop();
    const after = text.slice(m.index + m[0].length).split(/[.!?](\s|$)/)[0];
    if (before.trim().split(/\s+/).length < 4 || /\*\*|__/.test(before)) continue;
    if (after.includes(",") || after.trim().split(/\s+/).length < 2) continue;
    found.push({ index: m.index, text: text.slice(m.index, m.index + m[0].length + after.length) });
  }
  return found;
}

// Marks the lines that hold no prose to check: fenced code, block quotes, and
// the keep comment with the paragraph after it.
function skippedLines(lines) {
  let fence = null;
  let keep = false;
  return lines.map((raw) => {
    const fenceMark = raw.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      if (fenceMark && fenceMark[1][0] === fence[0] && fenceMark[1].length >= fence.length)
        fence = null;
      return true;
    }
    if (fenceMark) {
      fence = fenceMark[1];
      return true;
    }
    if (/plain-prose:\s*keep/.test(raw)) return (keep = true);
    if (raw.trim() === "") return (keep = false);
    return keep || /^\s*>/.test(raw);
  });
}

// Sentences over LONG words. A paragraph or list item is read as one run, so
// a sentence that wraps across lines counts once. Kept spans count as no words.
const LONG = 30;
function longSentences(doc, raws, skipped) {
  const found = [];
  const lines = doc.split("\n");
  let unit = [];
  const flush = () => {
    let joined = "";
    const at = [];
    for (const { i, text } of unit) {
      if (joined) {
        joined += " ";
        at.push(null);
      }
      for (let c = 0; c < text.length; c++) at.push([i, c]);
      joined += text;
    }
    unit = [];
    // Keep dotted tokens and internal abbreviations together. An uppercase
    // initialism may end a sentence when the next word starts with a capital.
    const ends = [...joined.matchAll(/[.!?]+(?=\s|$)/g)]
      .filter((e) => {
        if (e[0] !== ".") return true;
        const initialism = joined.slice(0, e.index).match(/(?:^|\s)((?:[A-Za-z]\.)+[A-Za-z])$/);
        if (!initialism) return true;
        return /^[A-Z.]+$/.test(initialism[1]) && /^\s+[A-Z]/.test(joined.slice(e.index + 1));
      })
      .map((e) => e.index + e[0].length);
    let from = 0;
    for (const end of [...ends, joined.length]) {
      const sentence = joined.slice(from, end);
      const start = from;
      from = end;
      const words = sentence.match(/[A-Za-z0-9][\w'-]*(?:\.[A-Za-z0-9][\w'-]*)*/g) ?? [];
      if (words.length <= LONG) continue;
      const lead = start + sentence.search(/\S/);
      const [i, col] = at[lead];
      found.push({
        line: i + 1,
        col: col + 1,
        rule: "long-sentence",
        text: raws[i].slice(col).trim().split(/\s+/).slice(0, 5).join(" "),
        hint: `${words.length} words; split it`,
      });
    }
  };
  // Front matter holds fields, not sentences.
  const front = raws[0] === "---" ? raws.indexOf("---", 1) : -1;
  lines.forEach((text, i) => {
    const raw = raws[i];
    if (i <= front || skipped[i] || raw.trim() === "" || /^\s*(#|\|)/.test(raw)) return flush();
    if (/^\s*([-*+]|\d+\.)\s/.test(raw)) flush();
    unit.push({ i, text });
  });
  flush();
  return found;
}

export function check(markdown, terms = parseWordTables(readFileSync(SKILL, "utf8"))) {
  const findings = [];
  const raws = markdown.split("\n");
  const skipped = skippedLines(raws);
  const doc = prose(raws.map((raw, i) => (skipped[i] ? blank(raw) : raw)).join("\n"));
  const technical = TECHNICAL.flatMap((re) =>
    [...doc.matchAll(re)].map((m) => [m.index, m.index + m[0].length]),
  );
  // A row of a word table defines its terms; the same words elsewhere are cues.
  const known = new Set(terms.map((t) => t.term));
  const defines = (raw) =>
    wordTableRow(raw)?.[0]
      .split(/,\s*/)
      .every((t) => known.has(t));
  let offset = 0;
  doc.split("\n").forEach((text, i) => {
    const raw = raws[i];
    const start = offset;
    offset += text.length + 1;
    if (skipped[i] || raw.trim() === "") return;
    const line = i + 1;
    const add = (rule, index, match, hint) =>
      findings.push({
        line,
        col: index + 1,
        rule,
        text: raw.slice(index, index + match.length).trim(),
        ...(hint && { hint }),
      });
    for (const { re, rule } of DASHES) {
      for (const m of text.matchAll(re)) {
        // A table cell holding only a dash marks an empty cell.
        const cell =
          /\|\s*$/.test(text.slice(0, m.index)) && /^\s*\|/.test(text.slice(m.index + m[0].length));
        if (!cell) add(rule, m.index, m[0], "end the sentence or use a comma");
      }
    }
    for (const m of text.matchAll(/[‘’“”]/g)) {
      add("curly-quote", m.index, m[0], "use straight quotes");
    }
    if (!/^\s*(#|\|)/.test(raw)) {
      for (const c of colonReveals(text))
        add("colon-reveal", c.index, c.text, "state the point directly");
    }
    if (!defines(raw)) {
      for (const { term, hint, re } of terms) {
        for (const m of text.matchAll(re)) {
          const at = start + m.index;
          if (technical.some(([a, b]) => at >= a && at < b)) continue;
          add("word", m.index, m[0], `${term}: ${hint}`);
        }
      }
    }
    for (const { term, re } of CHAT) {
      for (const m of text.matchAll(re)) add("filler", m.index, m[0], `cut "${term}"`);
    }
  });
  findings.push(...longSentences(doc, raws, skipped));
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
