#!/usr/bin/env bun
// Splits a large ledger into chunks for read-only verification helpers, machine-checks the closures they
// propose and applies the ones that hold. See ../references/consolidating.md.
//   chunk <plan> <outdir> [--lines 60] [--bytes 70000] [--force]
//     Copies the plan to <outdir>/plan.snapshot.md and writes chunk-NN.txt, one `L<line>\t<ledger line>` row per
//     open or deferred item. It will not replace an existing snapshot without --force, because the helpers'
//     results refer to that snapshot's line numbers.
//   verify <outdir> [--exclude <file>] [--offline]
//     Reads <outdir>/results-*.tsv (header `line\tverdict\tevidence\tnote`, one row per ledger line, verdict
//     DONE, SUPERSEDED, WAITING, DECISION, OPEN or UNCLEAR) and checks each proposed closure against the
//     snapshot and GitHub, then writes <outdir>/closure-candidates.json. A DONE row is `ok` only when every
//     `owner/repo#n` it names is merged or closed and it names at least one merged or closed pull request or
//     issue or a ledger line already marked done (`L<n>`). A SUPERSEDED row is `ok` when it names another ledger
//     line that exists. The other flags: BAD (a named pull request or issue is still open or not found),
//     UNCHECKED (a DONE row, or its line, names a pull request or issue without its repository, such as
//     `tool#2` or `PR #42`, unless the same number is named with one),
//     NOREF (nothing checkable is named), EXCLUDED (the line is in the --exclude file of weaker evidence),
//     CONFLICT (two rows disagree about a line) and INVALID (unknown verdict, or not an open or deferred
//     line of the snapshot). Only `ok` rows are ever applied. Run one verify at a time per work directory.
//   apply <outdir> <plan> [--dry-run] [--time <text>]
//     Closes every `ok` candidate in place with close-ledger-line.mjs and the evidence plus the checks that
//     passed, after copying the plan to <outdir>/plan.before-closures.md once. A line whose text changed since
//     the snapshot, or that is no longer open, is skipped and reported. Running it again changes nothing.
// Exit 0: done; 1: invalid input; 3: GitHub could not be asked, so nothing was verified.
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { githubStates } from "./github-state.mjs";
import { parsePlan } from "./plan-ledger.mjs";

/** @typedef {import("./plan-ledger.mjs").LedgerItem} LedgerItem */
/**
 * @typedef {object} Candidate
 * @property {number} line
 * @property {string} verdict
 * @property {string} evidence
 * @property {string} note
 * @property {string} file
 * @property {string[]} checks
 * @property {{ line: number, mark: string, text: string }[]} lineRefs ledger lines the closure rests on, as they stood in the snapshot
 * @property {string} flag
 */

const USAGE = [
  "usage: consolidate-ledger.mjs chunk <plan.md> <outdir> [--lines <n>] [--bytes <n>] [--force]",
  "       consolidate-ledger.mjs verify <outdir> [--exclude <file>] [--offline]",
  "       consolidate-ledger.mjs apply <outdir> <plan.md> [--dry-run] [--time <text>]",
].join("\n");
const VERDICTS = ["DONE", "SUPERSEDED", "WAITING", "DECISION", "OPEN", "UNCLEAR"];
const SNAPSHOT = "plan.snapshot.md";
const BACKUP = "plan.before-closures.md";
const CANDIDATES = "closure-candidates.json";
const WRITTEN = "closures-written.json";
const closeScript = join(import.meta.dirname, "close-ledger-line.mjs");

class UsageError extends Error {}

/** @param {string} text */
const oneLine = (text) => text.replace(/\s+/g, " ").trim();

/**
 * @param {string[]} argv
 * @param {string[]} flags options without a value
 * @param {string[]} valued options with a value
 */
function parseArguments(argv, flags, valued) {
  /** @type {string[]} */
  const positional = [];
  /** @type {Map<string, string | true>} */
  const options = new Map();
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index] ?? "";
    if (flags.includes(argument)) {
      options.set(argument, true);
    } else if (valued.includes(argument)) {
      const value = argv[++index];
      if (value === undefined) {
        throw new UsageError(`${argument} needs a value\n${USAGE}`);
      }
      options.set(argument, value);
    } else if (argument.startsWith("--")) {
      throw new UsageError(`unknown option ${argument}\n${USAGE}`);
    } else {
      positional.push(argument);
    }
  }
  return { positional, options };
}

/**
 * The open and deferred items of a plan, as the helpers see them.
 * @param {string} text
 */
function openItems(text) {
  return parsePlan(text).items.filter((item) => item.mark === " " || item.mark === "~");
}

/** @param {LedgerItem} item */
const chunkRow = (item) => `L${item.line}\t- [${item.mark}] ${oneLine(item.text)}`;

/**
 * @param {string} planPath
 * @param {string} outdir
 * @param {{ lines: number, bytes: number, force: boolean }} limits
 */
function chunk(planPath, outdir, { lines, bytes, force }) {
  const snapshot = join(outdir, SNAPSHOT);
  if (existsSync(snapshot) && !force) {
    throw new UsageError(
      `refused: ${snapshot} exists and the helpers' results refer to its line numbers; use a new directory or --force`,
    );
  }
  if (
    existsSync(outdir) &&
    (existsSync(join(outdir, CANDIDATES)) ||
      readdirSync(outdir).some((n) => /^results-.+\.tsv$/.test(n)))
  ) {
    throw new UsageError(
      `refused: ${outdir} holds results or closure candidates for the old snapshot; use a new directory`,
    );
  }
  mkdirSync(outdir, { recursive: true });
  // A directory replaced with --force must not keep chunks from the old snapshot.
  for (const name of readdirSync(outdir).filter((n) => /^chunk-\d+\.txt$/.test(n))) {
    rmSync(join(outdir, name));
  }
  copyFileSync(planPath, snapshot);
  const rows = openItems(readFileSync(snapshot, "utf8")).map(chunkRow);
  /** @type {string[][]} */
  const chunks = [];
  let current = /** @type {string[]} */ ([]);
  let size = 0;
  for (const row of rows) {
    const rowBytes = Buffer.byteLength(row);
    if (current.length && (current.length >= lines || size + rowBytes > bytes)) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(row);
    size += rowBytes;
  }
  if (current.length) {
    chunks.push(current);
  }
  chunks.forEach((rowsOfChunk, index) => {
    const name = `chunk-${String(index + 1).padStart(2, "0")}.txt`;
    writeFileSync(join(outdir, name), `${rowsOfChunk.join("\n")}\n`);
  });
  return `${rows.length} open or deferred line(s) in ${chunks.length} chunk(s); snapshot ${snapshot}`;
}

/**
 * Rows of every results-*.tsv in the directory, in file order.
 * @param {string} outdir
 */
function readResults(outdir) {
  const files = readdirSync(outdir)
    .filter((name) => /^results-.+\.tsv$/.test(name))
    .sort();
  if (!files.length) {
    throw new UsageError(`no results-*.tsv files in ${outdir}`);
  }
  return files.flatMap((file) =>
    readFileSync(join(outdir, file), "utf8")
      .split(/\r?\n/)
      .filter((row) => row.trim() && !/^line\t/i.test(row))
      .map((row) => ({ file, row })),
  );
}

/** @param {string} path */
function readExclusions(path) {
  return new Set(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .map(
        (row) =>
          row
            .replace(/#.*/, "")
            .trim()
            .match(/^L?(\d+)\b/)?.[1],
      )
      .filter((value) => value !== undefined)
      .map(Number),
  );
}

const PULL_OR_ISSUE = /([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(\d+)/g;
// Not the fragment of a link into a file (`...#L7`) or a path (`src/L7`).
const LEDGER_LINE = /(?<![\w#/.-])L(\d{1,6})\b/g;

// `tool#2` names a pull request or issue but not whose, so it cannot be checked.
const BARE_REFERENCE = /(?<![\w./#-])[\w.-]+#\d+\b/g;
// `PR #42`, `PR 42` and `#42` name a number without a repository, which cannot be checked either.
const BARE_NUMBER = /(?:\bPR\s*#?\s*|(?<![\w/#&])#)(\d+)\b/gi;
const GITHUB_URL = /https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(?:pull|issues)\/(\d+)/gi;

// Pull requests and issues a text names, as `owner/repo#number`, whether written that way or as a URL.
/** @param {string} text */
const githubRefs = (text) => [
  ...new Set([
    ...[...text.matchAll(GITHUB_URL)].map((m) => `${m[1]}/${m[2]}#${m[3]}`),
    ...[...text.replace(GITHUB_URL, " ").matchAll(PULL_OR_ISSUE)].map((m) => m[0]),
  ]),
];
/** @param {string} text @param {number} self */
const lineRefs = (text, self) => [
  ...new Set([...text.matchAll(LEDGER_LINE)].map((m) => Number(m[1])).filter((n) => n !== self)),
];

/** Replaces the file in one step, so an interrupted write leaves the earlier contents. @param {string} path @param {string} contents */
function writeAtomic(path, contents) {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, contents);
  renameSync(temporary, path);
}

/**
 * @param {string} outdir
 * @param {{ exclude: string | null, offline: boolean }} options
 */
async function verify(outdir, { exclude, offline }) {
  const snapshot = join(outdir, SNAPSHOT);
  // A failed run must not leave an earlier run's approvals for apply to use.
  rmSync(join(outdir, CANDIDATES), { force: true });
  if (!existsSync(snapshot)) {
    throw new UsageError(`no ${SNAPSHOT} in ${outdir}; run chunk first`);
  }
  // Read once: the hash recorded below must describe exactly the text these checks used.
  const snapshotBytes = readFileSync(snapshot);
  const parsed = parsePlan(snapshotBytes.toString("utf8"));
  const items = new Map(parsed.items.map((item) => [item.line, item]));
  // A closed line without its `evidence:` or `by:` field proves nothing, so it is not completion evidence.
  const unsupported = new Set(
    parsed.errors.map((error) => Number(error.match(/^L(\d+):/)?.[1])).filter(Boolean),
  );
  /** @param {number} n */
  const closedWithProof = (n) => {
    const mark = items.get(n)?.mark;
    return (mark === "x" || mark === "-") && !unsupported.has(n);
  };
  const excluded = exclude ? readExclusions(exclude) : new Set();
  /** @type {Candidate[]} */
  const rows = [];
  for (const { file, row } of readResults(outdir)) {
    const columns = row.split("\t");
    const [reference = "", verdict = "", evidence = "", note = ""] = columns;
    const line = Number(reference.trim().replace(/^L/i, ""));
    const upper = verdict.trim().toUpperCase();
    const item = items.get(line);
    // Three or four columns: an extra tab would move part of the evidence out of the checked text.
    const valid =
      columns.length >= 3 &&
      columns.length <= 4 &&
      VERDICTS.includes(upper) &&
      item !== undefined &&
      (item.mark === " " || item.mark === "~");
    rows.push({
      line,
      verdict: upper,
      evidence: oneLine(evidence),
      note: oneLine(note),
      file,
      checks: columns.length > 4 || columns.length < 3 ? [`${columns.length} columns`] : [],
      lineRefs: [],
      flag: valid ? "pending" : "INVALID",
    });
  }
  // Two rows that disagree about a line are not evidence for either.
  for (const candidate of rows) {
    const same = rows.filter((other) => other.line === candidate.line && other.flag !== "INVALID");
    if (new Set(same.map((other) => other.verdict)).size > 1) {
      candidate.flag = candidate.flag === "INVALID" ? "INVALID" : "CONFLICT";
    }
  }
  const closing = rows.filter(
    (candidate) =>
      candidate.flag === "pending" && ["DONE", "SUPERSEDED"].includes(candidate.verdict),
  );
  // A DONE closure rests on every pull request or issue its row or the line itself names, so one still open
  // holds it back even when the evidence column names only the merged one.
  /** @param {Candidate} c */
  const doneRefs = (c) => githubRefs(`${c.evidence} ${c.note} ${items.get(c.line)?.text ?? ""}`);
  const refs = [
    ...new Set(closing.filter((c) => c.verdict === "DONE").flatMap((c) => doneRefs(c))),
  ];
  const { states, unmerged, skipped } = await githubStates(refs, offline);
  if (skipped) {
    throw Object.assign(new Error(`${skipped}; nothing was verified`), { exitCode: 3 });
  }
  // The evidence of each line a helper called SUPERSEDED, whatever that row's flag turns out to be.
  // The first row for a line decides, as in the loop below.
  const supersededBy = new Map();
  // The evidence of each line a helper called DONE: a closure resting on it rests on what it rests on.
  const doneBy = new Map();
  for (const row of rows) {
    if (row.flag === "pending" && row.verdict === "DONE" && !doneBy.has(row.line)) {
      doneBy.set(row.line, `${row.evidence} ${row.note} ${items.get(row.line)?.text ?? ""}`);
    }
    if (row.flag === "pending" && row.verdict === "SUPERSEDED" && !supersededBy.has(row.line)) {
      supersededBy.set(row.line, row.evidence);
    }
  }
  /**
   * Whether ledger line `n` keeps the scope of a line superseded by it: it is closed, or it stays open, or
   * it is itself superseded by a line that does. A circle of supersessions carries nothing.
   * @param {number} n
   * @param {Set<number>} visited
   * @param {Set<number>} touched every line looked at, which the closure then rests on
   * @returns {boolean}
   */
  const carries = (n, visited, touched) => {
    if (!items.has(n)) {
      return false;
    }
    touched.add(n);
    const mark = items.get(n)?.mark;
    if (mark === "x" || mark === "-") {
      return closedWithProof(n);
    }
    for (const m of lineRefs(doneBy.get(n) ?? "", n)) {
      if (items.has(m)) {
        touched.add(m);
      }
    }
    const evidence = supersededBy.get(n);
    if (evidence === undefined) {
      return true;
    }
    if (visited.has(n)) {
      return false;
    }
    visited.add(n);
    return lineRefs(evidence, n).some((m) => carries(m, visited, touched));
  };
  const seen = new Set();
  for (const candidate of rows) {
    if (candidate.flag !== "pending") {
      continue;
    }
    if (!["DONE", "SUPERSEDED"].includes(candidate.verdict)) {
      candidate.flag = "none";
      continue;
    }
    if (seen.has(candidate.line)) {
      candidate.flag = "DUPLICATE";
      continue;
    }
    seen.add(candidate.line);
    const named = lineRefs(candidate.evidence, candidate.line).filter((n) => items.has(n));
    const lineChecks = named.map((n) => {
      const mark = items.get(n)?.mark;
      return `L${n}:${mark === "x" ? "done" : mark === "-" ? "dropped" : "open"}`;
    });
    /** @type {Set<number>} */
    const touched = new Set(candidate.verdict === "DONE" ? named : []);
    if (candidate.verdict === "SUPERSEDED") {
      candidate.checks = lineChecks;
      candidate.flag = named.some((n) => carries(n, new Set([candidate.line]), touched))
        ? "ok"
        : "NOREF";
    } else {
      const pulls = doneRefs(candidate).map(
        (ref) => /** @type {const} */ ([ref, states.get(ref) ?? "unknown"]),
      );
      candidate.checks = [...pulls.map(([ref, state]) => `${ref}=${state}`), ...lineChecks];
      const text =
        `${candidate.evidence} ${candidate.note} ${items.get(candidate.line)?.text ?? ""}`.replace(
          GITHUB_URL,
          " ",
        );
      // A number with no repository is covered when the same number is named with one.
      const numbered = new Set(pulls.map(([ref]) => ref.split("#")[1]));
      // `tool#2` is covered the same way by `owner/tool#2`.
      const qualified = new Set(pulls.map(([ref]) => ref.split("/")[1]));
      const unchecked = [
        ...[...text.matchAll(BARE_REFERENCE)]
          .map((m) => m[0])
          .filter((ref) => !/^PR#/i.test(ref) && !qualified.has(ref)),
        ...[...text.matchAll(BARE_NUMBER)]
          .filter((m) => !numbered.has(m[1]))
          .map((m) => `#${m[1]}`),
      ];
      // A pull request closed without merging was given up, not finished.
      const settled = pulls.filter(
        ([ref, state]) => state === "merged" || (state === "closed" && !unmerged.has(ref)),
      );
      // Only a line marked done is completion evidence; a dropped line was given up, not finished.
      const closedLines = named.filter((n) => items.get(n)?.mark === "x" && closedWithProof(n));
      // Every ledger line the row or the item itself names must be finished: one that is still open, dropped,
      // marked done without its proof, or (when the row names it) missing leaves part of the scope unfinished or
      // unchecked. The lines the closure rests on are the ones apply checks again.
      const rowRefs = [
        ...new Set([
          ...lineRefs(candidate.evidence, candidate.line),
          ...lineRefs(candidate.note, candidate.line),
        ]),
      ];
      const itemRefs = lineRefs(items.get(candidate.line)?.text ?? "", candidate.line);
      const mentioned = [...new Set([...rowRefs, ...itemRefs])].filter((n) => items.has(n));
      const missing = rowRefs.filter((n) => !items.has(n));
      const unfinishedLines = mentioned.filter((n) => {
        const mark = items.get(n)?.mark;
        // A dropped line was given up, so it does not finish the scope it covered.
        return mark !== "x" || !closedWithProof(n);
      });
      for (const n of mentioned) {
        touched.add(n);
      }
      candidate.checks.push(...missing.map((n) => `L${n}=missing`));
      if (unchecked.length) {
        candidate.checks.push(...[...new Set(unchecked)].map((ref) => `${ref}=no repository`));
      }
      candidate.flag =
        settled.length < pulls.length || unfinishedLines.length || missing.length
          ? "BAD"
          : unchecked.length
            ? "UNCHECKED"
            : settled.length || closedLines.length
              ? "ok"
              : "NOREF";
    }
    candidate.lineRefs = [...touched].map((n) => ({
      line: n,
      mark: items.get(n)?.mark ?? "",
      text: oneLine(items.get(n)?.text ?? ""),
    }));
    if (excluded.has(candidate.line) && candidate.flag === "ok") {
      candidate.flag = "EXCLUDED";
    }
  }
  const snapshotHash = createHash("sha256").update(snapshotBytes).digest("hex");
  writeAtomic(
    join(outdir, CANDIDATES),
    `${JSON.stringify({ snapshot: snapshotHash, candidates: rows }, null, 1)}\n`,
  );
  const verdicts = new Map();
  for (const candidate of rows) {
    verdicts.set(candidate.verdict, (verdicts.get(candidate.verdict) ?? 0) + 1);
  }
  const flags = new Map();
  for (const candidate of rows.filter((c) => c.flag !== "none")) {
    flags.set(candidate.flag, (flags.get(candidate.flag) ?? 0) + 1);
  }
  const out = [
    `rows ${rows.length}: ${[...verdicts].map(([v, n]) => `${v} ${n}`).join(", ")}`,
    `closure candidates: ${[...flags].map(([f, n]) => `${f} ${n}`).join(", ") || "none"}`,
  ];
  for (const candidate of rows) {
    if (!["ok", "none"].includes(candidate.flag)) {
      out.push(
        `${candidate.flag} L${candidate.line} ${candidate.verdict} ${candidate.evidence.slice(0, 140)} [${candidate.checks.join(", ")}]`,
      );
    }
  }
  return out.join("\n");
}

/**
 * @param {string} outdir
 * @param {string} planPath
 * @param {{ dryRun: boolean, time: string | null }} options
 */
function apply(outdir, planPath, { dryRun, time }) {
  const candidatesPath = join(outdir, CANDIDATES);
  if (!existsSync(candidatesPath)) {
    throw new UsageError(`no ${CANDIDATES} in ${outdir}; run verify first`);
  }
  /** @type {{ snapshot: string, candidates: Candidate[] }} */
  const approved = JSON.parse(readFileSync(candidatesPath, "utf8"));
  const candidates = approved.candidates;
  // Read once, so the bytes that are hashed are the bytes that are compared.
  const snapshotBytes = readFileSync(join(outdir, SNAPSHOT));
  if (approved.snapshot !== createHash("sha256").update(snapshotBytes).digest("hex")) {
    throw new UsageError(`refused: ${SNAPSHOT} changed since verify; run verify again`);
  }
  const snapshot = new Map(
    parsePlan(snapshotBytes.toString("utf8")).items.map((item) => [item.line, item]),
  );
  const backup = join(outdir, BACKUP);
  if (!dryRun && !existsSync(backup)) {
    copyFileSync(planPath, backup);
  }
  const counts = { closed: 0, alreadyClosed: 0, skipped: 0, failed: 0 };
  // The exact text of each line a run of apply closed, kept in the work directory so a retry after a partial
  // run still recognizes its own closures. A later closure may rest on such a line and on nothing else.
  const writtenPath = join(outdir, WRITTEN);
  /** @type {Map<number, string>} */
  const wrote = new Map(
    existsSync(writtenPath)
      ? Object.entries(JSON.parse(readFileSync(writtenPath, "utf8"))).map(([line, text]) => [
          Number(line),
          String(text),
        ])
      : [],
  );
  /** @type {string[]} */
  const notes = [];
  for (const candidate of candidates.filter((c) => c.flag === "ok")) {
    const liveItems = parsePlan(readFileSync(planPath, "utf8")).items;
    const live = liveItems.find((item) => item.line === candidate.line);
    if (!live) {
      counts.skipped++;
      notes.push(`skipped L${candidate.line}: the line is gone from the plan`);
      continue;
    }
    if (live.mark === "x" || live.mark === "-") {
      counts.alreadyClosed++;
      continue;
    }
    if (oneLine(live.text) !== oneLine(snapshot.get(candidate.line)?.text ?? "")) {
      counts.skipped++;
      notes.push(`skipped L${candidate.line}: the line changed since the snapshot`);
      continue;
    }
    // The ledger lines the evidence rests on must still be as they were when verified.
    const moved = candidate.lineRefs.find((ref) => {
      const now = liveItems.find((item) => item.line === ref.line);
      return (
        now === undefined ||
        // A line reads as verified, or as this run left it after closing it.
        (oneLine(now.text) !== ref.text && oneLine(now.text) !== wrote.get(ref.line)) ||
        (now.mark !== ref.mark && oneLine(now.text) !== wrote.get(ref.line))
      );
    });
    if (moved) {
      counts.skipped++;
      notes.push(`skipped L${candidate.line}: L${moved.line} is no longer as verified`);
      continue;
    }
    const checked = candidate.checks.length ? ` [checked: ${candidate.checks.join("; ")}]` : "";
    const evidence = `${candidate.evidence}${checked}`;
    if (dryRun) {
      counts.closed++;
      notes.push(
        `would close L${candidate.line} as ${candidate.verdict}: ${evidence.slice(0, 120)}`,
      );
      continue;
    }
    const closeArguments =
      candidate.verdict === "SUPERSEDED"
        ? ["--drop", "--by", `consolidation, superseded: ${evidence}`]
        : ["--evidence", evidence];
    const result = spawnSync(
      process.execPath,
      [
        closeScript,
        planPath,
        "--line",
        String(candidate.line),
        ...closeArguments,
        "--expect",
        oneLine(snapshot.get(candidate.line)?.text ?? ""),
        ...(time ? ["--time", time] : []),
      ],
      { encoding: "utf8" },
    );
    if (result.status === 0) {
      counts.closed++;
      const closed = parsePlan(readFileSync(planPath, "utf8")).items.find(
        (item) => item.line === candidate.line,
      );
      wrote.set(candidate.line, oneLine(closed?.text ?? ""));
      writeAtomic(writtenPath, `${JSON.stringify(Object.fromEntries(wrote), null, 1)}\n`);
    } else {
      counts.failed++;
      notes.push(`failed L${candidate.line}: ${oneLine(result.error?.message ?? result.stderr)}`);
    }
  }
  const summary = `${dryRun ? "would close" : "closed"} ${counts.closed}, already closed ${counts.alreadyClosed}, skipped ${counts.skipped}, failed ${counts.failed}`;
  if (counts.failed) {
    throw new Error([...notes, summary].join("\n"));
  }
  return [...notes, summary].join("\n");
}

/** @param {string[]} argv */
async function main(argv) {
  const [command, ...rest] = argv;
  if (command === "chunk") {
    const { positional, options } = parseArguments(rest, ["--force"], ["--lines", "--bytes"]);
    const [plan, outdir] = positional;
    if (!plan || !outdir || positional.length > 2) {
      throw new UsageError(USAGE);
    }
    /** @param {string} name @param {number} fallback */
    const limit = (name, fallback) => {
      const value = options.get(name);
      if (value === undefined) {
        return fallback;
      }
      if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
        throw new UsageError(`${name} needs a positive number\n${USAGE}`);
      }
      return Number(value);
    };
    return chunk(plan, outdir, {
      lines: limit("--lines", 60),
      bytes: limit("--bytes", 70_000),
      force: options.has("--force"),
    });
  }
  if (command === "verify") {
    const { positional, options } = parseArguments(rest, ["--offline"], ["--exclude"]);
    const [outdir] = positional;
    if (!outdir || positional.length > 1) {
      throw new UsageError(USAGE);
    }
    const exclude = options.get("--exclude");
    return verify(outdir, {
      exclude: typeof exclude === "string" ? exclude : null,
      offline: options.has("--offline"),
    });
  }
  if (command === "apply") {
    const { positional, options } = parseArguments(rest, ["--dry-run"], ["--time"]);
    const [outdir, plan] = positional;
    if (!outdir || !plan || positional.length > 2) {
      throw new UsageError(USAGE);
    }
    const time = options.get("--time");
    return apply(outdir, plan, {
      dryRun: options.has("--dry-run"),
      time: typeof time === "string" ? time : null,
    });
  }
  throw new UsageError(USAGE);
}

try {
  console.log(await main(process.argv.slice(2)));
} catch (error) {
  console.error(/** @type {Error} */ (error).message);
  process.exit(/** @type {{ exitCode?: number }} */ (error).exitCode ?? 1);
}
