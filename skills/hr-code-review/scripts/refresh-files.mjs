// File handling for refresh-recommendations.mjs: a JSON reader that refuses a repeated key, the one byte layout of
// the files it writes, an all-or-nothing multi-file write and the lock that serializes refreshes.
import { createHash } from "node:crypto";
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

/** The one byte layout every JSON file here is written in, so --check can compare bytes. */
export const serialize = (/** @type {unknown} */ value) => `${JSON.stringify(value, null, 2)}\n`;

// A work directory of this tool is `.refresh-<six characters>` holding this marker file and `new-<n>` files only;
// that is the whole of what a later run reclaims.
const TRANSACTION_MARKER = ".transaction";
const TRANSACTION_TEXT = "refresh-recommendations transaction\n";
/**
 * Reclaim the transactions an interrupted run left in the references folder. Nothing is entered or removed
 * recursively: a work folder is the tool's only when it is a real folder holding the marker file and plain
 * `new-<n>` files, each checked without following links; those files are unlinked one by one and the folder is
 * removed with a plain rmdir, which refuses a folder that still holds anything.
 * @param {string} dir the references folder
 */
function reclaimAbandoned(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (!/^\.refresh-[A-Za-z0-9]{6}$/.test(name) || !lstatSync(path).isDirectory()) {
      continue;
    }
    const inside = readdirSync(path, { withFileTypes: true });
    const marker = inside.find((e) => e.name === TRANSACTION_MARKER);
    if (
      marker?.isFile() !== true ||
      readFileSync(join(path, TRANSACTION_MARKER), "utf8") !== TRANSACTION_TEXT ||
      !inside.every(
        (e) => e.isFile() && (e.name === TRANSACTION_MARKER || /^new-\d+$/.test(e.name)),
      )
    ) {
      continue;
    }
    try {
      for (const e of inside.filter((e) => e.name !== TRANSACTION_MARKER)) {
        unlinkSync(join(path, e.name));
      }
      unlinkSync(join(path, TRANSACTION_MARKER));
      rmdirSync(path);
    } catch {
      // Something arrived while cleaning up, or a file is held: leave what is left for the next run.
    }
  }
}

/**
 * Where the before images of a write to this folder go: one private directory per folder, outside the skill
 * folder, so no copy of the skill carries them. The folder's lock is held by whoever writes, so a directory
 * already there is what a run that was killed left behind, and the next write removes it.
 * @param {string} dir the references folder
 */
export const backupDirFor = (dir) =>
  join(
    tmpdir(),
    `refresh-recommendations-${createHash("sha256").update(resolve(dir)).digest("hex").slice(0, 16)}`,
  );

/**
 * Write several files of one folder so that a failure leaves none of them changed. The new contents are staged
 * in a new directory beside the targets (same filesystem, so each rename is atomic); the before images, which
 * may hold data a replacement removes, go to a private directory outside the skill folder (`backupDirFor`). The
 * renames then run back to back, and a failed rename puts the earlier files back, each by staging a copy of its
 * before image beside the target and renaming that over it, so a failure while restoring never leaves a
 * truncated file. When a file cannot be restored the before images are kept and their folder is named in the
 * error. Readers consume only the catalog, which goes last: an interruption leaves the old catalog complete, and
 * --check reports the sources that are ahead of it until a plain run regenerates it.
 * @param {Array<[string, unknown]>} outputs
 * @param {{ rename?: (from: string, to: string) => void }} [io] a test seam for the rename
 */
export function writeAll(outputs, io = {}) {
  const rename = io.rename ?? renameSync;
  const dir = dirname(outputs[0]?.[0] ?? ".");
  if (outputs.some(([path]) => dirname(path) !== dir)) {
    throw new Error("the outputs must be in one folder");
  }
  const stage = mkdtempSync(join(dir, ".refresh-"));
  writeFileSync(join(stage, TRANSACTION_MARKER), TRANSACTION_TEXT, { flag: "wx" });
  const backups = backupDirFor(dir);
  rmSync(backups, { recursive: true, force: true });
  mkdirSync(backups, { mode: 0o700 });
  let keepBackups = /** @type {boolean} */ (false);
  try {
    const staged = outputs.map(([path, value], i) => {
      const file = join(stage, `new-${i}`);
      writeFileSync(file, serialize(value), { flag: "wx" });
      /** @type {string | undefined} */
      let back;
      if (existsSync(path)) {
        back = join(backups, `old-${i}`);
        writeFileSync(back, readFileSync(path), { flag: "wx" });
      }
      return { path, file, back };
    });
    /** @type {typeof staged} */
    const done = [];
    try {
      for (const item of staged) {
        rename(item.file, item.path);
        done.push(item);
      }
    } catch (error) {
      /** @type {string[]} */
      const unrestored = [];
      done.forEach((item, i) => {
        try {
          if (item.back === undefined) {
            rmSync(item.path, { force: true });
          } else {
            // The before image lives on another filesystem: copy it beside the target, then rename it over.
            const copy = join(stage, `new-${outputs.length + i}`);
            writeFileSync(copy, readFileSync(item.back), { flag: "wx" });
            rename(copy, item.path);
          }
        } catch (restoreError) {
          unrestored.push(`${item.path} (${/** @type {Error} */ (restoreError).message})`);
        }
      });
      if (unrestored.length > 0) {
        keepBackups = true;
        const kept = `${backups}-kept-${Date.now()}`;
        renameSync(backups, kept);
        throw new Error(
          `${/** @type {Error} */ (error).message}; could not put back ${unrestored.join(", ")}; the before images are kept in ${kept}`,
          { cause: error },
        );
      }
      throw error;
    }
  } finally {
    rmSync(stage, { recursive: true, force: true });
    if (!keepBackups) {
      rmSync(backups, { recursive: true, force: true });
    }
  }
}

/**
 * Run `fn` holding the folder's refresh lock, so two refreshes cannot interleave their read-build-write.
 * A lock is a hard link to a file that already holds the owner's pid, so it is never seen empty. A refresh that
 * finds a live or unreadable owner fails with a retry message and removes nothing. A dead owner's lock is removed
 * only by the one process that holds the recovery lock (`.refresh.takeover`, claimed the same way), which reads
 * the owner again under it: the lock it removes is the dead owner's, because nobody else removes locks and nobody
 * can link a new one while it exists. A lock is released only by the process whose file it still is.
 * @template T
 * @param {string} dir
 * @param {() => Promise<T>} fn
 * @param {{ afterContended?: () => void | Promise<void>, afterRead?: () => void | Promise<void> }} [hooks]
 *   test seams: after a failed claim, and after the stale owner was read
 */
export async function withLock(dir, fn, hooks = {}) {
  const lock = join(dir, ".refresh.lock");
  const takeover = join(dir, ".refresh.takeover");
  const mine = join(dir, `.refresh.lock.${process.pid}.${Math.random().toString(36).slice(2)}`);
  // The file's content is the owner's pid and a token only this call knows, so ownership is read from content
  // (an inode number is not reliable on every filesystem).
  const content = `${process.pid} ${Math.random().toString(36).slice(2)}\n`;
  writeFileSync(mine, content, { flag: "wx" });
  const busy = (/** @type {string} */ why) =>
    new Error(`another refresh holds ${lock} (${why}); retry when it has finished`);
  /** @param {string} path */
  const claim = (path) => {
    try {
      linkSync(mine, path);
      return true;
    } catch (error) {
      if (/** @type {any} */ (error).code === "EEXIST") {
        return false;
      }
      throw error;
    }
  };
  /**
   * @param {string} path the owner's pid and the whole record (pid and token), "gone" when the file vanished,
   *   "unreadable" otherwise
   * @returns {{ pid: number, record: string } | "gone" | "unreadable"}
   */
  const ownerOf = (path) => {
    try {
      const record = readFileSync(path, "utf8");
      const pid = Number(record.trim().split(/\s+/)[0]);
      return Number.isInteger(pid) && pid > 0 ? { pid, record } : "unreadable";
    } catch (error) {
      if (/** @type {any} */ (error).code === "ENOENT") {
        return "gone";
      }
      throw error;
    }
  };
  /** @param {string} path remove a claim only when it still holds this call's content */
  const release = (path) => {
    try {
      if (readFileSync(path, "utf8") === content) {
        rmSync(path, { force: true });
      }
    } catch {
      // no claim, or not readable: nothing of this call's to remove
    }
  };
  try {
    for (let attempt = 0; !claim(lock); attempt++) {
      await hooks.afterContended?.();
      const owner = ownerOf(lock);
      if (owner === "gone" && attempt < 5) {
        continue; // the holder finished between the failed claim and the read
      }
      if (owner === "gone" || owner === "unreadable") {
        throw busy("its owner cannot be read");
      }
      const isAlive = (/** @type {number} */ pid) => {
        try {
          process.kill(pid, 0);
          return true;
        } catch (error) {
          return /** @type {any} */ (error).code === "EPERM";
        }
      };
      if (isAlive(owner.pid) || attempt >= 5) {
        throw busy(`process ${owner.pid}`);
      }
      await hooks.afterRead?.();
      if (!claim(takeover)) {
        throw busy(`a stale lock is being recovered; remove ${takeover} if no refresh is running`);
      }
      try {
        // Under the recovery lock the lock must still be the record that was observed, whole (a pid alone can be
        // reused by a later holder), and its owner still gone.
        const now = ownerOf(lock);
        if (
          now !== "gone" &&
          now !== "unreadable" &&
          now.record === owner.record &&
          !isAlive(now.pid)
        ) {
          rmSync(lock, { force: true });
        }
      } finally {
        release(takeover);
      }
    }
    reclaimAbandoned(dir);
    return await fn();
  } finally {
    release(lock);
    rmSync(mine, { force: true });
  }
}

/**
 * JSON.parse that refuses a repeated key in any object. The built-in parser keeps the last value of a repeated
 * key and drops the rest, so a merge that leaves two `entries` or two `results` would lose data without a trace
 * before anything is checked.
 * @param {string} text
 * @param {string} [what] named in the error
 * @returns {any}
 */
export function parseStrict(text, what = "JSON") {
  let i = 0;
  /** @param {string} why @returns {never} */
  const fail = (why) => {
    throw new Error(`${what}: ${why} at offset ${i}`);
  };
  const space = () => {
    while (i < text.length && " \t\n\r".includes(text.charAt(i))) {
      i++;
    }
  };
  const string = () => {
    const start = i;
    i++;
    while (i < text.length && text.charAt(i) !== '"') {
      i += text.charAt(i) === "\\" ? 2 : 1;
    }
    if (i >= text.length) {
      fail("unterminated string");
    }
    i++;
    return JSON.parse(text.slice(start, i));
  };
  /** @returns {any} */
  const value = () => {
    space();
    const c = text.charAt(i);
    if (c === "{") {
      i++;
      /** @type {Record<string, any>} */
      const object = Object.create(null);
      space();
      if (text.charAt(i) === "}") {
        i++;
        return object;
      }
      for (;;) {
        space();
        if (text.charAt(i) !== '"') {
          fail("expected a key");
        }
        const key = string();
        if (key in object) {
          fail(`repeated key ${JSON.stringify(key)}`);
        }
        space();
        if (text.charAt(i) !== ":") {
          fail("expected :");
        }
        i++;
        object[key] = value();
        space();
        if (text.charAt(i) === ",") {
          i++;
        } else if (text.charAt(i) === "}") {
          i++;
          return object;
        } else {
          fail("expected , or }");
        }
      }
    }
    if (c === "[") {
      i++;
      /** @type {any[]} */
      const list = [];
      space();
      if (text.charAt(i) === "]") {
        i++;
        return list;
      }
      for (;;) {
        list.push(value());
        space();
        if (text.charAt(i) === ",") {
          i++;
        } else if (text.charAt(i) === "]") {
          i++;
          return list;
        } else {
          fail("expected , or ]");
        }
      }
    }
    if (c === '"') {
      return string();
    }
    const literal = /true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
    literal.lastIndex = i;
    const match = literal.exec(text);
    if (match === null) {
      throw new Error(`${what}: unexpected character at offset ${i}`);
    }
    i += match[0].length;
    return JSON.parse(match[0]);
  };
  const result = value();
  space();
  if (i !== text.length) {
    fail("trailing text");
  }
  return result;
}
