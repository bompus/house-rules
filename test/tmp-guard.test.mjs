import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GUARD_ROOT,
  MARKER,
  PREFIX,
  makeRoot,
  removeStale,
  removeTree,
  startTime,
} from "./tmp-guard.mjs";

/** A scratch folder removed when the test ends, even if it fails. @param {import("node:test").TestContext} t */
const scratch = (t) => {
  const base = mkdtempSync(join(tmpdir(), "tmp-guard-test-"));
  t.after(() => removeTree(base));
  return base;
};

test(
  "under Bun on Linux or macOS this run's temporary folder is inside the private guard folder",
  {
    skip: GUARD_ROOT === null && "the guard is off under Node, on Windows, or without Bun",
  },
  () => {
    assert.equal(tmpdir(), GUARD_ROOT);
    assert.match(tmpdir(), new RegExp(`${PREFIX}${process.pid}-[A-Za-z0-9]{6}$`));
    assert.equal(process.env.HOUSE_RULES_TEST_TMP, GUARD_ROOT);
  },
);

test("removeTree removes folders closed to their owner and never follows a link", (t) => {
  const base = scratch(t);
  const outside = join(base, "outside");
  mkdirSync(outside);
  writeFileSync(join(outside, "keep"), "x");
  const tree = join(base, "tree");
  mkdirSync(join(tree, "closed", "inner"), { recursive: true });
  writeFileSync(join(tree, "closed", "inner", "f"), "x");
  symlinkSync(outside, join(tree, "link"));
  chmodSync(join(tree, "closed", "inner"), 0o000);
  chmodSync(join(tree, "closed"), 0o500);
  removeTree(tree);
  assert.equal(existsSync(tree), false);
  assert.equal(existsSync(join(outside, "keep")), true);
});

/** @param {string} base @param {string} name @param {string | null} marker @param {Date} when */
const make = (base, name, marker, when) => {
  const path = join(base, name);
  mkdirSync(path);
  writeFileSync(join(path, "content"), "x");
  if (marker !== null) {
    writeFileSync(join(path, MARKER), marker);
  }
  utimesSync(path, when, when);
  return path;
};
const DAYS_AGO_2 = new Date(Date.now() - 48 * 3_600_000);
const DEAD = 2 ** 22 + 12345;

test("removeStale removes only a day-old guard folder whose run is gone", (t) => {
  const base = scratch(t);
  const gone = make(base, `${PREFIX}${DEAD}-abcdef`, String(DEAD), DAYS_AGO_2);
  const live = make(base, `${PREFIX}${process.pid}-abcdef`, String(process.pid), DAYS_AGO_2);
  const young = make(base, `${PREFIX}${DEAD + 1}-abcdef`, String(DEAD + 1), new Date());
  const wrongMarker = make(base, `${PREFIX}${DEAD + 2}-abcdef`, "1", DAYS_AGO_2);
  const notGuards = make(base, `${PREFIX}${DEAD + 3}-too-long-name`, String(DEAD + 3), DAYS_AGO_2);
  removeStale(base);
  assert.equal(existsSync(gone), false);
  for (const kept of [live, young, wrongMarker, notGuards]) {
    assert.equal(existsSync(kept), true, kept);
  }
});

test("an interrupted cleanup is finished by the sweep: the marker is removed last, and a missing one goes by the name", (t) => {
  const base = scratch(t);
  const folder = make(base, `${PREFIX}${DEAD}-abcdef`, String(DEAD), DAYS_AGO_2);
  const unmarked = make(base, `${PREFIX}${DEAD + 1}-abcdef`, null, DAYS_AGO_2);
  const liveUnmarked = make(base, `${PREFIX}${process.pid}-abcdeg`, null, DAYS_AGO_2);
  removeStale(base);
  assert.equal(existsSync(folder), false);
  assert.equal(existsSync(unmarked), false);
  assert.equal(existsSync(liveUnmarked), true);
});

test(
  "a run's process id reused by another process does not keep its folder",
  {
    skip: startTime(process.pid) === null && "needs /proc",
  },
  (t) => {
    const base = scratch(t);
    const reused = make(base, `${PREFIX}${process.pid}-abcdef`, `${process.pid} 1`, DAYS_AGO_2);
    removeStale(base);
    assert.equal(existsSync(reused), false);
  },
);

test("an unreadable or missing base is skipped, and makeRoot makes a removed folder again", (t) => {
  const base = scratch(t);
  removeStale(join(base, "does-not-exist"));
  const root = join(base, "root");
  makeRoot(root);
  removeTree(root);
  makeRoot(root);
  assert.equal(existsSync(join(root, MARKER)), true);
});
