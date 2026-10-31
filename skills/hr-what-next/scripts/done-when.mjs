#!/usr/bin/env bun
// Evaluates the `done-when:` clause an open or deferred ledger item may end with, and closes the items whose
// clause holds. See ../SKILL.md.
//   bun done-when.mjs <plan.md> [--apply]
// A clause is `done-when: <condition>[; <condition>]`, each condition one of `pr-merged owner/repo#n`,
// `issue-closed owner/repo#n` or `path-absent <absolute or ~/ path>`, and every condition must hold.
// Each line prints as `L<n> closeable|pending|error: <evidence>`. Without --apply nothing is written. With
// --apply a closeable line is closed in place through close-ledger-line.mjs, with the evidence found and only
// while the line still reads as it did when it was evaluated. A lookup that fails, a reference GitHub does not
// know, a pull request named as an issue (or the reverse) and a path that cannot be read are errors: an error
// is never closeable. A path is absent only when the system says it does not exist (ENOENT or ENOTDIR).
// Exit 0: nothing failed; 1: an error row, a refused close or invalid input.
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { githubStates } from "./github-state.mjs";
import { parsePlan } from "./plan-ledger.mjs";

/** @typedef {import("./plan-ledger.mjs").LedgerItem} LedgerItem */
/** @typedef {import("./plan-ledger.mjs").DoneCondition} DoneCondition */
/** @typedef {{ line: number, text: string, status: "closeable" | "pending" | "error", evidence: string }} Row */

const usage = "usage: done-when.mjs <plan.md> [--apply]";

/**
 * True when something is at the path. Only ENOENT and ENOTDIR mean absent; any other error is thrown.
 * @param {string} path
 */
export function pathExists(path) {
  try {
    lstatSync(path.replace(/^~(?=\/|$)/, homedir()));
    return true;
  } catch (error) {
    const code = /** @type {NodeJS.ErrnoException} */ (error).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return false;
    }
    throw error;
  }
}

/** @param {DoneCondition} condition */
const label = (condition) =>
  condition.kind === "path-absent"
    ? `path-absent ${condition.path}`
    : `${condition.kind} ${condition.repo}#${condition.number}`;

/**
 * Evaluates the clause of each open or deferred item that has one.
 * @param {LedgerItem[]} items
 * @param {{ offline?: boolean, exists?: (path: string) => boolean }} [options]
 * @returns {Promise<Row[]>}
 */
export async function evaluateDoneWhen(items, { offline = false, exists = pathExists } = {}) {
  const pending = items.filter(
    (item) => (item.mark === " " || item.mark === "~") && item.doneWhen !== undefined,
  );
  const refs = new Set();
  for (const { doneWhen } of pending) {
    for (const condition of doneWhen && "conditions" in doneWhen ? doneWhen.conditions : []) {
      if (condition.kind !== "path-absent") {
        refs.add(`${condition.repo}#${condition.number}`);
      }
    }
  }
  const github = await githubStates([...refs], offline);
  /** @type {Row[]} */
  const rows = [];
  for (const item of pending) {
    const doneWhen = item.doneWhen;
    const text = item.text.replace(/\s+/g, " ").trim();
    if (!doneWhen || "error" in doneWhen) {
      rows.push({ line: item.line, text, status: "error", evidence: doneWhen?.error ?? "" });
      continue;
    }
    /** @type {{ ok: boolean | null, text: string }[]} */
    const results = doneWhen.conditions.map((condition) => {
      const name = label(condition);
      if (condition.kind === "path-absent") {
        try {
          return exists(condition.path)
            ? { ok: false, text: `${name}: still exists` }
            : { ok: true, text: `${name}: absent` };
        } catch (error) {
          return { ok: null, text: `${name}: ${/** @type {Error} */ (error).message}` };
        }
      }
      if (github.skipped) {
        return { ok: null, text: github.skipped };
      }
      const ref = `${condition.repo}#${condition.number}`;
      const state = github.states.get(ref) ?? "unknown";
      const finished = github.when.get(ref);
      const pull = github.pulls.has(ref);
      if (state === "unknown") {
        return { ok: null, text: `${name}: not found` };
      }
      if (condition.kind === "pr-merged") {
        if (!pull) {
          return { ok: null, text: `${name}: is an issue, not a pull request` };
        }
        if (state === "merged") {
          return { ok: true, text: `${name}: merged${finished ? ` ${finished}` : ""}` };
        }
        return {
          ok: false,
          text: `${name}: ${state === "closed" ? "closed without merging" : "still open"}`,
        };
      }
      if (pull) {
        return { ok: null, text: `${name}: is a pull request, not an issue` };
      }
      return state === "closed"
        ? { ok: true, text: `${name}: closed${finished ? ` ${finished}` : ""}` }
        : { ok: false, text: `${name}: still open` };
    });
    const status = results.some((result) => result.ok === null)
      ? "error"
      : results.every((result) => result.ok)
        ? "closeable"
        : "pending";
    rows.push({
      line: item.line,
      text,
      status,
      evidence: results.map((result) => result.text).join("; "),
    });
  }
  return rows;
}

/** @param {string[]} argv */
function parseArguments(argv) {
  let plan = "";
  let apply = false;
  for (const argument of argv) {
    if (argument === "--apply") {
      apply = true;
    } else if (argument.startsWith("--") || plan) {
      throw new Error(usage);
    } else {
      plan = argument;
    }
  }
  if (!plan) {
    throw new Error(usage);
  }
  return { plan, apply };
}

async function main() {
  let options;
  let rows;
  try {
    options = parseArguments(process.argv.slice(2));
    rows = await evaluateDoneWhen(parsePlan(readFileSync(options.plan, "utf8")).items);
  } catch (error) {
    console.error(/** @type {Error} */ (error).message);
    process.exit(1);
  }
  let failed = false;
  const closer = join(import.meta.dirname, "close-ledger-line.mjs");
  for (const row of rows) {
    console.log(`L${row.line} ${row.status}: ${row.evidence}`);
    failed ||= row.status === "error";
    if (options.apply && row.status === "closeable") {
      const run = spawnSync(
        process.execPath,
        [
          closer,
          options.plan,
          "--line",
          String(row.line),
          "--expect",
          row.text,
          "--evidence",
          `done-when held: ${row.evidence}`,
        ],
        { encoding: "utf8" },
      );
      console.log((run.stdout.trim() || run.stderr.trim()).replace(/^/gm, "  "));
      failed ||= run.status !== 0;
    }
  }
  process.exit(failed ? 1 : 0);
}

if (
  process.argv[1] &&
  existsSync(process.argv[1]) &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  await main();
}
