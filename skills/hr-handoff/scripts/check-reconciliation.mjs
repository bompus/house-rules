#!/usr/bin/env bun
// Offline accounting check. See ../references/reconciliation.md for the input
// format and limits. No writes, host queries, or semantic-completeness claim.
// Exit 0: mechanically complete; 1: invalid/unreadable; 2: valid but partial.
// `covered N/M` counts the open and deferred plan lines mapped to items (N) over every such line the plan
// files hold (M), including lines outside the `## Ledger` section and table rows that are not read as items.
// A receipt that read no plan file is partial unless its `plan` field says "none: <reason>".
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** A JSON object read from the receipt or a snapshot; its fields are unchecked until validated. */
/** @typedef {Record<string, any>} Json */
/** @typedef {{ id: string, mark: string }} OutsideLine */
/** @typedef {Json & { at: number }} OutcomeEvent */

let counts = { covered: "0/0", sources: 0, records: 0, items: 0 };
/** @type {string[]} */
const errors = [];
/** @type {string[]} */
const gaps = [];
/**
 * @param {unknown} value
 * @returns {value is Json}
 */
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
/**
 * @param {unknown} value
 * @returns {value is string}
 */
const text = (value) => typeof value === "string" && value.trim().length > 0;
const states = ["done", "open", "deferred"];
/** @type {(source: unknown, record: unknown) => string} */
const key = (source, record) => JSON.stringify([source, record]);

/**
 * @param {unknown} value
 * @param {string} label
 */
function requireText(value, label) {
  if (!text(value)) {
    errors.push(`${label}: expected nonempty text`);
  }
}

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {any[]}
 */
function list(value, label) {
  if (Array.isArray(value)) {
    return value;
  }
  errors.push(`${label}: expected an array`);
  return [];
}

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {Json[]}
 */
function entries(value, label) {
  return list(value, label).filter((entry, index) => {
    if (object(entry)) {
      return true;
    }
    errors.push(`${label}[${index}]: expected an object`);
    return false;
  });
}

/**
 * @param {unknown} value
 * @param {string} label
 */
function timestamp(value, label) {
  if (
    !text(value) ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 19) !== value.slice(0, 19)
  ) {
    errors.push(`${label}: expected a UTC ISO timestamp`);
    return 0;
  }
  return Date.parse(value);
}

/**
 * @param {Json[]} entries
 * @param {string} label
 */
function unique(entries, label) {
  /** @type {Map<unknown, Json>} */
  const map = new Map();
  for (const entry of entries) {
    requireText(entry.id, `${label}.id`);
    if (map.has(entry.id)) {
      errors.push(`${label}: duplicate id ${entry.id}`);
    }
    map.set(entry.id, entry);
  }
  return map;
}

// A plan file (`.md`) is read as its `## Ledger` item lines, one record per item, named `L<line>`;
// other text in the section, wrapped continuation lines included, is not read.
// Open (`- [ ]`) and deferred (`- [~]`) lines are remembered: they must carry over as items.
// Item lines elsewhere in the file are not records either, but they are counted and reported as a gap.
// Lines that look like plan items but are not read as records are counted, so they cannot vanish from the
// total: a checklist line with another mark (`- [?]`; `+ [ ]` and `1. [ ]` are read like `- [ ]`), and the
// body rows of a Markdown table anywhere in the file (its header row and first separator row excluded). A
// table runs until a blank line, a heading or a list item, and a row may omit its pipes. Fenced code is
// skipped for tables; a fence closes only with the same character, at least as long, and no text after it.
const ITEM = /^\s*(?:[-*+]|\d+[.)])\s+\[(.)\](?:\s+(.*))?$/u;
const SEPARATOR = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
// Up to three spaces of indent; the text after a backtick fence cannot contain a backtick.
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
// Block quotes hold plan content too: classify a line without its `>` prefixes.
const QUOTE = /^(?:\s{0,3}>[ \t]?)+/;
/** @param {string} line */
const unquote = (line) => line.replace(QUOTE, "");
/** @param {string | undefined} line */
const isSeparator = (line) => line !== undefined && line.includes("|") && SEPARATOR.test(line);
/** @param {string} raw */
function ledgerRecords(raw) {
  const lines = raw.split(/\r?\n/);
  const start = lines.findIndex((line) => /^#{1,6}\s+Ledger\s*$/i.test(line));
  if (start < 0) {
    return null;
  }
  const heading = /** @type {RegExpMatchArray} */ (
    /** @type {string} */ (lines[start]).match(/^#+/)
  );
  const level = heading[0].length;
  /** @type {{ id: string, text: string, mark: string }[]} */
  const records = [];
  /** @type {OutsideLine[]} */
  const outside = [];
  let inside = false;
  /** @type {string | null} */
  let fence = null;
  // How many block quotes deep the open fence began; a line with fewer `>` ends it with the quote.
  let fenceDepth = 0;
  let tableRows = 0;
  let oddMarks = 0;
  let inTable = false;
  for (let i = 0; i < lines.length; i++) {
    const line = /** @type {string} */ (lines[i]);
    if (i === start) {
      inside = true;
    } else if (inside && new RegExp(`^#{1,${level}}\\s`).test(line)) {
      inside = false;
    }
    const text = unquote(line);
    const depth = (line.slice(0, line.length - text.length).match(/>/g) ?? []).length;
    if (fence !== null && depth < fenceDepth) {
      fence = null;
    }
    let marker = FENCE.exec(text);
    if (marker?.[1]?.startsWith("`") && marker[2]?.includes("`")) {
      marker = null;
    }
    if (fence === null && marker) {
      fence = /** @type {string} */ (marker[1]);
      fenceDepth = depth;
      inTable = false;
    } else if (
      fence !== null &&
      depth === fenceDepth &&
      marker &&
      /** @type {string} */ (marker[1])[0] === fence[0] &&
      /** @type {string} */ (marker[1]).length >= fence.length &&
      /** @type {string} */ (marker[2]).trim() === ""
    ) {
      fence = null;
    }
    const match = text.match(ITEM);
    if (fence === null && !marker) {
      if (inTable && (text.trim() === "" || /^#{1,6}\s/.test(text) || match)) {
        inTable = false;
      }
      if (inTable) {
        tableRows++;
        continue;
      }
      if (!match && !isSeparator(text) && isSeparator(unquote(lines[i + 1] ?? ""))) {
        // The header row; the separator after it is skipped with it.
        inTable = true;
        i++;
        continue;
      }
    }
    if (!match) {
      continue;
    }
    // The mark always participates in a match; the body may be absent.
    const [, mark = "", body = ""] = match;
    if (!/^[ x~-]$/i.test(mark)) {
      oddMarks++;
    } else if (inside) {
      records.push({ id: `L${i + 1}`, text: body, mark });
    } else {
      outside.push({ id: `L${i + 1}`, mark });
    }
  }
  return { records, outside, tableRows, oddMarks };
}

/**
 * @param {string} label
 * @param {OutsideLine[]} outside
 */
function outsideGap(label, outside) {
  const open = outside.filter((line) => /[ ~]/.test(line.mark));
  const named = open.length > 0 ? open : outside;
  const shown = named
    .slice(0, 5)
    .map((line) => line.id)
    .join(", ");
  const more = named.length > 5 ? ` and ${named.length - 5} more` : "";
  const count = open.length > 0 ? `, ${open.length} of them open or deferred` : "";
  return `${label}: ${outside.length} item line(s) outside the \`## Ledger\` section were not read${count} (${shown}${more}); move them into the ledger section`;
}

/**
 * @param {unknown} receipt
 * @param {string} directory
 */
function check(receipt, directory) {
  if (!object(receipt)) {
    throw new Error("receipt: expected an object");
  }
  if (receipt.version !== 1) {
    errors.push("version: expected 1");
  }
  requireText(receipt.owner, "owner");
  if (!["complete", "partial"].includes(receipt.coverage)) {
    errors.push("coverage: expected complete or partial");
  }
  const sources = unique(entries(receipt.sources, "sources"), "source");
  const items = unique(entries(receipt.items, "items"), "item");
  /** @type {Map<string, Json>} */
  const records = new Map();
  /** @type {Set<string>} */
  const openLines = new Set();
  let planRead = false;
  let unreadPlanLines = 0;
  /** @type {Map<unknown, OutcomeEvent[]>} */
  const outcomes = new Map();
  if (sources.size === 0) {
    gaps.push("no source snapshots supplied");
  }

  for (const source of sources.values()) {
    const label = `source ${source.id}`;
    requireText(source.file, `${label}.file`);
    requireText(source.snapshot, `${label}.snapshot`);
    const declared = list(source.gaps, `${label}.gaps`);
    for (const gap of declared) {
      requireText(gap, `${label}.gaps[]`);
      gaps.push(`${label}: ${gap}`);
    }
    if (source.expectedRecords === null) {
      gaps.push(`${label}: total unknown`);
    } else if (!Number.isSafeInteger(source.expectedRecords) || source.expectedRecords < 0) {
      errors.push(`${label}.expectedRecords: expected a nonnegative integer or null`);
    }
    if (!text(source.file)) {
      continue;
    }
    let raw;
    try {
      raw = readFileSync(resolve(directory, source.file), "utf8");
    } catch (error) {
      const { code } = /** @type {NodeJS.ErrnoException} */ (error);
      if (code === "ENOENT" && declared.length > 0) {
        gaps.push(`${label}: snapshot unavailable`);
      } else {
        errors.push(`${label}: cannot read snapshot (${code ?? "error"})`);
      }
      continue;
    }
    let data;
    if (source.file.endsWith(".md")) {
      data = ledgerRecords(raw);
      if (!data) {
        errors.push(`${label}: no \`## Ledger\` section in the plan`);
        continue;
      }
    } else {
      try {
        data = JSON.parse(raw);
      } catch {
        errors.push(`${label}: invalid snapshot JSON`);
        continue;
      }
    }
    if (!object(data)) {
      errors.push(`${label}: snapshot must be an object`);
      continue;
    }
    if (source.file.endsWith(".md")) {
      planRead = true;
      if (data.records.length === 0) {
        errors.push(`${label}: the \`## Ledger\` section has no item lines`);
      }
      if (data.outside.length > 0) {
        gaps.push(outsideGap(label, data.outside));
      }
      if (data.tableRows > 0) {
        gaps.push(
          `${label}: ${data.tableRows} table row(s) in the plan were not read; write each open or deferred one as an item line in the ledger`,
        );
      }
      if (data.oddMarks > 0) {
        gaps.push(
          `${label}: ${data.oddMarks} checklist line(s) with a mark other than space, x, ~ or - were not read; use one of those marks`,
        );
      }
      unreadPlanLines +=
        data.oddMarks +
        data.tableRows +
        data.outside.filter((/** @type {OutsideLine} */ line) => /[ ~]/.test(line.mark)).length;
    }
    const rows = unique(entries(data.records, `${label}.records`), `${label} record`);
    if (Number.isSafeInteger(source.expectedRecords) && source.expectedRecords !== rows.size) {
      gaps.push(`${label}: expected ${source.expectedRecords} records, read ${rows.size}`);
    }
    for (const row of rows.values()) {
      requireText(row.text, `${label} record ${row.id}.text`);
      records.set(key(source.id, row.id), row);
      if (source.file.endsWith(".md") && /[ ~]/.test(row.mark)) {
        openLines.add(key(source.id, row.id));
      }
      if (row.outcome !== undefined) {
        if (!object(row.outcome) || !states.includes(row.outcome.state)) {
          errors.push(`${label} record ${row.id}: invalid outcome`);
          continue;
        }
        const item = row.outcome.item;
        if (!items.has(item)) {
          errors.push(`${label} record ${row.id}: unknown outcome item ${item}`);
        }
        const at = timestamp(row.at, `${label} record ${row.id}.at`);
        const events = outcomes.get(item) ?? [];
        events.push({ ...row.outcome, at, source: source.id, record: row.id });
        outcomes.set(item, events);
      }
    }
  }

  /** @type {Map<string, any[]>} */
  const accounting = new Map();
  for (const row of entries(receipt.accounting, "accounting")) {
    const ref = key(row.source, row.record);
    const label = `accounting ${row.source}/${row.record}`;
    if (!records.has(ref)) {
      errors.push(`${label}: unknown source record`);
    }
    if (accounting.has(ref)) {
      errors.push(`${label}: duplicate accounting`);
    }
    const mapped = row.items === undefined ? [] : list(row.items, `${label}.items`);
    if (mapped.length > 0 === text(row.context)) {
      errors.push(`${label}: supply item IDs or a context-only reason`);
    }
    for (const item of mapped) {
      if (!items.has(item)) {
        errors.push(`${label}: unknown item ${item}`);
      }
    }
    if (openLines.has(ref) && text(row.context)) {
      errors.push(
        `${label}: an open or deferred ledger line needs an item, not a context-only reason`,
      );
    }
    accounting.set(ref, mapped);
  }
  // A summary row ("the rest, reopen only if asked") that swallows many open lines loses them;
  // an item fed by more than one open line must say in `merges` how one next action and one piece of evidence satisfy them all.
  /** @type {Map<unknown, number>} */
  const absorbed = new Map();
  for (const ref of openLines) {
    for (const item of new Set(accounting.get(ref) ?? [])) {
      absorbed.set(item, (absorbed.get(item) ?? 0) + 1);
    }
  }
  for (const [item, count] of absorbed) {
    if (count > 1 && !text(items.get(item)?.merges)) {
      errors.push(
        `item ${item}: absorbs ${count} open or deferred ledger lines; split it, or say in merges why they are one`,
      );
    }
  }
  for (const ref of records.keys()) {
    if (!accounting.has(ref)) {
      errors.push(`unaccounted record ${ref}`);
    }
  }
  // Kept in the module as soon as it is known, so a later validation failure cannot discard it.
  const mapped = [...openLines].filter((ref) => (accounting.get(ref) ?? []).length > 0).length;
  const covered = `${mapped}/${openLines.size + unreadPlanLines}`;
  counts.covered = covered;

  /**
   * @param {unknown} value
   * @param {string} label
   * @param {unknown} [item]
   */
  function evidence(value, label, item) {
    const refs = entries(value, `${label}.evidence`);
    if (refs.length === 0) {
      errors.push(`${label}: evidence required`);
    }
    for (const ref of refs) {
      const id = key(ref.source, ref.record);
      if (!records.has(id)) {
        errors.push(`${label}: unknown evidence ${id}`);
      }
      if (item && !accounting.get(id)?.includes(item)) {
        errors.push(`${label}: evidence ${id} is not mapped to this item`);
      }
    }
  }

  for (const item of items.values()) {
    const label = `item ${item.id}`;
    requireText(item.owner, `${label}.owner`);
    requireText(item.next, `${label}.next`);
    if (!states.includes(item.state)) {
      errors.push(`${label}: invalid state`);
    }
    evidence(item.evidence, label, item.id);
    const events = (outcomes.get(item.id) ?? []).sort((a, b) => a.at - b.at);
    for (let i = 0; i < events.length; i++) {
      const event = /** @type {OutcomeEvent} */ (events[i]);
      if (!accounting.get(key(event.source, event.record))?.includes(item.id)) {
        errors.push(`${label}: outcome ${event.source}/${event.record} is not mapped to this item`);
      }
      const previous = events[i - 1];
      if (previous?.at === event.at && previous.state !== event.state) {
        errors.push(`${label}: conflicting outcomes at the same time`);
      }
      if (previous?.state === "done" && event.state !== "done" && event.reopens !== true) {
        errors.push(`${label}: reopening needs a declared later request or contradictory evidence`);
      }
    }
    const latest = events.at(-1);
    if (latest && latest.state !== item.state) {
      errors.push(`${label}: state ${item.state} contradicts latest outcome ${latest.state}`);
    }
    if (
      latest &&
      !item.evidence?.some?.(
        (/** @type {Json} */ ref) => ref.source === latest.source && ref.record === latest.record,
      )
    ) {
      errors.push(`${label}: latest outcome must be included in its evidence`);
    }
  }

  const git = receipt.git;
  if (!object(git)) {
    errors.push("git: explicit inventory required, including when empty");
  } else {
    requireText(git.scope, "git.scope");
    timestamp(git.checkedAt, "git.checkedAt");
    evidence(git.evidence, "git");
    const seen = new Set();
    for (const group of ["ownedPrs", "dependencyPrs"]) {
      for (const [index, pr] of list(git[group], `git.${group}`).entries()) {
        const label = `git.${group}[${index}]`;
        if (!object(pr)) {
          errors.push(`${label}: expected an object`);
          continue;
        }
        let url;
        try {
          url = new URL(pr.url);
        } catch {
          errors.push(`${label}: invalid URL`);
        }
        if (url && (url.protocol !== "https:" || url.username || url.password)) {
          errors.push(`${label}: expected an HTTPS URL without credentials`);
        }
        if (seen.has(pr.url)) {
          errors.push(`${label}: duplicate PR across inventories`);
        }
        seen.add(pr.url);
        requireText(pr.owner, `${label}.owner`);
        if (group === "ownedPrs" && pr.owner !== receipt.owner) {
          errors.push(`${label}: owner differs from receipt owner; record dependencies separately`);
        }
        if (group === "dependencyPrs" && pr.owner === receipt.owner) {
          errors.push(`${label}: self-owned PR belongs in ownedPrs`);
        }
        if (!["open", "closed", "merged"].includes(pr.state)) {
          errors.push(`${label}: invalid state`);
        }
        timestamp(pr.checkedAt, `${label}.checkedAt`);
        requireText(pr.next, `${label}.next`);
        evidence(pr.evidence, label);
      }
    }
    for (const [index, commit] of list(git.commitsWithoutPr, "git.commitsWithoutPr").entries()) {
      const label = `git.commitsWithoutPr[${index}]`;
      if (!object(commit)) {
        errors.push(`${label}: expected an object`);
        continue;
      }
      for (const field of ["repo", "branch", "sha", "next"]) {
        requireText(commit[field], `${label}.${field}`);
      }
      if (typeof commit.sha !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(commit.sha)) {
        errors.push(`${label}: expected a full Git object ID`);
      }
      if (commit.owner !== receipt.owner) {
        errors.push(`${label}: owner differs from receipt owner`);
      }
      evidence(commit.evidence, label);
    }
  }
  if (!planRead) {
    if (receipt.plan === undefined) {
      gaps.push(
        'no plan ledger was read (covered 0/0 is not coverage): name the plan as a `.md` source, or set `plan` to "none: <reason>"',
      );
    } else if (typeof receipt.plan !== "string" || !/^none:\s*\S/.test(receipt.plan)) {
      errors.push('plan: expected "none: <reason>" when no plan file is a source');
    }
  }
  if (receipt.coverage === "complete" && gaps.length > 0) {
    errors.push("complete coverage claimed despite source gaps");
  }
  if (receipt.coverage === "partial" && gaps.length === 0) {
    gaps.push("receipt declares partial coverage");
  }
  return { covered, sources: sources.size, records: records.size, items: items.size };
}

try {
  if (process.argv.length !== 3) {
    throw new Error("usage: check-reconciliation.mjs <receipt.json>");
  }
  const file = resolve(/** @type {string} */ (process.argv[2]));
  counts = { ...counts, ...check(JSON.parse(readFileSync(file, "utf8")), dirname(file)) };
} catch (error) {
  // Avoid printing an input excerpt from JSON.parse or filesystem paths.
  const failure = /** @type {NodeJS.ErrnoException} */ (error);
  errors.push(
    error instanceof SyntaxError
      ? "receipt: invalid JSON"
      : failure.code
        ? `receipt: ${failure.code}`
        : failure.message,
  );
}
const partial = gaps.length > 0;
const status = errors.length > 0 ? "invalid" : partial ? "partial" : "complete";
console.log(
  JSON.stringify(
    {
      status,
      ...counts,
      errors,
      gaps,
      limits:
        "Checks supplied accounting and declared outcomes only. Does not prove semantic completeness, export completeness, live PR state, or landing authorization.",
    },
    null,
    2,
  ),
);
process.exitCode = errors.length > 0 ? 1 : partial ? 2 : 0;
