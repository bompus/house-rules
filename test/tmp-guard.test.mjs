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
import { MARKER, PREFIX, removeStale, removeTree } from "./tmp-guard.mjs";

const scratch = () => mkdtempSync(join(tmpdir(), "tmp-guard-test-"));

test("this run's temporary folder is inside one private guard folder", () => {
  assert.match(tmpdir(), new RegExp(`${PREFIX}${process.pid}-[A-Za-z0-9]{6}$`));
});

test("removeTree removes folders closed to their owner and never follows a link", () => {
  const base = scratch();
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

test("removeStale removes only a day-old guard folder whose run is gone", () => {
  const base = scratch();
  const old = new Date(Date.now() - 48 * 3_600_000);
  /** @param {string} name @param {string} marker @param {Date} when */
  const make = (name, marker, when) => {
    const path = join(base, name);
    mkdirSync(path);
    writeFileSync(join(path, MARKER), marker);
    utimesSync(path, when, when);
    return path;
  };
  const deadPid = 2 ** 22 + 12345;
  const gone = make(`${PREFIX}${deadPid}-abcdef`, String(deadPid), old);
  const live = make(`${PREFIX}${process.pid}-abcdef`, String(process.pid), old);
  const young = make(`${PREFIX}${deadPid + 1}-abcdef`, String(deadPid + 1), new Date());
  const wrongMarker = make(`${PREFIX}${deadPid + 2}-abcdef`, "1", old);
  const notGuards = make(`${PREFIX}${deadPid + 3}-too-long-name`, String(deadPid + 3), old);
  removeStale(base);
  assert.equal(existsSync(gone), false);
  for (const kept of [live, young, wrongMarker, notGuards]) {
    assert.equal(existsSync(kept), true, kept);
  }
});
