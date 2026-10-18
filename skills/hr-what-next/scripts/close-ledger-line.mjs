#!/usr/bin/env node
// Closes one open or deferred ledger line of a session plan in place, so a result is recorded on the line
// that promised it instead of on a new line that leaves the old one open. See ../SKILL.md.
// `--evidence <text>` marks the line done (`- [x]`) and appends ` … evidence: <text> (closed <time>)`;
// `--drop --by <who>` marks it dropped (`- [-]`) and appends ` … by: <who> (dropped <time>)`.
// The line is chosen by `--line <n>` (its number in the file) or `--match <text>` (a piece of text exactly
// one open or deferred ledger line contains). A wrapped item gets the note on its last line.
// Running the same command again changes nothing: a line already closed with that evidence, or dropped by
// that person, is reported as already done. Exit 0: closed or already done; 1: invalid input or refused.
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parsePlan } from "./check-open-work.mjs";

const usage =
  "usage: close-ledger-line.mjs <plan.md> (--line <n> | --match <text>) (--evidence <text> | --drop --by <who>) [--time <text>]";

function parseArguments(argv) {
  const options = { plan: null, line: null, match: null, evidence: null, drop: false, by: null };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--drop") options.drop = true;
    else if (["--line", "--match", "--evidence", "--by", "--time"].includes(argument)) {
      const value = argv[++index];
      if (value === undefined) throw new Error(`${argument} needs a value\n${usage}`);
      options[argument.slice(2)] = value.trim();
    } else if (argument.startsWith("--") || options.plan) throw new Error(usage);
    else options.plan = argument;
  }
  if (!options.plan) throw new Error(usage);
  if ((options.line === null) === (options.match === null))
    throw new Error(`give exactly one of --line and --match\n${usage}`);
  if (options.line !== null && !/^[1-9]\d*$/.test(options.line))
    throw new Error(`--line needs a line number\n${usage}`);
  if (options.match === "") throw new Error(`--match needs text\n${usage}`);
  if (options.drop) {
    if (options.evidence !== null)
      throw new Error(`a dropped line takes --by, not --evidence\n${usage}`);
    if (!options.by)
      throw new Error(`refused: dropping a line needs --by <who dropped it>\n${usage}`);
  } else {
    if (options.by !== null) throw new Error(`--by goes with --drop\n${usage}`);
    if (!options.evidence)
      throw new Error(`refused: closing a line needs --evidence <what shows it is done>\n${usage}`);
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

function close(options) {
  const text = readFileSync(options.plan, "utf8");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const { items } = parsePlan(text);
  const [mark, label, note] = options.drop
    ? ["-", "by", options.by]
    : ["x", "evidence", options.evidence];
  const closedHere = (item) => item.mark === mark && item.text.includes(`${label}: ${note}`);
  let item;
  if (options.line !== null) {
    item = items.find((candidate) => candidate.line === Number(options.line));
    if (!item) throw new Error(`L${options.line} is not a ledger item`);
  } else {
    const open = items.filter(
      (candidate) =>
        (candidate.mark === " " || candidate.mark === "~") &&
        candidate.text.includes(options.match),
    );
    if (open.length > 1)
      throw new Error(
        `${open.length} open or deferred ledger lines match: ${open.map((candidate) => `L${candidate.line}`).join(", ")}; use --line`,
      );
    item =
      open[0] ??
      items.find((candidate) => candidate.text.includes(options.match) && closedHere(candidate));
    if (!item) throw new Error(`no open or deferred ledger line contains "${options.match}"`);
  }
  if (closedHere(item)) return `L${item.line} is already done: nothing changed`;
  if (item.mark !== " " && item.mark !== "~")
    throw new Error(
      `L${item.line} is already done (marked [${item.mark}]) with a different note; edit it by hand`,
    );
  // The item's last physical line: the indented continuation lines parsePlan joined onto it.
  let last = item.line - 1;
  while (
    last + 1 < lines.length &&
    /^\s{2,}\S/.test(lines[last + 1]) &&
    !/^\s*[-*]\s/.test(lines[last + 1])
  )
    last++;
  lines[item.line - 1] = lines[item.line - 1].replace(/\[[ ~]\]/, `[${mark}]`);
  const stamp = `${options.drop ? "dropped" : "closed"} ${options.time ?? localTime()}`;
  lines[last] = `${lines[last].trimEnd()} … ${label}: ${note} (${stamp})`;
  // Write beside the plan and rename, so an interrupted run leaves the old plan whole.
  const temporary = join(dirname(options.plan), `.${basename(options.plan)}.${process.pid}.tmp`);
  writeFileSync(temporary, lines.join(eol));
  renameSync(temporary, options.plan);
  return `L${item.line} marked ${options.drop ? "dropped" : "done"}`;
}

try {
  console.log(close(parseArguments(process.argv.slice(2))));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
