// Reads a session plan's header fields and its `## Ledger` items. check-open-work.mjs reports on them,
// close-ledger-line.mjs edits them and the continuity checks compare snapshots of them.
import { createHash } from "node:crypto";

/** @typedef {" " | "~" | "x" | "-"} Mark */
/** @typedef {{ kind: "pr-merged" | "issue-closed", repo: string, number: number } | { kind: "path-absent", path: string }} DoneCondition */
/** @typedef {{ conditions: DoneCondition[] } | { error: string }} DoneWhen */
/** @typedef {{ line: number, mark: Mark, text: string, doneWhen?: DoneWhen }} LedgerItem */
/** @typedef {{ line: number, text: string, box: boolean }} NarrativeLine */
/**
 * @typedef {object} Plan
 * @property {string | undefined} status
 * @property {string | undefined} owner
 * @property {string | undefined} purpose
 * @property {string | undefined} project
 * @property {LedgerItem[]} items
 * @property {string[]} errors
 * @property {NarrativeLine[]} narrative
 */

/** @type {Record<Mark, string>} */
export const MARKS = { " ": "open", "~": "deferred", x: "done", "-": "dropped" };
/** @type {Partial<Record<Mark, [field: string, meaning: string]>>} */
const REQUIRED = {
  "~": ["trigger", "a trigger"],
  x: ["evidence", "evidence"],
  "-": ["by", "who dropped it"],
};
const NARRATIVE =
  /^\s*(?:[-*]\s+|#+\s+)?\**(pending|waiting|deferred|blocked-on-user|blocked-by|todo|follow-?ups?)\b/i;
// A labelled follow-up inside a prose sentence ("Merged. Deferred: the listing", "Still open for later: x").
const PROSE_MARKER =
  /(?:^|[.;!?]\s+|\*\*)\s*(?:follow-?ups?|deferred|todo|(?:still )?open for later)\**\s*:/i;
export const RECHECK = /\brecheck:\s*(\d{4}-\d{2}-\d{2})/i;
// `done-when: <condition>[; <condition>]` ends an open or deferred item. Text in backticks is prose about the
// convention, not a clause.
const DONE_WHEN = /(?:^|\s)done-when:\s*(.*)$/i;
const GITHUB_REF = /^([\w.-]+\/[\w.-]+)#(\d+)$/;

/**
 * Blanks Markdown code spans to spaces of the same length. A span opens with a run of backticks and closes
 * at the next run of exactly the same length; a run with no closing run is literal text and is skipped whole.
 * @param {string} text
 */
function maskCodeSpans(text) {
  let out = "";
  let at = 0;
  while (at < text.length) {
    // A backslash outside a span makes the next backtick literal, so it cannot open a span; an escaped
    // backslash is consumed with its pair so it does not escape what follows.
    if (text[at] === "\\" && (text[at + 1] === "`" || text[at + 1] === "\\")) {
      out += text.slice(at, at + 2);
      at += 2;
      continue;
    }
    if (text[at] !== "`") {
      out += text[at];
      at++;
      continue;
    }
    let end = at;
    while (text[end] === "`") {
      end++;
    }
    const run = end - at;
    let close = -1;
    for (let next = end; next < text.length;) {
      if (text[next] !== "`") {
        next++;
        continue;
      }
      let stop = next;
      while (text[stop] === "`") {
        stop++;
      }
      if (stop - next === run) {
        close = stop;
        break;
      }
      next = stop;
    }
    if (close < 0) {
      out += text.slice(at, end);
      at = end;
    } else {
      out += " ".repeat(close - at);
      at = close;
    }
  }
  return out;
}

/**
 * Reads an item's `done-when:` clause: `pr-merged owner/repo#n`, `issue-closed owner/repo#n` and
 * `path-absent <absolute or ~/ path>`, all of which must hold. A clause that cannot be read is an error.
 * @param {string} text
 * @returns {DoneWhen | undefined}
 */
export function parseDoneWhen(text) {
  // Code spans are blanked, to the same length, only to find the marker; the clause itself is read from the
  // original text, so backticks inside a path stay part of the path.
  const masked = maskCodeSpans(text);
  const match = DONE_WHEN.exec(masked);
  if (!match) {
    return undefined;
  }
  const clause = text.slice(match.index + match[0].length - (match[1] ?? "").length).trim();
  // The clause is the item's last field: a later `recheck: ...` would otherwise read as part of a path.
  const field = /(?:^|[\s([{,`])([A-Za-z][\w-]+):/.exec(clause);
  if (field) {
    return { error: `done-when must be the last field, but \`${field[1]}:\` follows it` };
  }
  /** @type {DoneCondition[]} */
  const conditions = [];
  for (const part of clause.split(";")) {
    const split = /^(\S+)(?:\s+(.*))?$/.exec(part.trim());
    const kind = split?.[1];
    const argument = (split?.[2] ?? "").trim();
    if (kind === "pr-merged" || kind === "issue-closed") {
      // A sentence may end with a period after the last reference.
      const ref = GITHUB_REF.exec(argument.replace(/\.$/, ""));
      if (!ref) {
        return { error: `bad ${kind === "pr-merged" ? "pull request" : "issue"} "${argument}"` };
      }
      conditions.push({ kind, repo: ref[1] ?? "", number: Number(ref[2]) });
    } else if (kind === "path-absent" && argument) {
      // A drive path is absolute only on Windows; on another system it would be looked up relative to the cwd.
      const absolute = process.platform === "win32" ? /^(?:\/|~\/|[A-Za-z]:[\\/])/ : /^(?:\/|~\/)/;
      if (!absolute.test(argument)) {
        return { error: `path must be absolute or start with ~/: "${argument}"` };
      }
      // Notes in backticks after the path are not part of it; a span glued into the path is.
      if (/\s`/.test(argument)) {
        return { error: `a code span follows the path after a space: "${argument}"` };
      }
      // Other whitespace could change between an evaluation and the close, which compares collapsed text.
      if (/[^\S ]| {2}/.test(argument)) {
        return { error: `path has a tab or consecutive spaces: "${argument}"` };
      }
      conditions.push({ kind, path: argument });
    } else {
      return { error: part.trim() ? `unknown condition "${part.trim()}"` : "empty condition" };
    }
  }
  return { conditions };
}

/**
 * @param {string} text
 * @returns {Plan}
 */
export function parsePlan(text) {
  const lines = text.split(/\r?\n/);
  const header = lines.slice(0, 40);
  /** @param {string} name */
  const field = (name) =>
    header
      .map((line) => line.match(new RegExp(`^\\s*(?:\\*\\*)?${name}:?(?:\\*\\*)?:?\\s*(.+)$`, "i")))
      .find(Boolean)?.[1]
      ?.trim();
  /** @type {string[]} */
  const errors = [];
  const status = field("Status");
  const owner = field("Owner");
  const purpose = field("Purpose");
  // Only an exact `Project:` field: "Project URL: ..." is a different header.
  const project = header
    .map((line) => line.match(/^\s*(?:\*\*)?Project(?:\*\*)?:(?:\*\*)?\s*(.+)$/i))
    .find(Boolean)?.[1]
    ?.trim();
  if (!status) {
    errors.push("no `Status:` line in the first 40 lines");
  }
  if (!owner) {
    errors.push("no `Owner:` line in the first 40 lines");
  }
  const start = lines.findIndex((line) => /^#{1,6}\s+Ledger\s*$/i.test(line));
  if (start < 0) {
    errors.push("no `## Ledger` section");
  }
  let end = lines.length;
  if (start >= 0) {
    const level = (lines[start]?.match(/^#+/)?.[0] ?? "").length;
    const next = lines.findIndex(
      (line, i) => i > start && new RegExp(`^#{1,${level}}\\s`).test(line),
    );
    if (next >= 0) {
      end = next;
    }
  }
  /** @type {LedgerItem[]} */
  const items = [];
  for (let i = start + 1; start >= 0 && i < end; i++) {
    const line = lines[i] ?? "";
    const match = line.match(/^\s*[-*]\s+\[([ x~-])\]\s+(.*)$/i);
    const last = items.at(-1);
    if (match) {
      const mark = /** @type {Mark} */ ((match[1] ?? "").toLowerCase());
      items.push({ line: i + 1, mark, text: match[2] ?? "" });
    } else if (last && /^\s{2,}\S/.test(line) && !/^\s*[-*]\s/.test(line)) {
      last.text += ` ${line.trim()}`;
    }
  }
  for (const item of items) {
    const doneWhen = item.mark === " " || item.mark === "~" ? parseDoneWhen(item.text) : undefined;
    if (doneWhen) {
      item.doneWhen = doneWhen;
    }
  }
  if (start >= 0 && !items.length) {
    errors.push("the ledger has no items (`- [ ] ...`, `- [~] ...`, `- [x] ...`, `- [-] ...`)");
  }
  for (const item of items) {
    const required = REQUIRED[item.mark];
    if (required && !new RegExp(`\\b${required[0]}:\\s*\\S`, "i").test(item.text)) {
      errors.push(
        `L${item.line}: a ${MARKS[item.mark]} item needs \`${required[0]}:\` (${required[1]})`,
      );
    }
  }
  /** @type {NarrativeLine[]} */
  const narrative = [];
  // Lines inside a fenced code block are examples, not plan content.
  let fenced = false;
  lines.forEach((line, i) => {
    if (/^\s*(?:`{3,}|~{3,})/.test(line)) {
      fenced = !fenced;
      return;
    }
    const inLedger = start >= 0 && i > start && i < end;
    if (
      !fenced &&
      !inLedger &&
      i > 0 &&
      (NARRATIVE.test(line) || PROSE_MARKER.test(line) || /^\s*[-*]\s+\[[ ~]\]/.test(line))
    ) {
      narrative.push({
        line: i + 1,
        text: line.trim(),
        box: /^\s*[-*]\s+\[[ ~]\]/.test(line),
      });
    }
  });
  return { status, owner, purpose, project, items, errors, narrative };
}

/** @param {string} text */
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

// Identity is local to these exact UTF-8 plan bytes. No readiness is inferred here.
/** @param {string} planText */
export function planSnapshot(planText) {
  const plan = parsePlan(planText);
  return {
    planSHA256: sha256(planText),
    errors: plan.errors,
    openItems: plan.items
      .filter((item) => item.mark === " " || item.mark === "~")
      .map(({ doneWhen: _doneWhen, ...item }) => ({
        id: `L${item.line}:${sha256(item.mark + item.text)}`,
        ...item,
        recheck: item.text.match(RECHECK)?.[1] ?? null,
      })),
  };
}

/**
 * Lines dropped "by: user" that neither say "asked in <offer ID or message>" nor explicitly name an offer ID: a bulk close-out is not an answer about each item.
 * @param {LedgerItem[]} items
 */
export function droppedByUserUnasked(items) {
  return items.filter(
    (item) =>
      item.mark === "-" &&
      /\bby:\s*user\b/i.test(item.text) &&
      !/\basked in\s+\S/i.test(item.text) &&
      !/\b[Oo]ffer\s+[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+\b/.test(item.text),
  );
}
