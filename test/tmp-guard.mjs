// Preloaded by `bun test` (bunfig.toml): every test's temporary folder (`os.tmpdir()`, children included, and
// `HOUSE_RULES_TEST_TMP` for the fixtures that read it) is inside one private folder per run, removed when the run ends,
// so a run leaves nothing in the shared temporary folder. Tests make folders closed to their owner on purpose (mode
// 000), which a plain recursive remove cannot delete. A run that was killed leaves its folder; the next run removes
// guard folders a day old whose run is gone. The folder is made inside `HOUSE_RULES_TEST_TMP` when that is set, else
// the system temporary folder. Active only under Bun on Linux and macOS: `node --test` imports this file for its
// helpers and changes nothing. The temporary folder is assumed private to the user or sticky (as `/tmp` is); a folder
// another user can rename entries in is out of scope.
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
 * Whether the run that made this guard folder has ended: its process is gone, or its id now belongs to a process that
 * started at another time. A marker that names another process is not ours; a missing one (an interrupted cleanup)
 * leaves the process id in the folder's name to go by.
 * @param {string} path @param {string} name
 */
function abandoned(path, name) {
  const pid = Number(NAME.exec(name)?.[1]);
  /** @type {string[]} */
  let marker = [];
  try {
    marker = readFileSync(join(path, MARKER), "utf8").trim().split(" ");
    if (Number(marker[0]) !== pid) {
      return false;
    }
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== "ENOENT") {
      return false;
    }
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

/** The run's private folder, or null where the guard is not active. */
export const GUARD_ROOT = await (async () => {
  if (!process.versions.bun || process.platform === "win32") {
    return null;
  }
  const base = process.env.HOUSE_RULES_TEST_TMP || tmpdir();
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
