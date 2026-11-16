// Preloaded by `bun test` (bunfig.toml): every test's temporary folder (`os.tmpdir()`, children included, and
// `HOUSE_RULES_TEST_TMP` for the fixtures that read it) is inside one private folder per run, removed when the run ends,
// so a run leaves nothing in the shared temporary folder. Tests make folders closed to their owner on purpose (mode
// 000), which a plain recursive remove cannot delete. A run that was killed leaves its folder; the next run removes
// guard folders a day old whose run is gone. The folder is made inside `HOUSE_RULES_TEST_TMP` when that is set, else
// the system temporary folder. Active only under Bun on Linux and macOS: `node --test` imports this file for its
// helpers and changes nothing. Everything happens in a folder only this user can write to: the base itself when it is,
// else a private subfolder of a sticky base (as `/tmp` is); a base others can rename entries in turns the guard off.
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const PREFIX = "house-rules-test-";
export const MARKER = ".house-rules-test-owner";
const STALE_MS = 24 * 3_600_000;
// What `mkdtemp` makes for this guard: the run's process id and six characters. A folder that merely starts with
// the prefix is not the guard's and is never removed.
const NAME = new RegExp(`^${PREFIX}(\\d+)-[A-Za-z0-9]{6}$`);

/**
 * Removes a tree, links as links (never followed), opening each folder to its owner first. The owner marker goes last,
 * so a cleanup that is interrupted leaves the evidence the stale sweep needs to finish it.
 * @param {string} path
 */
export function removeTree(path) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    return;
  }
  if (stat.isDirectory()) {
    chmodSync(path, 0o700);
    const names = readdirSync(path).sort((a, b) => Number(a === MARKER) - Number(b === MARKER));
    for (const name of names) {
      removeTree(join(path, name));
    }
  }
  rmSync(path, { recursive: true, force: true });
}

/** When the process started, in clock ticks since boot (field 22 of /proc/<pid>/stat), or null where /proc cannot say. @param {number} pid */
export function startTime(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] ?? null;
  } catch {
    return null;
  }
}

/**
 * Whether the run that made this guard folder has ended: its marker names the process in the folder's name, and that
 * process is gone, or its id now belongs to a process that started at another time. A folder without a readable marker
 * that names that process is not proven ours and is kept.
 * @param {string} path @param {string} name
 */
function abandoned(path, name) {
  const pid = Number(NAME.exec(name)?.[1]);
  let marker;
  try {
    marker = readFileSync(join(path, MARKER), "utf8").trim().split(" ");
  } catch {
    return false;
  }
  if (!pid || Number(marker[0]) !== pid) {
    return false;
  }
  try {
    process.kill(pid, 0);
  } catch (error) {
    return /** @type {NodeJS.ErrnoException} */ (error).code === "ESRCH";
  }
  const now = startTime(pid);
  return now !== null && marker[1] !== undefined && marker[1] !== "" && marker[1] !== now;
}

/** Removes the leftover guard folders of earlier runs: ours, a day old, their run gone. @param {string} base */
export function removeStale(base, now = Date.now()) {
  let names;
  try {
    names = readdirSync(base).filter((n) => NAME.test(n));
  } catch {
    return;
  }
  for (const name of names) {
    const path = join(base, name);
    try {
      const stat = lstatSync(path);
      if (
        stat.isDirectory() &&
        stat.uid === process.getuid?.() &&
        now - stat.mtimeMs > STALE_MS &&
        abandoned(path, name)
      ) {
        removeTree(path);
      }
    } catch {
      // Gone, or not ours to read.
    }
  }
}

/** Makes the folder (again, when a repetition removed it) with the marker that names this run. @param {string} root */
export function makeRoot(root) {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  try {
    writeFileSync(join(root, MARKER), `${process.pid} ${startTime(process.pid) ?? ""}`, {
      flag: "wx",
    });
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== "EEXIST") {
      throw error;
    }
  }
}

export const PRIVATE_NAME = "house-rules-test-private";

/**
 * A folder only this user can write to, to hold the run folders: the base itself when it is ours and closed to others'
 * writes, else a private subfolder of a base that is sticky (others cannot rename or replace our entries), made 0700 and
 * checked with `lstat` (ours, a folder, closed to others, not a link). Null when neither holds; the guard then stays off.
 * @param {string} base
 * @returns {string | null}
 */
export function privateBase(base) {
  const uid = process.getuid?.();
  try {
    const stat = lstatSync(base);
    if (!stat.isDirectory()) {
      return null;
    }
    if (stat.uid === uid && (stat.mode & 0o022) === 0) {
      return base;
    }
    if ((stat.mode & 0o1000) === 0) {
      return null;
    }
    const own = join(base, `${PRIVATE_NAME}-${uid}`);
    try {
      mkdirSync(own, { mode: 0o700 });
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== "EEXIST") {
        throw error;
      }
    }
    const mine = lstatSync(own);
    return mine.isDirectory() && mine.uid === uid && (mine.mode & 0o077) === 0 ? own : null;
  } catch {
    return null;
  }
}

/** The run's private folder, or null where the guard is not active. */
export const GUARD_ROOT = await (async () => {
  if (!process.versions.bun || process.platform === "win32") {
    return null;
  }
  const base = privateBase(process.env.HOUSE_RULES_TEST_TMP || tmpdir());
  if (base === null) {
    return null;
  }
  removeStale(base);
  const root = mkdtempSync(join(base, `${PREFIX}${process.pid}-`));
  makeRoot(root);
  process.env.TMPDIR = root;
  process.env.HOUSE_RULES_TEST_TMP = root;
  const finish = () => removeTree(root);
  process.on("exit", finish);
  for (const [signal, code] of /** @type {const} */ ([
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ])) {
    process.on(signal, () => {
      finish();
      process.exit(code);
    });
  }
  // `bun test` may end without an exit event, so the end of the last test file removes it too; before every test the
  // folder is made again when an earlier repetition (`--rerun-each`) removed it.
  const { afterAll, beforeEach } = await import("bun:test");
  afterAll(finish);
  beforeEach(() => makeRoot(root));
  return root;
})();
