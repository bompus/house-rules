import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  statSync,
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
  PRIVATE_NAME,
  makeRoot,
  privateBase,
  removeStale,
  removeTree,
  startTime,
  trusted,
} from "./tmp-guard.mjs";

const WIN =
  process.platform === "win32" && "the sweep and the folder modes are not used on Windows";

/**
 * A scratch folder, as its canonical path (the guard returns canonical paths), in the selected scratch root
 * (`HOUSE_RULES_TEST_TMP`, else the system one), removed when the test ends, even if it fails.
 * @param {import("node:test").TestContext} t
 */
const scratch = (t) => {
  const base = realpathSync(
    mkdtempSync(join(process.env.HOUSE_RULES_TEST_TMP || tmpdir(), "tmp-guard-test-")),
  );
  t.after(() => removeTree(base));
  return base;
};

test(
  "under Bun on Linux or macOS this run's temporary folder is inside the private guard folder",
  { skip: GUARD_ROOT === null && "the guard is off under Node, on Windows, or without Bun" },
  () => {
    assert.equal(tmpdir(), GUARD_ROOT);
    assert.match(tmpdir(), new RegExp(`${PREFIX}${process.pid}-[A-Za-z0-9]{6}$`));
    assert.equal(process.env.HOUSE_RULES_TEST_TMP, GUARD_ROOT);
  },
);

test(
  "removeTree removes folders closed to their owner and never follows a link",
  { skip: WIN },
  (t) => {
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
  },
);

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

test(
  "removeStale removes only a day-old guard folder whose marker names its dead run",
  { skip: WIN },
  (t) => {
    const base = scratch(t);
    const gone = make(base, `${PREFIX}${DEAD}-abcdef`, String(DEAD), DAYS_AGO_2);
    const live = make(base, `${PREFIX}${process.pid}-abcdef`, String(process.pid), DAYS_AGO_2);
    const young = make(base, `${PREFIX}${DEAD + 1}-abcdef`, String(DEAD + 1), new Date());
    const wrongMarker = make(base, `${PREFIX}${DEAD + 2}-abcdef`, "1", DAYS_AGO_2);
    const notGuards = make(
      base,
      `${PREFIX}${DEAD + 3}-too-long-name`,
      String(DEAD + 3),
      DAYS_AGO_2,
    );
    const unmarked = make(base, `${PREFIX}${DEAD + 4}-abcdef`, null, DAYS_AGO_2);
    const empty = make(base, `${PREFIX}${DEAD + 5}-abcdef`, "", DAYS_AGO_2);
    removeStale(base);
    assert.equal(existsSync(gone), false);
    for (const kept of [live, young, wrongMarker, notGuards, unmarked, empty]) {
      assert.equal(existsSync(kept), true, kept);
    }
  },
);

test(
  "a run's process id reused by another process does not keep its folder",
  { skip: WIN || (startTime(process.pid) === null && "needs /proc") },
  (t) => {
    const base = scratch(t);
    const reused = make(base, `${PREFIX}${process.pid}-abcdef`, `${process.pid} 1`, DAYS_AGO_2);
    removeStale(base);
    assert.equal(existsSync(reused), false);
  },
);

test(
  "an unreadable or missing base is skipped, and makeRoot makes a removed folder again",
  { skip: WIN },
  (t) => {
    const base = scratch(t);
    removeStale(join(base, "does-not-exist"));
    const root = join(base, "root");
    makeRoot(root);
    removeTree(root);
    makeRoot(root);
    assert.equal(existsSync(join(root, MARKER)), true);
  },
);

test("the guard works only in a folder this user alone can write to", { skip: WIN }, (t) => {
  const uid = process.getuid?.();
  const closed = scratch(t);
  chmodSync(closed, 0o700);
  // Accepting a base needs every folder on the way to be root's or ours and closed to others' renames; where this
  // host's scratch root has an untrusted ancestor the guard is off by design, so only the refusals are checked there.
  const trustedHere = trusted(closed);
  const sticky = scratch(t);
  chmodSync(sticky, 0o1777);
  const open = scratch(t);
  chmodSync(open, 0o777);
  assert.equal(privateBase(open), null);
  // A subfolder open to others, or a link in its place, is refused.
  const loose = scratch(t);
  chmodSync(loose, 0o1777);
  mkdirSync(join(loose, `${PRIVATE_NAME}-${uid}`), { mode: 0o755 });
  chmodSync(join(loose, `${PRIVATE_NAME}-${uid}`), 0o755);
  assert.equal(privateBase(loose), null);
  const swapped = scratch(t);
  chmodSync(swapped, 0o1777);
  symlinkSync(closed, join(swapped, `${PRIVATE_NAME}-${uid}`));
  assert.equal(privateBase(swapped), null);
  // A folder on the way that others can rename (open to writes and not sticky) refuses the base below it.
  const ancestor = scratch(t);
  chmodSync(ancestor, 0o777);
  const below = join(ancestor, "below");
  mkdirSync(below, { mode: 0o700 });
  assert.equal(privateBase(below), null);
  // The path checked is not resolved a second time: a link is untrusted even when it points at a trusted folder.
  const hop = scratch(t);
  mkdirSync(join(hop, "real", "inner"), { recursive: true, mode: 0o700 });
  chmodSync(join(hop, "real"), 0o700);
  symlinkSync(join(hop, "real", "inner"), join(hop, "via"));
  assert.equal(trusted(join(hop, "via")), false);
  if (!trustedHere) {
    return;
  }
  assert.equal(privateBase(closed), closed);
  const own = privateBase(sticky);
  assert.equal(own, join(sticky, `${PRIVATE_NAME}-${uid}`));
  assert.equal(statSync(String(own)).mode & 0o777, 0o700);
  assert.equal(privateBase(sticky), own);
  const link = join(sticky, "link-base");
  symlinkSync(closed, link);
  // A link is followed once, to the canonical folder that is then checked and returned.
  assert.equal(privateBase(link), closed);
  chmodSync(ancestor, 0o1777);
  assert.equal(privateBase(below), below);
  // The path that was checked is the path that is returned: a link followed by `..` and a relative spelling both come back canonical.
  const viaLink = privateBase(`${hop}/via/..`);
  assert.equal(viaLink, realpathSync(String(viaLink)));
  assert.ok(String(viaLink).startsWith(hop));
  const here = process.cwd();
  try {
    process.chdir(join(hop, "real"));
    assert.equal(privateBase("."), join(hop, "real"));
  } finally {
    process.chdir(here);
  }
  assert.equal(trusted(join(hop, "real")), true);
});
