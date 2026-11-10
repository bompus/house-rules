// The two guidance-text rules that setupLinuxHost's adoption check (ubuntu/check-agent-config.ts:
// findAccretedBlocks and findDatedWording) applies to a house-rules pin, run here so a change fails
// before adoption refuses it. The thresholds and the per-file ceilings below are copied from that file
// (ACCRETION_CEILINGS and ACCRETION_FILE_CEILINGS, with skills/personal/ read as skills/); keep them in
// step with it.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// A prose block (blank-line separated, outside fences) longer than this reads as several additions
// stacked where one rewrite belonged. Headings, tables and list blocks carry their length.
const BLOCK_CEILING = 900;
// Known longer blocks in skills, by file, as setupLinuxHost allows them. Split a new long block; do not add one.
/** @type {Record<string, number>} */
const FILE_CEILINGS = {
  "skills/hr-code-review/SKILL.md": 1650,
  "skills/hr-diagnosing-bugs/SKILL.md": 910,
  "skills/hr-benchmarking/references/tools.md": 1450,
  "skills/hr-benchmarking/SKILL.md": 1150,
  "skills/hr-pr-followup/references/review-helpers.md": 1150,
  "skills/hr-agent-guidance-audit/SKILL.md": 1010,
};
// Logs keep their dates: findings and sources ledgers, archives, and these records.
const DATED_LOGS = [
  /\/references\/(?:findings|sources)\.md$/,
  /\/archive\//,
  /^skills\/hr-sqlite\/references\/(?:evidence|tool-decisions)\.md$/,
];
const ISO_DATE = /\b20\d\d-[01]\d-[0-3]\d\b/;

/** @param {string} dir @returns {string[]} */
const markdownFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.name === "node_modules") {
      return [];
    }
    return entry.isDirectory() ? markdownFiles(path) : entry.name.endsWith(".md") ? [path] : [];
  });

/** @param {string} text @returns {{ line: number, chars: number }[]} the prose blocks over the ceiling */
function longBlocks(text, ceiling = BLOCK_CEILING) {
  const lines = text.split("\n");
  let i = 0;
  if (lines[0] === "---") {
    const end = lines.indexOf("---", 1);
    i = end === -1 ? 0 : end + 1;
  }
  /** @type {{ line: number, chars: number }[]} */
  const found = [];
  let fenced = false;
  /** @type {string[]} */
  let block = [];
  let start = 0;
  const flush = () => {
    const body = block.join("\n").trim();
    block = [];
    if (body && !/^(#|\||[-*]\s|\d+\.\s)/.test(body) && body.length > ceiling) {
      found.push({ line: start, chars: body.length });
    }
  };
  for (; i < lines.length; i++) {
    const text = (lines[i] ?? "").trim();
    if (text.startsWith("```")) {
      flush();
      fenced = !fenced;
    } else if (!fenced && text === "") {
      flush();
    } else if (!fenced) {
      if (block.length === 0) {
        start = i + 1;
      }
      block.push(lines[i] ?? "");
    }
  }
  flush();
  return found;
}

/** @param {string} text @returns {number[]} the lines that carry an ISO date outside code and link targets */
function datedLines(text) {
  let fenced = false;
  /** @type {number[]} */
  const found = [];
  text.split("\n").forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
    } else if (
      !fenced &&
      ISO_DATE.test(line.replaceAll(/`[^`]*`/g, "").replaceAll(/\]\([^)]*\)/g, "]"))
    ) {
      found.push(i + 1);
    }
  });
  return found;
}

test("the block rule skips headings, lists, tables and fences and counts a wrapped paragraph whole", () => {
  const long = "word ".repeat(200).trim();
  assert.deepEqual(
    longBlocks(`# ${long}\n\n- ${long}\n\n| ${long} |\n\n\`\`\`\n${long}\n\`\`\`\n`),
    [],
  );
  assert.deepEqual(longBlocks(`---\ntitle: x\n---\n\nintro\n\n${long}\nsecond line\n`), [
    { line: 7, chars: long.length + "\nsecond line".length },
  ]);
});

test("the date rule skips code spans, link targets and fences", () => {
  assert.deepEqual(
    datedLines("on 2026-11-10 it changed\n`2026-11-10` [x](a-2026-11-10)\n```\n2026-11-10\n```\n"),
    [1],
  );
});

test("no skill text has a prose block over the ceiling beyond the known ones", () => {
  const over = markdownFiles(join(root, "skills")).flatMap((file) => {
    const name = relative(root, file);
    const limit = FILE_CEILINGS[name] ?? BLOCK_CEILING;
    return longBlocks(readFileSync(file, "utf8"), limit).map(
      ({ line, chars }) => `${name}:${line} is ${chars} characters, over ${limit}`,
    );
  });
  assert.deepEqual(over, [], "split the block into shorter paragraphs or a list");
});

test("no skill text carries a dated label outside the logs", () => {
  const dated = markdownFiles(join(root, "skills"))
    .map((file) => relative(root, file))
    .filter((name) => !DATED_LOGS.some((log) => log.test(`/${name}`) || log.test(name)))
    .flatMap((name) =>
      datedLines(readFileSync(join(root, name), "utf8")).map((line) => `${name}:${line}`),
    );
  assert.deepEqual(dated, [], "describe current behavior; version history belongs in CHANGELOG.md");
});
