#!/usr/bin/env node
// Open-work check for a session plan: lists what is still open before anyone says
// "nothing remains" or archives the plan. See ../SKILL.md and the plan-files rule.
// Exit 0: nothing open; 1: invalid input; 2: open work remains or archiving refused.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";

const usage =
  "usage: check-open-work.mjs <plan.md> [--checkout <path>]... [--scratch <dir>] [--archive] [--json]";
const TERMINAL_STATUS = /^(completed?|done|archived)\b/i;
const MARKS = { " ": "open", "~": "deferred", x: "done", "-": "dropped" };
const REQUIRED = {
  "~": ["trigger", "a trigger"],
  x: ["evidence", "evidence"],
  "-": ["by", "who dropped it"],
};
const NARRATIVE =
  /^\s*(?:[-*]\s+|#+\s+)?\**(pending|waiting|deferred|blocked-on-user|blocked-by|todo)\b/i;

function parseArguments(argv) {
  const options = { plan: null, checkouts: [], scratch: null, archive: false, json: false };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--archive") options.archive = true;
    else if (argument === "--json") options.json = true;
    else if (argument === "--checkout" || argument === "--scratch") {
      const value = argv[++index];
      if (!value) throw new Error(`${argument} needs a value\n${usage}`);
      if (argument === "--checkout") options.checkouts.push(value);
      else options.scratch = value;
    } else if (argument.startsWith("--") || options.plan) throw new Error(usage);
    else options.plan = argument;
  }
  if (!options.plan) throw new Error(usage);
  return options;
}

const clip = (text, length = 90) => (text.length > length ? `${text.slice(0, length - 1)}…` : text);

function readPlan(path) {
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  const header = lines.slice(0, 40);
  const field = (name) =>
    header
      .map((line) => line.match(new RegExp(`^\\s*(?:\\*\\*)?${name}:?(?:\\*\\*)?:?\\s*(.+)$`, "i")))
      .find(Boolean)?.[1]
      .trim();
  const errors = [];
  const status = field("Status");
  const owner = field("Owner");
  if (!status) errors.push("no `Status:` line in the first 40 lines");
  if (!owner) errors.push("no `Owner:` line in the first 40 lines");
  const start = lines.findIndex((line) => /^#{1,6}\s+Ledger\s*$/i.test(line));
  if (start < 0) errors.push("no `## Ledger` section");
  let end = lines.length;
  if (start >= 0) {
    const level = lines[start].match(/^#+/)[0].length;
    const next = lines.findIndex(
      (line, i) => i > start && new RegExp(`^#{1,${level}}\\s`).test(line),
    );
    if (next >= 0) end = next;
  }
  const items = [];
  for (let i = start + 1; start >= 0 && i < end; i++) {
    const match = lines[i].match(/^\s*[-*]\s+\[([ x~-])\]\s+(.*)$/i);
    if (match) {
      items.push({ line: i + 1, mark: match[1].toLowerCase(), text: match[2] });
    } else if (items.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*[-*]\s/.test(lines[i])) {
      items[items.length - 1].text += ` ${lines[i].trim()}`;
    }
  }
  if (start >= 0 && !items.length)
    errors.push("the ledger has no items (`- [ ] ...`, `- [~] ...`, `- [x] ...`, `- [-] ...`)");
  for (const item of items) {
    const required = REQUIRED[item.mark];
    if (required && !new RegExp(`\\b${required[0]}:\\s*\\S`, "i").test(item.text))
      errors.push(
        `L${item.line}: a ${MARKS[item.mark]} item needs \`${required[0]}:\` (${required[1]})`,
      );
  }
  const narrative = [];
  lines.forEach((line, i) => {
    const inLedger = start >= 0 && i > start && i < end;
    if (!inLedger && i > 0 && (NARRATIVE.test(line) || /^\s*[-*]\s+\[ \]/.test(line)))
      narrative.push({ line: i + 1, text: line.trim() });
  });
  return { status, owner, items, errors, narrative };
}

function notesRoot(planPath) {
  const parts = resolve(planPath).split(sep);
  const at = parts.lastIndexOf("plans");
  return at > 0
    ? { notes: parts.slice(0, at).join(sep) || sep, plans: parts.slice(0, at + 1).join(sep), parts }
    : null;
}

// An owner line can name several identities ("Alice, session 7"); a manifest is the plan's only when
// its whole owner equals one of them, so a manifest owned by "session" is not claimed.
function ownedScratch(directory, owner) {
  if (!existsSync(directory)) return [];
  const identities = [owner, ...owner.split(/[,;]/)].map((part) => part.trim().toLowerCase());
  return readdirSync(directory)
    .filter((name) => existsSync(join(directory, name, "manifest.json")))
    .filter((name) => {
      try {
        const manifest = JSON.parse(readFileSync(join(directory, name, "manifest.json"), "utf8"));
        return (
          typeof manifest.owner === "string" &&
          identities.includes(manifest.owner.trim().toLowerCase())
        );
      } catch {
        return false;
      }
    });
}

function git(path, ...args) {
  const run = spawnSync("git", ["-C", path, ...args], { encoding: "utf8" });
  return run.status === 0 ? run.stdout : null;
}

function checkoutState(path) {
  const status = git(path, "status", "--porcelain=v1", "--branch");
  if (status === null) return { error: `cannot read git state of ${path}` };
  const [branchLine, ...changes] = status.split("\n").filter(Boolean);
  const unpushed = (git(path, "log", "--oneline", "HEAD", "--not", "--remotes") ?? "")
    .split("\n")
    .filter(Boolean);
  const branch = branchLine.replace(/^## /, "").split(/\.\.\.| /)[0];
  return { branch, dirty: changes.length, unpushed: unpushed.length };
}

function accountFor(resource, names, items, findings) {
  const naming = items.filter((item) => names.some((name) => item.text.includes(name)));
  if (!naming.length) findings.push(`${resource} is not named in any ledger item`);
  else if (!naming.some((item) => item.mark === " " || item.mark === "~"))
    findings.push(
      `${resource} still exists but its ledger item is ${MARKS[naming[0].mark]} (L${naming[0].line})`,
    );
}

function run(options) {
  const planPath = resolve(options.plan);
  if (!existsSync(planPath) || !statSync(planPath).isFile())
    throw new Error(`cannot read ${options.plan}`);
  const plan = readPlan(planPath);
  const report = {
    plan: planPath,
    status: plan.status ?? null,
    owner: plan.owner ?? null,
    open: [],
    findings: [],
    warnings: [],
    errors: [...plan.errors],
  };
  if (report.errors.length) return report;
  const open = plan.items.filter((item) => item.mark === " " || item.mark === "~");
  report.open = open.map((item) => `L${item.line} [${item.mark}] ${clip(item.text)}`);
  if (TERMINAL_STATUS.test(plan.status) && open.length)
    report.findings.push(
      `Status says "${plan.status}" but ${open.length} ledger item(s) are open or deferred`,
    );
  const roots = notesRoot(planPath);
  const scratch = options.scratch ?? (roots ? join(roots.notes, "tmp") : null);
  if (scratch)
    for (const name of ownedScratch(scratch, plan.owner))
      accountFor(`scratch ${name}`, [name], plan.items, report.findings);
  for (const path of options.checkouts) {
    const state = checkoutState(path);
    if (state.error) report.errors.push(state.error);
    else if (state.dirty || state.unpushed)
      accountFor(
        `checkout ${path} (${state.dirty} changed file(s), ${state.unpushed} unpushed commit(s))`,
        [path, state.branch],
        plan.items,
        report.findings,
      );
  }
  for (const entry of plan.narrative.slice(0, 5))
    report.warnings.push(`L${entry.line} outside the ledger: ${clip(entry.text, 70)}`);
  if (plan.narrative.length > 5)
    report.warnings.push(`${plan.narrative.length - 5} more narrative marker line(s)`);
  if (options.archive && !report.errors.length) {
    if (!TERMINAL_STATUS.test(plan.status))
      report.findings.push(`archiving refused: Status is "${plan.status}", not completed`);
    else if (roots?.parts.at(-3) !== "plans")
      report.errors.push("the plan is not at plans/<topic>/plan.md (already archived?)");
    else if (open.length === 0 && !report.findings.length) {
      const target = join(
        roots.plans,
        "archive",
        `${basename(dirname(planPath))}-${new Date().toLocaleDateString("sv")}`,
      );
      if (existsSync(target)) report.errors.push(`${target} already exists`);
      else {
        mkdirSync(dirname(target), { recursive: true });
        renameSync(dirname(planPath), target);
        report.archived = target;
      }
    }
  }
  return report;
}

function main() {
  let options;
  let report;
  try {
    options = parseArguments(process.argv.slice(2));
    report = run(options);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  const code = report.errors.length ? 1 : report.findings.length || report.open.length ? 2 : 0;
  if (options.json) console.log(JSON.stringify({ exit: code, ...report }, null, 2));
  else {
    console.log(
      `plan: ${report.plan}\nstatus: ${report.status ?? "?"} | owner: ${report.owner ?? "?"}`,
    );
    for (const [label, rows] of [
      ["error", report.errors],
      ["open", report.open],
      ["finding", report.findings],
      ["warning", report.warnings],
    ])
      for (const row of rows) console.log(`${label}: ${row}`);
    if (report.archived) console.log(`archived: ${report.archived}`);
    console.log(
      code === 0
        ? "result: nothing open"
        : code === 1
          ? "result: invalid input"
          : `result: ${report.open.length} open item(s), ${report.findings.length} finding(s)`,
    );
  }
  process.exit(code);
}

main();
