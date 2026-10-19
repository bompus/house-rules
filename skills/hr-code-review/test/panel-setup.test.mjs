import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const skill = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** @param {string} path */
const read = (path) => readFileSync(resolve(skill, path), "utf8");
/** @type {any} */
const catalog = JSON.parse(read("references/panel-recommendations.json"));

const fields = [
  "id",
  "profiles",
  "task",
  "model",
  "harness",
  "route",
  "efforts",
  "sourceUrl",
  "checked",
  "samples",
  "metric",
  "timeDefinition",
  "costDefinition",
  "limitations",
  "rationale",
  "status",
];

test("every catalog entry records the evidence the setup procedure promises", () => {
  assert.equal(catalog.version, 1);
  assert.match(catalog.reviewed, /^\d{4}-\d{2}-\d{2}$/);
  assert(catalog.entries.length > 0);
  const ids = new Set();
  for (const entry of catalog.entries) {
    for (const field of fields) {
      assert.notEqual(entry[field], undefined, `${entry.id}: ${field}`);
    }
    assert(!ids.has(entry.id), `duplicate ${entry.id}`);
    ids.add(entry.id);
    assert.match(entry.checked, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(entry.sourceUrl, /^https:\/\//);
    assert(["current", "superseded", "withdrawn", "unverified"].includes(entry.status));
    for (const profile of entry.profiles) {
      assert(["quick", "balanced", "deep"].includes(profile));
    }
    assert(entry.efforts.length > 0);
    for (const row of entry.efforts) {
      assert.equal(typeof row.effort, "string");
      for (const value of [row.fixed, row.listCostUsd, row.wallMinutes]) {
        assert(value === "unknown" || Number.isFinite(value), `${entry.id}: ${row.effort}`);
      }
    }
  }
});

test("a current entry was fetched from its source and defines every figure it records", () => {
  for (const entry of catalog.entries.filter((/** @type {any} */ e) => e.status === "current")) {
    assert(entry.checked <= catalog.reviewed, `${entry.id}: checked after the catalog review date`);
    assert.doesNotMatch(entry.limitations, /not fetched again/i, entry.id);
    /** @param {string} key */
    const numeric = (key) =>
      entry.efforts.some((/** @type {any} */ row) => Number.isFinite(row[key]));
    if (numeric("listCostUsd")) {
      assert.notEqual(entry.costDefinition, "unknown", entry.id);
    }
    if (numeric("wallMinutes")) {
      assert.notEqual(entry.timeDefinition, "unknown", entry.id);
    }
  }
});

test("the recommendations page names each profile that has no entry", () => {
  const page = read("references/panel-recommendations.md");
  for (const profile of ["quick", "balanced", "deep"]) {
    const covered = catalog.entries.some((/** @type {any} */ e) => e.profiles.includes(profile));
    const said = new RegExp(`\`${profile}\`[^.|]*no entry`).test(page);
    assert.equal(said, !covered, `${profile}: page and entries disagree about coverage`);
  }
});

test("setup and change requests reach the setup procedure", () => {
  const skillText = read("SKILL.md");
  assert.match(skillText, /^description:.*set up or change a review panel/m);
  assert.match(skillText, /asks to set up or change a panel[^\n]*\(references\/panel-setup\.md\)/);
});

test("the catalog names no account, path or credential", () => {
  assert.doesNotMatch(JSON.stringify(catalog), /\/home\/|\/Users\/|api[_-]?key|token|@/i);
});

test("setup keeps its no-side-effect and confirm-before-save statements", () => {
  const setup = read("references/panel-setup.md");
  assert.match(setup, /never\s+launches a seat, probes a provider, buys anything/);
  assert.match(setup, /only after the user confirms/);
  assert.match(setup, /make no model calls and spend nothing/);
});

test("the setup reference links resolve inside the installed skill", () => {
  for (const file of [
    "SKILL.md",
    "references/panel-setup.md",
    "references/panel-recommendations.md",
  ]) {
    const base = dirname(resolve(skill, file));
    for (const [, target = ""] of read(file).matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
      if (/^https?:/.test(target)) {
        continue;
      }
      const resolved = resolve(base, target);
      assert(resolved.startsWith(skill + sep), `${file} -> ${target} leaves the skill`);
      assert(existsSync(resolved), `${file} -> ${target}`);
    }
  }
});
