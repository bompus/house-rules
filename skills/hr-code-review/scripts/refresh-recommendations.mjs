// Regenerates references/panel-recommendations.json from the Bug Hunt board snapshot, the source spec and the
// maintainer's own results, so the catalog follows its evidence and is not edited by hand. The own results live
// only inside the catalog (each own entry carries the structured facts it is generated from), so importing them
// rewrites one file.
//
//   bun scripts/refresh-recommendations.mjs                    regenerate the catalog from the committed files
//   bun scripts/refresh-recommendations.mjs --fetch            read the public board, rewrite the snapshot, regenerate
//   bun scripts/refresh-recommendations.mjs --fetch --board-file board.json   the same from a saved board file
//   bun scripts/refresh-recommendations.mjs --from-file own.json --deny-file words.txt
//                                                              replace the own results with the file's (validated,
//                                                              structured), regenerate
//   bun scripts/refresh-recommendations.mjs --check [--deny-file words.txt]
//                                                              offline: fail when the catalog is not what the
//                                                              committed files generate; no clock, no network
//
// Any other argument, a conflicting pair of modes or an empty value is an error (exit 2).
import {
  existsSync,
  linkSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const skill = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const refs = join(skill, "references");
/** @param {string} dir the references folder */
export const pathsIn = (dir) => ({
  // Raw own results are never kept in the skill folder; a file here is a leftover of an earlier layout.
  obsoleteOwn: join(dir, "panel-recommendations.own.json"),
  spec: join(dir, "panel-recommendations.sources.json"),
  snapshot: join(dir, "panel-board-snapshot.json"),
  catalog: join(dir, "panel-recommendations.json"),
});

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** @param {unknown} value a YYYY-MM-DD string that is a real calendar date */
const isDate = (value) => {
  if (typeof value !== "string" || !DATE.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
/** Locale-free order, so a snapshot sorts the same on every machine. */
const order = (/** @type {string} */ a, /** @type {string} */ b) => (a < b ? -1 : a > b ? 1 : 0);
const EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra", "default"];
const MAX_BOARD_BYTES = 20 * 1024 * 1024;

/** @param {string} path */
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

/** The one byte layout every JSON file here is written in, so --check can compare bytes. */
export const serialize = (/** @type {unknown} */ value) => `${JSON.stringify(value, null, 2)}\n`;

// A work directory of this tool is `.refresh-<six characters>` holding this marker file and `new-<n>` files only;
// that is the whole of what a later run reclaims.
const TRANSACTION_MARKER = ".transaction";
const TRANSACTION_TEXT = "refresh-recommendations transaction\n";
/** @param {string} dir the references folder */
function reclaimAbandoned(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (!/^\.refresh-[A-Za-z0-9]{6}$/.test(name) || !statSync(path).isDirectory()) {
      continue;
    }
    const inside = readdirSync(path);
    if (
      inside.includes(TRANSACTION_MARKER) &&
      readFileSync(join(path, TRANSACTION_MARKER), "utf8") === TRANSACTION_TEXT &&
      inside.every((n) => n === TRANSACTION_MARKER || /^new-\d+$/.test(n))
    ) {
      rmSync(path, { recursive: true, force: true });
    }
  }
}

/**
 * Write several files of one folder so that a failure leaves none of them changed. The new contents are staged
 * in a new directory beside the targets (same filesystem, so each rename is atomic); the before images, which
 * may hold data a replacement removes, go to a private directory outside the skill folder, so no copy of the
 * skill ever carries them. The renames then run back to back, and a failed rename puts the earlier files back.
 * Readers consume only the catalog, which goes last: an interruption leaves the old catalog complete, and
 * --check reports the sources that are ahead of it until a plain run regenerates it.
 * @param {Array<[string, unknown]>} outputs
 */
export function writeAll(outputs) {
  const dir = dirname(outputs[0]?.[0] ?? ".");
  if (outputs.some(([path]) => dirname(path) !== dir)) {
    throw new Error("the outputs must be in one folder");
  }
  const stage = mkdtempSync(join(dir, ".refresh-"));
  writeFileSync(join(stage, TRANSACTION_MARKER), TRANSACTION_TEXT, { flag: "wx" });
  const backups = mkdtempSync(join(tmpdir(), "refresh-recommendations-"));
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
    const done = [];
    try {
      for (const item of staged) {
        renameSync(item.file, item.path);
        done.push(item);
      }
    } catch (error) {
      for (const item of done) {
        if (item.back === undefined) {
          rmSync(item.path, { force: true });
        } else {
          // The before image lives on another filesystem, so it is copied back, not renamed.
          writeFileSync(item.path, readFileSync(item.back));
        }
      }
      throw error;
    }
  } finally {
    rmSync(stage, { recursive: true, force: true });
    rmSync(backups, { recursive: true, force: true });
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
  /** @param {string} path the owner's pid, "gone" when the file vanished, "unreadable" otherwise */
  const ownerOf = (path) => {
    try {
      const owner = Number(readFileSync(path, "utf8").trim().split(/\s+/)[0]);
      return Number.isInteger(owner) && owner > 0 ? owner : "unreadable";
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
      let alive = true;
      try {
        process.kill(owner, 0);
      } catch (error) {
        alive = /** @type {any} */ (error).code === "EPERM";
      }
      if (alive || attempt >= 5) {
        throw busy(`process ${owner}`);
      }
      await hooks.afterRead?.();
      if (!claim(takeover)) {
        throw busy(`a stale lock is being recovered; remove ${takeover} if no refresh is running`);
      }
      try {
        if (ownerOf(lock) === owner) {
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

// Compared with case, spacing and punctuation removed, so "Internal Tool" and "internal_tool" match "internal-tool".
const squash = (/** @type {string} */ s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
/** @param {unknown} v a finite number that is not negative */
const nonNegative = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;
const SNAPSHOT_KEYS = ["version", "fetched", "boardUpdated", "plantedTotal", "rows"];
const ROW_KEYS = ["model", "harness", "effort", "runs", "fixed", "wallMinutes", "costUsd", "date"];
/** @param {any} a @param {any} b a total order, so a snapshot has one byte layout */
const rowOrder = (a, b) =>
  order(a.model, b.model) ||
  order(a.harness, b.harness) ||
  order(a.effort, b.effort) ||
  order(b.date, a.date) ||
  b.runs - a.runs ||
  b.fixed - a.fixed ||
  (a.wallMinutes ?? -1) - (b.wallMinutes ?? -1) ||
  (a.costUsd ?? -1) - (b.costUsd ?? -1);

/**
 * The one snapshot shape: exactly these fields, real dates, integer run counts of at least one, fixed bug means
 * between zero and the planted total, nonnegative times and prices, and rows in one canonical order. A snapshot
 * read from disk and a freshly reduced board both pass through here, so neither can hold a value the other
 * could not.
 * @param {any} snap
 */
export function canonicalSnapshot(snap) {
  const fail = (/** @type {string} */ why) => {
    throw new Error(`the board snapshot ${why}`);
  };
  if (snap === null || typeof snap !== "object" || Array.isArray(snap)) {
    fail("is not an object");
  }
  const extra = Object.keys(snap).filter((k) => !SNAPSHOT_KEYS.includes(k));
  if (extra.length > 0 || SNAPSHOT_KEYS.some((k) => !(k in snap))) {
    fail(`must have exactly the fields ${SNAPSHOT_KEYS.join(", ")}`);
  }
  if (snap.version !== 1) {
    fail("has an unknown version");
  }
  if (!isDate(snap.fetched)) {
    fail(`has a fetched date ${snap.fetched} that is not a real YYYY-MM-DD date`);
  }
  if (typeof snap.boardUpdated !== "string") {
    fail("has no boardUpdated text");
  }
  if (!Number.isInteger(snap.plantedTotal) || snap.plantedTotal < 1) {
    fail("has a planted total that is not a positive integer");
  }
  if (!Array.isArray(snap.rows)) {
    fail("has no rows list");
  }
  const rows = snap.rows.map((/** @type {any} */ r) => {
    const at = `row ${r?.model} ${r?.effort}`;
    if (
      r === null ||
      typeof r !== "object" ||
      Object.keys(r).length !== ROW_KEYS.length ||
      ROW_KEYS.some((k) => !(k in r))
    ) {
      fail(`${at} must have exactly the fields ${ROW_KEYS.join(", ")}`);
    }
    for (const key of ["model", "harness", "effort"]) {
      if (typeof r[key] !== "string" || r[key] === "") {
        fail(`${at} has no ${key}`);
      }
    }
    if (!Number.isInteger(r.runs) || r.runs < 1) {
      fail(`${at} has a run count that is not a positive integer`);
    }
    if (!nonNegative(r.fixed) || r.fixed > snap.plantedTotal) {
      fail(`${at} has a fixed mean outside 0 to ${snap.plantedTotal}`);
    }
    for (const key of ["wallMinutes", "costUsd"]) {
      if (r[key] !== null && !nonNegative(r[key])) {
        fail(`${at} has a ${key} that is neither null nor a nonnegative number`);
      }
    }
    if (!isDate(r.date)) {
      fail(`${at} has a date that is not a real YYYY-MM-DD date`);
    }
    return Object.fromEntries(ROW_KEYS.map((k) => [k, r[k]]));
  });
  return {
    version: 1,
    fetched: snap.fetched,
    boardUpdated: snap.boardUpdated,
    plantedTotal: snap.plantedTotal,
    rows: rows.toSorted(rowOrder),
  };
}

/**
 * The rows the catalog can use, from a full board: current rows only (a superseded row is the receipt of an
 * earlier figure), with the fields this tool reads, validated by the snapshot schema.
 * @param {any} board
 * @param {string} fetched
 */
export function reduceBoard(board, fetched) {
  if (!isDate(fetched)) {
    throw new Error(`fetched date ${fetched} is not a real YYYY-MM-DD date`);
  }
  if (!Array.isArray(board?.runs) || typeof board?.meta?.planted_total !== "number") {
    throw new Error("the board file has no runs list or planted total: its layout changed");
  }
  const rows = board.runs
    .filter((/** @type {any} */ r) => r.superseded === null || r.superseded === undefined)
    .map((/** @type {any} */ r) => {
      if (typeof r.fixed !== "number" || typeof r.n_runs !== "number") {
        throw new Error(`board row ${r.model} ${r.effort} has a figure this tool cannot read`);
      }
      return {
        model: String(r.model),
        harness: String(r.harness),
        effort: String(r.effort),
        runs: r.n_runs,
        fixed: r.fixed,
        wallMinutes: typeof r.wall_min === "number" ? r.wall_min : null,
        costUsd: typeof r.cost_usd === "number" && r.cost_kind === "list" ? r.cost_usd : null,
        date: String(r.date),
      };
    });
  return canonicalSnapshot({
    version: 1,
    fetched,
    boardUpdated: String(board.meta.updated ?? "unknown"),
    plantedTotal: board.meta.planted_total,
    rows,
  });
}

const CASE_SETS = /** @type {Record<string, string>} */ ({
  "held-out": "held-out",
  development: "development",
  mixed: "development and held-out",
});
const JUDGING = /** @type {Record<string, string>} */ ({
  "blind-second-model": "judged blind by a second model",
  "one-model": "judged by one model",
  "two-models": "judged by two models",
  person: "judged by a person",
});
const OWN_KEYS = [
  "model",
  "harness",
  "effort",
  "found",
  "of",
  "falseSharePercent",
  "wallMinutesPerReview",
  "cases",
  "caseSet",
  "judging",
  "checked",
];

/**
 * The facts an own result may state, and nothing else: no free text reaches the public catalog. The model and the
 * harness must be names the source spec lists; the effort, the case set and the judging are fixed choices; the
 * rest are bounded numbers and a date. The cohort wording and the result's id are built from those facts, so
 * nothing a maintainer types can carry a name, a host or a credential into a public file.
 * @param {any} input { version: 1, results: [...] }
 * @param {{ models: string[], harnesses: string[] }} vocabulary
 */
export function sanitizeOwn(input, vocabulary) {
  /** @type {string[]} */
  const problems = [];
  if (
    input?.version !== 1 ||
    !Array.isArray(input.results) ||
    Object.keys(input).some((key) => key !== "version" && key !== "results")
  ) {
    throw new Error("own results: expected exactly { version: 1, results: [...] }");
  }
  const seen = new Set();
  const results = input.results.map((/** @type {any} */ r, /** @type {number} */ i) => {
    const at = `results[${i}]`;
    const keys = Object.keys(r ?? {});
    for (const key of keys.filter((k) => !OWN_KEYS.includes(k))) {
      problems.push(`${at}: field ${key} is not allowed`);
    }
    for (const key of OWN_KEYS.filter((k) => !keys.includes(k))) {
      problems.push(`${at}: field ${key} is missing`);
    }
    const choice = (/** @type {string} */ key, /** @type {string[]} */ allowed) => {
      if (typeof r?.[key] !== "string" || !allowed.includes(r[key])) {
        problems.push(`${at}.${key}: not one of ${allowed.join(", ")}`);
        return "";
      }
      return r[key];
    };
    const number = (
      /** @type {string} */ key,
      /** @type {number} */ min,
      /** @type {number} */ max,
      integer = false,
    ) => {
      const value = r?.[key];
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < min ||
        value > max ||
        (integer && !Number.isInteger(value))
      ) {
        problems.push(
          `${at}.${key}: expected ${integer ? "an integer" : "a number"} from ${min} to ${max}`,
        );
        return 0;
      }
      return value;
    };
    const model = choice("model", vocabulary.models);
    const harness = choice("harness", vocabulary.harnesses);
    const effort = choice("effort", EFFORTS);
    const caseSet = choice("caseSet", Object.keys(CASE_SETS));
    const of = number("of", 1, 100000, true);
    const checked = typeof r?.checked === "string" && isDate(r.checked) ? r.checked : "";
    if (checked === "") {
      problems.push(`${at}.checked: not a real YYYY-MM-DD date`);
    }
    const id = `${model}-${effort}-${caseSet}`;
    if (seen.has(id)) {
      problems.push(`${at}: a second ${model} ${effort} ${caseSet} result`);
    }
    seen.add(id);
    return {
      model,
      harness,
      effort,
      found: number("found", 0, of, true),
      of,
      falseSharePercent: number("falseSharePercent", 0, 100),
      wallMinutesPerReview: number("wallMinutesPerReview", 0, 100000),
      cases: number("cases", 1, 100000, true),
      caseSet,
      judging: choice("judging", Object.keys(JUDGING)),
      checked,
    };
  });
  if (problems.length > 0) {
    throw new Error(`own results refused:\n${problems.join("\n")}`);
  }
  return { version: 1, results };
}

/** @param {number} n */
const round = (n) => Math.round(n * 10) / 10;

/**
 * The newest current row for each wanted effort; a wanted effort with no row is an error naming it.
 * @param {any} snapshot
 * @param {any} entry
 */
function boardRows(snapshot, entry) {
  return entry.efforts.map((/** @type {string} */ effort) => {
    const candidates = snapshot.rows
      .filter(
        (/** @type {any} */ r) =>
          r.model === entry.boardModel && r.harness === entry.boardHarness && r.effort === effort,
      )
      .toSorted(
        (/** @type {any} */ a, /** @type {any} */ b) => order(b.date, a.date) || b.runs - a.runs,
      );
    if (candidates.length === 0) {
      throw new Error(
        `${entry.id}: the board has no current ${entry.boardModel} ${effort} row for ${entry.boardHarness}`,
      );
    }
    return candidates[0];
  });
}

/**
 * @param {any} rows board rows of one entry, in effort order
 * @param {number} total
 * @param {number} noisePoints a gap in fixed bugs below this is run-to-run spread
 */
function boardRationale(rows, total, noisePoints) {
  const sorted = rows.toSorted((/** @type {any} */ a, /** @type {any} */ b) => b.fixed - a.fixed);
  const best = sorted[0];
  if (sorted.length < 2) {
    return `${best.effort} fixed ${best.fixed} of ${total} planted bugs.`;
  }
  // An effort is indistinguishable from the leader when its gap is zero or inside the board's spread.
  const within = (/** @type {any} */ r) => {
    const gap = round(best.fixed - r.fixed);
    return gap === 0 || gap < noisePoints;
  };
  if (sorted.every(within)) {
    const list = sorted.map((/** @type {any} */ r, /** @type {number} */ i) =>
      i === 0 ? `${r.effort} fixed ${r.fixed}` : `${r.effort} ${r.fixed}`,
    );
    const joined =
      list.length === 2 ? list.join(" and ") : `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`;
    return `${joined} of ${total}, a gap within the board's run-to-run spread, so the efforts are not distinguishable on fixed bugs.`;
  }
  // A saving is stated only when it is one: a rung that costs more or runs longer says nothing.
  const saved = (/** @type {any} */ r, /** @type {string} */ key) => {
    const pct =
      best[key] > 0 && r[key] !== null && best[key] !== null
        ? Math.round((1 - r[key] / best[key]) * 100)
        : 0;
    return pct > 0 ? pct : undefined;
  };
  const clauses = sorted.slice(1).map((/** @type {any} */ r) => {
    const cost = saved(r, "costUsd");
    const time = saved(r, "wallMinutes");
    const parts = [
      ...(cost === undefined ? [] : [`${cost}% less cost`]),
      ...(time === undefined ? [] : [`${time}% less time`]),
    ];
    const head = within(r)
      ? `${r.effort} (${r.fixed}) is within the board's run-to-run spread of it`
      : `${r.effort} fixed ${round(best.fixed - r.fixed)} fewer`;
    return head + (parts.length > 0 ? ` for ${parts.join(" and ")}` : "");
  });
  return `${best.effort} fixed the most (${best.fixed} of ${total}); ${clauses.join("; ")}.`;
}

/**
 * The whole catalog from its three inputs. Pure: the same inputs give the same catalog.
 * @param {any} spec
 * @param {any} snapshot
 * @param {any} own
 */
export function buildCatalog(spec, snapshot, own) {
  const entries = spec.entries.map((/** @type {any} */ entry) => {
    const rows = boardRows(snapshot, entry);
    const runs = rows.map((/** @type {any} */ r) => r.runs);
    const low = Math.min(...runs);
    const high = Math.max(...runs);
    return {
      id: entry.id,
      kind: "board",
      profiles: entry.profiles,
      task: spec.board.task,
      model: entry.model,
      harness: entry.harness,
      route: entry.route,
      efforts: rows.map((/** @type {any} */ r) => ({
        effort: r.effort,
        fixed: r.fixed,
        listCostUsd: r.costUsd ?? "unknown",
        wallMinutes: r.wallMinutes ?? "unknown",
      })),
      sourceUrl: spec.board.url,
      checked: snapshot.fetched,
      samples: `${low === high ? `${low} runs` : `${low} to ${high} runs`} per effort, current rows; each run covers both repositories`,
      metric: `planted bugs fixed, mean of ${low === high ? low : `${low} to ${high}`}, out of ${snapshot.plantedTotal}`,
      timeDefinition: entry.timeDefinition ?? spec.board.timeDefinition,
      costDefinition: entry.costDefinition ?? spec.board.costDefinition,
      limitations: entry.limitations,
      rationale: `${boardRationale(rows, snapshot.plantedTotal, spec.board.noisePoints)} ${entry.rationaleTail}`,
      status: entry.status ?? "current",
    };
  });
  const ownEntries = own.results.map((/** @type {any} */ r) => ({
    id: `own-${r.model}-${r.effort}-${r.caseSet}`,
    kind: "own-evaluation",
    provenance: "own-evaluation",
    profiles: ["balanced"],
    task: spec.own.task,
    model: r.model,
    harness: r.harness,
    efforts: [
      {
        effort: r.effort,
        found: r.found,
        of: r.of,
        falseSharePercent: r.falseSharePercent,
        wallMinutes: r.wallMinutesPerReview,
      },
    ],
    checked: r.checked,
    samples: `${r.of} known defects across ${r.cases} ${CASE_SETS[r.caseSet]} code changes, ${JUDGING[r.judging]}`,
    metric: `known defects found, out of ${r.of}; false findings as a share of posted comments`,
    timeDefinition: spec.own.timeDefinition,
    costDefinition: "unknown",
    limitations: spec.own.limitations,
    rationale: `Found ${r.found} of ${r.of} (${Math.round((r.found / r.of) * 100)}%) with ${r.falseSharePercent}% false findings in ${r.wallMinutesPerReview} minutes a review. ${spec.own.rationaleTail}`,
    status: "current",
    facts: r,
  }));
  const dates = [snapshot.fetched, ...own.results.map((/** @type {any} */ r) => r.checked)];
  return {
    version: 1,
    reviewed: dates.toSorted().at(-1),
    entries: [...entries, ...ownEntries],
  };
}

/**
 * @param {string} url
 * @param {(url: URL, init: RequestInit) => Promise<Response>} [fetchImpl] replaced by a test
 */
export async function fetchBoard(url, fetchImpl = fetch) {
  const target = new URL(url);
  if (target.protocol !== "https:") {
    throw new Error(`refusing to fetch ${url}: only https`);
  }
  // A redirect would leave the host the spec names, so it is an error, not a hop.
  const response = await fetchImpl(target, {
    signal: AbortSignal.timeout(30000),
    redirect: "error",
  });
  if (!response.ok || response.body === null) {
    throw new Error(
      `${url} answered ${response.status}${response.body === null ? " with no body" : ""}`,
    );
  }
  // Counted as it arrives, and the stream is cancelled at the cap: the rest is never read into memory.
  const reader = response.body.getReader();
  /** @type {Uint8Array[]} */
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.length;
    if (size > MAX_BOARD_BYTES) {
      await reader.cancel();
      throw new Error(`${url} is larger than ${MAX_BOARD_BYTES} bytes`);
    }
    chunks.push(value);
  }
  return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)));
}

/** @param {string | undefined} file */
const readDeny = (file) =>
  file === undefined
    ? []
    : readFileSync(file, "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);

const OPTIONS = /** @type {const} */ ({
  fetch: { type: "boolean" },
  check: { type: "boolean" },
  "from-file": { type: "string" },
  "deny-file": { type: "string" },
  "board-file": { type: "string" },
  today: { type: "string" },
});

/**
 * @param {string[]} argv
 * @param {string} [today]
 * @param {string} [dir] the references folder to read and write
 */
export async function run(argv, today = new Date().toISOString().slice(0, 10), dir = refs) {
  const paths = pathsIn(dir);
  let values;
  try {
    values = parseArgs({
      args: argv,
      options: OPTIONS,
      strict: true,
      allowPositionals: false,
    }).values;
    for (const key of Object.keys(OPTIONS)) {
      const given = argv.filter((a) => a === `--${key}` || a.startsWith(`--${key}=`)).length;
      if (given > 1) {
        throw new Error(`--${key} is given more than once`);
      }
    }
    for (const key of /** @type {const} */ (["from-file", "deny-file", "board-file", "today"])) {
      if (values[key] === "") {
        throw new Error(`--${key} needs a value`);
      }
    }
    if (values["from-file"] !== undefined && values["deny-file"] === undefined) {
      // Fail closed: own results are published, and only the maintainer knows which names are private.
      throw new Error("--from-file needs --deny-file (the names this repository must not carry)");
    }
    const modes = [values.fetch === true, values.check === true, values["from-file"] !== undefined];
    if (modes.filter(Boolean).length > 1) {
      throw new Error("--fetch, --check and --from-file are separate modes");
    }
    if (
      values.check === true &&
      (values["board-file"] !== undefined || values.today !== undefined)
    ) {
      throw new Error("--check reads only the committed files");
    }
    if (
      values.fetch !== true &&
      (values["board-file"] !== undefined || values.today !== undefined)
    ) {
      throw new Error("--board-file and --today go with --fetch");
    }
    if (values.today !== undefined && !isDate(values.today)) {
      throw new Error("--today is a real date, YYYY-MM-DD");
    }
  } catch (error) {
    console.error(`refresh-recommendations: ${/** @type {Error} */ (error).message}`);
    return 2;
  }
  try {
    const check = values.check === true;
    return check
      ? await refresh(paths, values, today)
      : await withLock(dir, () => refresh(paths, values, today));
  } catch (error) {
    console.error(`refresh-recommendations: ${/** @type {Error} */ (error).message}`);
    return 1;
  }
}

/**
 * Read the inputs this mode consumes (a mode that replaces an input does not read the old one), build the
 * catalog and either check it against the committed bytes or write it.
 * @param {ReturnType<typeof pathsIn>} paths
 * @param {Record<string, any>} values
 * @param {string} today
 */
async function refresh(paths, values, today) {
  if (existsSync(paths.obsoleteOwn)) {
    throw new Error(
      `${paths.obsoleteOwn} is an obsolete source: own results live only in the catalog; delete the file (keep the raw results outside the skill folder)`,
    );
  }
  const spec = readJson(paths.spec);
  const deny = readDeny(values["deny-file"]);
  const vocabulary = {
    models: spec.entries.map((/** @type {any} */ e) => e.model),
    harnesses: spec.entries.map((/** @type {any} */ e) => e.harness),
  };
  const rawCatalog = existsSync(paths.catalog) ? readFileSync(paths.catalog, "utf8") : undefined;
  const rawSnapshot = values.fetch === true ? undefined : readFileSync(paths.snapshot, "utf8");
  let snapshot;
  if (values.fetch === true) {
    const board =
      values["board-file"] !== undefined
        ? readJson(resolve(values["board-file"]))
        : await fetchBoard(spec.board.url);
    snapshot = reduceBoard(board, values.today ?? today);
  } else {
    snapshot = canonicalSnapshot(JSON.parse(/** @type {string} */ (rawSnapshot)));
  }
  // The own results are the facts the catalog's own entries carry; an import replaces all of them, so the
  // old ones are not read (a newly denied name in them cannot block their replacement).
  const committed = rawCatalog === undefined ? undefined : JSON.parse(rawCatalog);
  const own = sanitizeOwn(
    values["from-file"] !== undefined
      ? readJson(resolve(values["from-file"]))
      : { version: 1, results: ownFactsOf(committed) },
    vocabulary,
  );
  const catalog = buildCatalog(spec, snapshot, own);
  // Every string of every file this tool publishes, the board snapshot and the whole catalog included, is
  // screened as published: each value on its own, never joined with its neighbours.
  const denied = deny.map(squash).filter(Boolean);
  for (const [name, published] of [
    ["snapshot", snapshot],
    ["catalog", catalog],
  ]) {
    for (const text of stringValues(published)) {
      if (denied.some((word) => squash(text).includes(word))) {
        throw new Error(`the ${name} would publish a name this repository must not carry`);
      }
    }
  }
  // What each file should hold on disk, so --check and a plain run agree on one repair.
  const files = [
    { name: "catalog", path: paths.catalog, have: rawCatalog, want: catalog },
    { name: "snapshot", path: paths.snapshot, have: rawSnapshot, want: snapshot },
  ];
  const off = files.filter((f) => f.have !== serialize(f.want));
  if (values.check === true) {
    if (off.length > 0) {
      const ids = new Set(catalog.entries.map((/** @type {any} */ e) => e.id));
      const behind = catalog.entries
        .filter(
          (/** @type {any} */ e) =>
            JSON.stringify(e) !==
            JSON.stringify(committed?.entries?.find((/** @type {any} */ c) => c.id === e.id)),
        )
        .map((/** @type {any} */ e) => e.id);
      const extra = (committed?.entries ?? [])
        .filter((/** @type {any} */ c) => !ids.has(c.id))
        .map((/** @type {any} */ c) => c.id);
      console.error(
        `refresh-recommendations: not what the committed inputs generate: ${off.map((f) => f.name).join(", ")} (entries: ${[...behind, ...extra].join(", ") || "none; bytes, extra fields, duplicate keys or row order"}); run scripts/refresh-recommendations.mjs, which rewrites each of those files in its canonical form`,
      );
      return 1;
    }
    console.log(`refresh-recommendations: catalog matches (${catalog.entries.length} entries)`);
    return 0;
  }
  // A plain run writes the catalog and the canonical form of the snapshot when it differs; a fetch also writes
  // the snapshot it read. An import writes the catalog alone.
  /** @type {Array<[string, unknown]>} */
  const outputs = [];
  if (values.fetch === true || off.some((f) => f.name === "snapshot")) {
    outputs.push([paths.snapshot, snapshot]);
  }
  outputs.push([paths.catalog, catalog]);
  writeAll(outputs);
  console.log(`refresh-recommendations: wrote the catalog (${catalog.entries.length} entries)`);
  return 0;
}

/**
 * The own facts a committed catalog carries. An entry counts as an own entry by any of its markers (its kind, an
 * `own-` id, or its facts), so damage to one derived field cannot make a plain run drop the measurements: an
 * entry with facts keeps them whatever its kind says, and one that looks like an own entry but has no facts
 * stops the run without changing anything.
 * @param {any} committed
 * @returns {any[]}
 */
function ownFactsOf(committed) {
  /** @type {any[]} */
  const facts = [];
  for (const entry of committed?.entries ?? []) {
    const looksOwn =
      entry?.facts !== undefined ||
      entry?.kind === "own-evaluation" ||
      String(entry?.id).startsWith("own-");
    if (!looksOwn) {
      continue;
    }
    if (entry.facts === null || typeof entry.facts !== "object") {
      throw new Error(
        `catalog entry ${entry?.id} looks like an own result but carries no facts: restore it from version control or import the results again`,
      );
    }
    facts.push(entry.facts);
  }
  return facts;
}

/**
 * @param {unknown} value every string value in a JSON value, not its keys
 * @returns {string[]}
 */
function stringValues(value) {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(stringValues);
  }
  if (value !== null && typeof value === "object") {
    return Object.values(value).flatMap(stringValues);
  }
  return [];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await run(process.argv.slice(2));
}
