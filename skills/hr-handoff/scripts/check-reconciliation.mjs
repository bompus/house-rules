#!/usr/bin/env node
// Offline accounting check. See ../references/reconciliation.md for the input
// format and limits. No writes, host queries, or semantic-completeness claim.
// Exit 0: mechanically complete; 1: invalid/unreadable; 2: valid but partial.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const errors = [];
const gaps = [];
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value) => typeof value === "string" && value.trim().length > 0;
const states = ["done", "open", "deferred"];
const key = (source, record) => JSON.stringify([source, record]);

function requireText(value, label) {
  if (!text(value)) errors.push(`${label}: expected nonempty text`);
}

function list(value, label) {
  if (Array.isArray(value)) return value;
  errors.push(`${label}: expected an array`);
  return [];
}

function entries(value, label) {
  return list(value, label).filter((entry, index) => {
    if (object(entry)) return true;
    errors.push(`${label}[${index}]: expected an object`);
    return false;
  });
}

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

function unique(entries, label) {
  const map = new Map();
  for (const entry of entries) {
    requireText(entry.id, `${label}.id`);
    if (map.has(entry.id)) errors.push(`${label}: duplicate id ${entry.id}`);
    map.set(entry.id, entry);
  }
  return map;
}

function check(receipt, directory) {
  if (!object(receipt)) throw new Error("receipt: expected an object");
  if (receipt.version !== 1) errors.push("version: expected 1");
  requireText(receipt.owner, "owner");
  if (!["complete", "partial"].includes(receipt.coverage)) {
    errors.push("coverage: expected complete or partial");
  }
  const sources = unique(entries(receipt.sources, "sources"), "source");
  const items = unique(entries(receipt.items, "items"), "item");
  const records = new Map();
  const outcomes = new Map();
  if (sources.size === 0) gaps.push("no source snapshots supplied");

  for (const source of sources.values()) {
    const label = `source ${source.id}`;
    requireText(source.file, `${label}.file`);
    requireText(source.snapshot, `${label}.snapshot`);
    const declared = list(source.gaps, `${label}.gaps`);
    for (const gap of declared) {
      requireText(gap, `${label}.gaps[]`);
      gaps.push(`${label}: ${gap}`);
    }
    if (source.expectedRecords === null) gaps.push(`${label}: total unknown`);
    else if (!Number.isSafeInteger(source.expectedRecords) || source.expectedRecords < 0) {
      errors.push(`${label}.expectedRecords: expected a nonnegative integer or null`);
    }
    if (!text(source.file)) continue;
    let raw;
    try {
      raw = readFileSync(resolve(directory, source.file), "utf8");
    } catch (error) {
      if (error.code === "ENOENT" && declared.length > 0) {
        gaps.push(`${label}: snapshot unavailable`);
      } else errors.push(`${label}: cannot read snapshot (${error.code ?? "error"})`);
      continue;
    }
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      errors.push(`${label}: invalid snapshot JSON`);
      continue;
    }
    if (!object(data)) {
      errors.push(`${label}: snapshot must be an object`);
      continue;
    }
    const rows = unique(entries(data.records, `${label}.records`), `${label} record`);
    if (Number.isSafeInteger(source.expectedRecords) && source.expectedRecords !== rows.size) {
      gaps.push(`${label}: expected ${source.expectedRecords} records, read ${rows.size}`);
    }
    for (const row of rows.values()) {
      requireText(row.text, `${label} record ${row.id}.text`);
      records.set(key(source.id, row.id), row);
      if (row.outcome !== undefined) {
        if (!object(row.outcome) || !states.includes(row.outcome.state)) {
          errors.push(`${label} record ${row.id}: invalid outcome`);
          continue;
        }
        const item = row.outcome.item;
        if (!items.has(item))
          errors.push(`${label} record ${row.id}: unknown outcome item ${item}`);
        const at = timestamp(row.at, `${label} record ${row.id}.at`);
        const events = outcomes.get(item) ?? [];
        events.push({ ...row.outcome, at, source: source.id, record: row.id });
        outcomes.set(item, events);
      }
    }
  }

  const accounting = new Map();
  for (const row of entries(receipt.accounting, "accounting")) {
    const ref = key(row.source, row.record);
    const label = `accounting ${row.source}/${row.record}`;
    if (!records.has(ref)) errors.push(`${label}: unknown source record`);
    if (accounting.has(ref)) errors.push(`${label}: duplicate accounting`);
    const mapped = row.items === undefined ? [] : list(row.items, `${label}.items`);
    if (mapped.length > 0 === text(row.context)) {
      errors.push(`${label}: supply item IDs or a context-only reason`);
    }
    for (const item of mapped) {
      if (!items.has(item)) errors.push(`${label}: unknown item ${item}`);
    }
    accounting.set(ref, mapped);
  }
  for (const ref of records.keys()) {
    if (!accounting.has(ref)) errors.push(`unaccounted record ${ref}`);
  }

  function evidence(value, label, item) {
    const refs = entries(value, `${label}.evidence`);
    if (refs.length === 0) errors.push(`${label}: evidence required`);
    for (const ref of refs) {
      const id = key(ref.source, ref.record);
      if (!records.has(id)) errors.push(`${label}: unknown evidence ${id}`);
      if (item && !accounting.get(id)?.includes(item)) {
        errors.push(`${label}: evidence ${id} is not mapped to this item`);
      }
    }
  }

  for (const item of items.values()) {
    const label = `item ${item.id}`;
    requireText(item.owner, `${label}.owner`);
    requireText(item.next, `${label}.next`);
    if (!states.includes(item.state)) errors.push(`${label}: invalid state`);
    evidence(item.evidence, label, item.id);
    const events = (outcomes.get(item.id) ?? []).sort((a, b) => a.at - b.at);
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
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
      !item.evidence?.some?.((ref) => ref.source === latest.source && ref.record === latest.record)
    ) {
      errors.push(`${label}: latest outcome must be included in its evidence`);
    }
  }

  const git = receipt.git;
  if (!object(git)) errors.push("git: explicit inventory required, including when empty");
  else {
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
        if (seen.has(pr.url)) errors.push(`${label}: duplicate PR across inventories`);
        seen.add(pr.url);
        requireText(pr.owner, `${label}.owner`);
        if (group === "ownedPrs" && pr.owner !== receipt.owner) {
          errors.push(`${label}: owner differs from receipt owner; record dependencies separately`);
        }
        if (group === "dependencyPrs" && pr.owner === receipt.owner) {
          errors.push(`${label}: self-owned PR belongs in ownedPrs`);
        }
        if (!["open", "closed", "merged"].includes(pr.state))
          errors.push(`${label}: invalid state`);
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
      for (const field of ["repo", "branch", "sha", "next"])
        requireText(commit[field], `${label}.${field}`);
      if (typeof commit.sha !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(commit.sha)) {
        errors.push(`${label}: expected a full Git object ID`);
      }
      if (commit.owner !== receipt.owner) errors.push(`${label}: owner differs from receipt owner`);
      evidence(commit.evidence, label);
    }
  }
  if (receipt.coverage === "complete" && gaps.length > 0) {
    errors.push("complete coverage claimed despite source gaps");
  }
  if (receipt.coverage === "partial" && gaps.length === 0)
    gaps.push("receipt declares partial coverage");
  return { sources: sources.size, records: records.size, items: items.size };
}

let counts = { sources: 0, records: 0, items: 0 };
try {
  if (process.argv.length !== 3) throw new Error("usage: check-reconciliation.mjs <receipt.json>");
  const file = resolve(process.argv[2]);
  counts = check(JSON.parse(readFileSync(file, "utf8")), dirname(file));
} catch (error) {
  // Avoid printing an input excerpt from JSON.parse or filesystem paths.
  errors.push(
    error instanceof SyntaxError
      ? "receipt: invalid JSON"
      : error.code
        ? `receipt: ${error.code}`
        : error.message,
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
