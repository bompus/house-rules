// Preloaded by `bun test` (bunfig.toml): every test's temporary folder (`os.tmpdir()`, children included) is inside one
// private folder per run, removed when the run ends, so a run leaves nothing in the shared temporary folder. Tests make
// folders closed to their owner on purpose (mode 000), which a plain recursive remove cannot delete. A run that was
// killed leaves its folder; the next run removes those a day old whose run is gone. Linux and macOS only, and not when
// `HOUSE_RULES_TEST_TMP` names a scratch folder (CI), where the runner discards the folder itself.
import { afterAll } from "bun:test";
import {
  chmodSync,
  lstatSync,
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

/** Removes a tree, links as links (never followed), opening each folder to its owner first. @param {string} path */
export function removeTree(path) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    return;
  }
  if (stat.isDirectory()) {
    chmodSync(path, 0o700);
    for (const name of readdirSync(path)) {
      removeTree(join(path, name));
    }
  }
  rmSync(path, { recursive: true, force: true });
}

/** Whether the run that made this guard folder has ended: its marker names a process that no longer exists. @param {string} path @param {string} name */
function abandoned(path, name) {
  const pid = Number(NAME.exec(name)?.[1]);
  try {
    if (Number(readFileSync(join(path, MARKER), "utf8")) !== pid) {
      return false;
    }
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return /** @type {NodeJS.ErrnoException} */ (error).code === "ESRCH";
  }
}

/** Removes the leftover guard folders of earlier runs: ours, a day old, their run gone. @param {string} base */
export function removeStale(base, now = Date.now()) {
  for (const name of readdirSync(base).filter((n) => NAME.test(n))) {
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

if (
  import.meta.main === false &&
  process.platform !== "win32" &&
  !process.env.HOUSE_RULES_TEST_TMP
) {
  const base = tmpdir();
  removeStale(base);
  const root = mkdtempSync(join(base, `${PREFIX}${process.pid}-`));
  writeFileSync(join(root, MARKER), String(process.pid));
  process.env.TMPDIR = root;
  const finish = () => removeTree(root);
  process.on("exit", finish);
  afterAll(finish);
  for (const [signal, code] of /** @type {const} */ ([
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ])) {
    process.on(signal, () => {
      finish();
      process.exit(code);
    });
  }
}
