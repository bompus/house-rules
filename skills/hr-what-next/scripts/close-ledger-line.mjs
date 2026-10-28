#!/usr/bin/env bun
// Closes one open or deferred ledger line of a session plan in place, so a result is recorded on the line
// that promised it instead of on a new line that leaves the old one open. See ../SKILL.md.
// `--evidence <text>` marks the line done (`- [x]`) and appends ` … evidence: <text> (closed <time>)`;
// `--drop --by <who>` marks it dropped (`- [-]`) and appends ` … by: <who> (dropped <time>)`. A drop by the
// user also needs `--asked <where>` (the offer ID or message where they answered about this item), recorded
// as `by: user, asked in <where>`: a bulk close-out is not an answer about each item.
// The line is chosen by `--line <n>` (its number in the file) or `--match <text>` (a piece of text exactly
// one open or deferred ledger line contains). A wrapped item gets the note on its last line.
// `--expect <text>` refuses unless the line still reads exactly that (whitespace collapsed), for a caller that
// chose the line from an earlier reading.
// Running the same command again changes nothing: a line already closed with that evidence, or dropped by
// that person, is reported as already done. Exit 0: closed or already done; 1: invalid input or refused.
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parsePlan } from "./plan-ledger.mjs";

/** @typedef {import("./plan-ledger.mjs").LedgerItem} LedgerItem */
/** @typedef {ReturnType<typeof parseArguments>} Options */

const usage =
  "usage: close-ledger-line.mjs <plan.md> (--line <n> | --match <text>) (--evidence <text> | --drop --by <who> [--asked <offer ID or message>]) [--time <text>] [--expect <text>]";

/** @param {string[]} argv */
function parseArguments(argv) {
  const options = {
    plan: /** @type {string | null} */ (null),
    line: /** @type {string | null} */ (null),
    match: /** @type {string | null} */ (null),
    evidence: /** @type {string | null} */ (null),
    drop: false,
    by: /** @type {string | null} */ (null),
    asked: /** @type {string | null} */ (null),
    time: /** @type {string | null} */ (null),
    expect: /** @type {string | null} */ (null),
  };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index] ?? "";
    if (argument === "--drop") {
      options.drop = true;
    } else if (
      ["--line", "--match", "--evidence", "--by", "--asked", "--time", "--expect"].includes(
        argument,
      )
    ) {
      const value = argv[++index];
      if (value === undefined || (argument === "--asked" && value.startsWith("--"))) {
        throw new Error(`${argument} needs a value\n${usage}`);
      }
      // A line break would end the ledger item early and leave the rest of the note outside it.
      if (/[\r\n]/.test(value)) {
        throw new Error(`${argument} must be one line\n${usage}`);
      }
      const key =
        /** @type {"line" | "match" | "evidence" | "by" | "asked" | "time" | "expect"} */ (
          argument.slice(2)
        );
      options[key] = value.trim();
    } else if (argument.startsWith("--") || options.plan) {
      throw new Error(usage);
    } else {
      options.plan = argument;
    }
  }
  if (!options.plan) {
    throw new Error(usage);
  }
  if ((options.line === null) === (options.match === null)) {
    throw new Error(`give exactly one of --line and --match\n${usage}`);
  }
  if (options.line !== null && !/^[1-9]\d*$/.test(options.line)) {
    throw new Error(`--line needs a line number\n${usage}`);
  }
  if (options.match === "") {
    throw new Error(`--match needs text\n${usage}`);
  }
  if (options.drop) {
    if (options.evidence !== null) {
      throw new Error(`a dropped line takes --by, not --evidence\n${usage}`);
    }
    if (!options.by) {
      throw new Error(`refused: dropping a line needs --by <who dropped it>\n${usage}`);
    }
    const byUser = /^user\b/i.test(options.by);
    if (byUser && !options.asked) {
      throw new Error(
        `refused: a drop by the user needs --asked <offer ID or message where they answered about this item>; a bulk close-out or an unpicked option elsewhere is not an answer\n${usage}`,
      );
    }
    if (options.asked && !byUser) {
      throw new Error(`--asked goes with a drop by the user\n${usage}`);
    }
  } else {
    if (options.by !== null || options.asked !== null) {
      throw new Error(`--by and --asked go with --drop\n${usage}`);
    }
    if (!options.evidence) {
      throw new Error(`refused: closing a line needs --evidence <what shows it is done>\n${usage}`);
    }
  }
  return options;
}

// Local wall-clock time with its UTC offset, such as "2026-10-18 17:05 -06:00".
function localTime(date = new Date()) {
  const offset = -date.getTimezoneOffset();
  const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0");
  const minutes = String(Math.abs(offset) % 60).padStart(2, "0");
  return `${date.toLocaleString("sv").slice(0, 16)} ${offset < 0 ? "-" : "+"}${hours}:${minutes}`;
}

/** @param {Options} options */
function close(options) {
  const plan = /** @type {string} */ (options.plan);
  const text = readFileSync(plan, "utf8");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const { items } = parsePlan(text);
  const [mark, label, note] = /** @type {[string, string, string]} */ (
    options.drop
      ? ["-", "by", options.asked ? `${options.by}, asked in ${options.asked}` : options.by]
      : ["x", "evidence", options.evidence]
  );
  // The whole recorded note, up to the stamp this script writes, so "Bob" does not match "by: Bobby".
  const escaped = note.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const recorded = new RegExp(`… ${label}: ${escaped} \\((?:closed|dropped) [^()]*\\)$`);
  /** @param {LedgerItem} item */
  const closedHere = (item) => item.mark === mark && recorded.test(item.text);
  /** @type {LedgerItem | undefined} */
  let item;
  if (options.line !== null) {
    item = items.find((candidate) => candidate.line === Number(options.line));
    if (!item) {
      throw new Error(`L${options.line} is not a ledger item`);
    }
  } else {
    const match = /** @type {string} */ (options.match);
    const open = items.filter(
      (candidate) =>
        (candidate.mark === " " || candidate.mark === "~") && candidate.text.includes(match),
    );
    if (open.length > 1) {
      throw new Error(
        `${open.length} open or deferred ledger lines match: ${open.map((candidate) => `L${candidate.line}`).join(", ")}; use --line`,
      );
    }
    item =
      open[0] ?? items.find((candidate) => candidate.text.includes(match) && closedHere(candidate));
    if (!item) {
      throw new Error(`no open or deferred ledger line contains "${options.match}"`);
    }
  }
  if (closedHere(item)) {
    return `L${item.line} is already done: nothing changed`;
  }
  if (item.mark !== " " && item.mark !== "~") {
    throw new Error(
      `L${item.line} is already done (marked [${item.mark}]) with a different note; edit it by hand`,
    );
  }
  // The caller decided on this line's text; a line rewritten since is a different item.
  if (options.expect !== null && item.text.replace(/\s+/g, " ").trim() !== options.expect) {
    throw new Error(`refused: L${item.line} no longer reads as expected; nothing changed`);
  }
  // The item's last physical line: the indented continuation lines parsePlan joined onto it.
  let last = item.line - 1;
  while (
    last + 1 < lines.length &&
    /^\s{2,}\S/.test(lines[last + 1] ?? "") &&
    !/^\s*[-*]\s/.test(lines[last + 1] ?? "")
  ) {
    last++;
  }
  lines[item.line - 1] = (lines[item.line - 1] ?? "").replace(/\[[ ~]\]/, `[${mark}]`);
  const stamp = `${options.drop ? "dropped" : "closed"} ${options.time ?? localTime()}`;
  lines[last] = `${(lines[last] ?? "").trimEnd()} … ${label}: ${note} (${stamp})`;
  // Write beside the plan and rename, so an interrupted run leaves the old plan whole.
  const temporary = join(dirname(plan), `.${basename(plan)}.${process.pid}.tmp`);
  writeFileSync(temporary, lines.join(eol));
  renameSync(temporary, plan);
  return `L${item.line} marked ${options.drop ? "dropped" : "done"}`;
}

try {
  console.log(close(parseArguments(process.argv.slice(2))));
} catch (error) {
  console.error(/** @type {Error} */ (error).message);
  process.exit(1);
}
