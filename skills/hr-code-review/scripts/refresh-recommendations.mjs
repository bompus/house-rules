// Regenerates references/panel-recommendations.json from the Bug Hunt board snapshot, the source
// spec and the sanitized own-results file, so the catalog follows its evidence and is not
// edited by hand.
//
//   bun scripts/refresh-recommendations.mjs                    regenerate the catalog from the committed files
//   bun scripts/refresh-recommendations.mjs --fetch            read the public board, rewrite the snapshot, regenerate
//   bun scripts/refresh-recommendations.mjs --fetch --board-file board.json   the same from a saved board file
//   bun scripts/refresh-recommendations.mjs --from-file own.json [--deny-file words.txt]
//                                                              sanitize own results, rewrite the own file, regenerate
//   bun scripts/refresh-recommendations.mjs --check [--deny-file words.txt]
//                                                              offline: fail when the catalog is not what the
//                                                              committed files generate; no clock, no network
//
// Any other argument, a conflicting pair of modes or an empty value is an error (exit 2).
import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const skill = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const refs = join(skill, "references");
/** @param {string} dir the references folder */
export const pathsIn = (dir) => ({
  spec: join(dir, "panel-recommendations.sources.json"),
  snapshot: join(dir, "panel-board-snapshot.json"),
  own: join(dir, "panel-recommendations.own.json"),
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

/**
 * Write several files of one folder so that a failure leaves none of them changed. Every output and every
 * before image is staged in a new directory this call creates beside the targets (same filesystem); the
 * renames then run back to back, and a failed rename puts the earlier files back. Nothing outside that
 * directory is created, so an existing file of any name survives, and only that directory is removed.
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
  try {
    const staged = outputs.map(([path, value], i) => {
      const file = join(stage, `new-${i}`);
      writeFileSync(file, serialize(value), { flag: "wx" });
      /** @type {string | undefined} */
      let back;
      if (existsSync(path)) {
        back = join(stage, `old-${i}`);
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
          renameSync(item.back, item.path);
        }
      }
      throw error;
    }
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

/**
 * Run `fn` holding the folder's refresh lock, so two refreshes cannot interleave their read-build-write.
 * A second refresh fails with a message that says to retry; a lock left by a dead process is taken over.
 * @template T
 * @param {string} dir
 * @param {() => Promise<T>} fn
 */
async function withLock(dir, fn) {
  const lock = join(dir, ".refresh.lock");
  /** @type {number | undefined} */
  let fd;
  for (let attempt = 0; fd === undefined; attempt++) {
    try {
      fd = openSync(lock, "wx");
      writeFileSync(fd, `${process.pid}\n`);
    } catch (error) {
      if (/** @type {any} */ (error).code !== "EEXIST") {
        throw error;
      }
      const owner = Number.parseInt(readFileSync(lock, "utf8"), 10);
      let alive = true;
      try {
        process.kill(owner, 0);
      } catch (e) {
        alive = /** @type {any} */ (e).code === "EPERM";
      }
      if (alive || attempt > 0) {
        throw new Error(
          `another refresh holds ${lock} (process ${owner}); retry when it has finished`,
          { cause: error },
        );
      }
      rmSync(lock, { force: true });
    }
  }
  try {
    return await fn();
  } finally {
    closeSync(fd);
    rmSync(lock, { force: true });
  }
}

/**
 * The rows the catalog can use, from a full board: current rows only (a superseded row is the receipt of an
 * earlier figure), with the fields this tool reads.
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
      return r;
    })
    .map((/** @type {any} */ r) => ({
      model: String(r.model),
      harness: String(r.harness),
      effort: String(r.effort),
      runs: Number(r.n_runs),
      fixed: Number(r.fixed),
      wallMinutes: typeof r.wall_min === "number" ? r.wall_min : null,
      costUsd: typeof r.cost_usd === "number" && r.cost_kind === "list" ? r.cost_usd : null,
      date: String(r.date),
    }));
  for (const row of rows) {
    if (!Number.isFinite(row.runs) || !Number.isFinite(row.fixed) || !isDate(row.date)) {
      throw new Error(`board row ${row.model} ${row.effort} has a figure this tool cannot read`);
    }
  }
  return {
    version: 1,
    fetched,
    boardUpdated: String(board.meta.updated ?? "unknown"),
    plantedTotal: board.meta.planted_total,
    rows: rows.toSorted(
      (/** @type {any} */ a, /** @type {any} */ b) =>
        order(a.model, b.model) || order(a.harness, b.harness) || order(a.effort, b.effort),
    ),
  };
}

/**
 * Whether a published text looks like a credential, an address or a host: an assignment-style word, a
 * provider key prefix, a long hex run, an IPv4 or IPv6 address, or (for free text) a host name or a very long
 * token with digits.
 * @param {string} value
 * @param {boolean} [freeText] a cohort or harness line, where a host name or long token can hide
 */
export function looksSecret(value, freeText = false) {
  if (/api[_-]?key|token|secret|password|passwd|bearer|credential/i.test(value)) {
    return true;
  }
  if (
    /(?:^|[^A-Za-z0-9])(?:sk|pk|rk|ghp|gho|ghu|ghs|github_pat|xox[a-z]|AKIA|ASIA|AIza|eyJ)[-_A-Za-z0-9]{6,}/.test(
      value,
    ) ||
    /\b[0-9a-f]{16,}\b/i.test(value) ||
    /\b\d{1,3}(?:\.\d{1,3}){3}\b/.test(value) ||
    (value.match(/:/g) ?? []).length >= 2
  ) {
    return true;
  }
  return (
    freeText &&
    (/[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/.test(value) ||
      value.split(/\s+/).some((token) => token.length >= 24 && /\d/.test(token)))
  );
}

/**
 * The strings an own result may carry: a fixed set of keys, numbers, effort names and one short plain-text
 * cohort line. Anything that could name a private repository, path, case or account is refused; extra words to
 * refuse (private names this repository must not know) come from `deny`.
 * @param {any} input
 * @param {string[]} [deny]
 */
export function sanitizeOwn(input, deny = []) {
  /** @type {string[]} */
  const problems = [];
  if (
    input?.version !== 1 ||
    !Array.isArray(input.results) ||
    Object.keys(input).some((key) => key !== "version" && key !== "results")
  ) {
    throw new Error("own results: expected exactly { version: 1, results: [...] }");
  }
  const keys = new Set([
    "id",
    "model",
    "harness",
    "effort",
    "found",
    "of",
    "falseSharePercent",
    "wallMinutesPerReview",
    "cohort",
    "checked",
  ]);
  const ID = /^[a-z0-9][a-z0-9-]{1,60}$/;
  const MODEL = /^[a-z0-9][a-z0-9.-]{1,60}$/;
  const PLAIN = /^[A-Za-z0-9][A-Za-z0-9 ,.%()+:;'-]{0,139}$/;
  const NAME = /^[A-Za-z0-9][A-Za-z0-9 .+-]{0,39}$/;
  // Compared with case, spacing and punctuation removed, so "Internal Tool" and "internal_tool" match "internal-tool".
  const squash = (/** @type {string} */ s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const lowered = deny.map(squash).filter((w) => w !== "");
  const seen = new Set();
  const results = input.results.map((/** @type {any} */ r, /** @type {number} */ i) => {
    const at = `results[${i}]`;
    for (const key of Object.keys(r ?? {})) {
      if (!keys.has(key)) {
        problems.push(`${at}: field ${key} is not allowed`);
      }
    }
    const text = (/** @type {string} */ key, /** @type {RegExp} */ pattern, freeText = false) => {
      const value = r?.[key];
      if (typeof value !== "string" || !pattern.test(value)) {
        problems.push(`${at}.${key}: not a plain value of the allowed shape`);
        return "";
      }
      if (looksSecret(value, freeText)) {
        problems.push(`${at}.${key}: looks like a credential, address or host`);
      }
      for (const word of lowered) {
        if (squash(value).includes(word)) {
          problems.push(`${at}.${key}: contains a name this repository must not carry`);
        }
      }
      return value;
    };
    const number = (
      /** @type {string} */ key,
      /** @type {number} */ min,
      /** @type {number} */ max,
    ) => {
      const value = r?.[key];
      if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
        problems.push(`${at}.${key}: expected a number from ${min} to ${max}`);
        return 0;
      }
      return value;
    };
    const checked = text("checked", DATE);
    if (checked !== "" && !isDate(checked)) {
      problems.push(`${at}.checked: not a real date`);
    }
    const id = text("id", ID);
    if (seen.has(id)) {
      problems.push(`${at}.id: duplicate ${id}`);
    }
    seen.add(id);
    const effort = r?.effort;
    if (!EFFORTS.includes(effort)) {
      problems.push(`${at}.effort: not one of ${EFFORTS.join(", ")}`);
    }
    // The published id and every string built from the fields are screened as published, not as entered.
    for (const word of lowered) {
      if (squash(`own-${id}`).includes(word) || squash(String(effort)).includes(word)) {
        problems.push(
          `${at}: the published id or effort contains a name this repository must not carry`,
        );
      }
    }
    const of = number("of", 1, 100000);
    const found = number("found", 0, of);
    return {
      id,
      model: text("model", MODEL),
      harness: text("harness", NAME, true),
      effort,
      found,
      of,
      falseSharePercent: number("falseSharePercent", 0, 100),
      wallMinutesPerReview: number("wallMinutesPerReview", 0, 100000),
      cohort: text("cohort", PLAIN, true),
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
    id: `own-${r.id}`,
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
    samples: `${r.of} known defects across ${r.cohort}`,
    metric: `known defects found, out of ${r.of}; false findings as a share of posted comments`,
    timeDefinition: spec.own.timeDefinition,
    costDefinition: "unknown",
    limitations: spec.own.limitations,
    rationale: `Found ${r.found} of ${r.of} (${Math.round((r.found / r.of) * 100)}%) with ${r.falseSharePercent}% false findings in ${r.wallMinutesPerReview} minutes a review. ${spec.own.rationaleTail}`,
    status: "current",
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
  const spec = readJson(paths.spec);
  const deny = readDeny(values["deny-file"]);
  const rawSnapshot = values.fetch === true ? undefined : readFileSync(paths.snapshot, "utf8");
  let snapshot = rawSnapshot === undefined ? undefined : JSON.parse(rawSnapshot);
  if (values.fetch === true) {
    const board =
      values["board-file"] !== undefined
        ? readJson(resolve(values["board-file"]))
        : await fetchBoard(spec.board.url);
    snapshot = reduceBoard(board, values.today ?? today);
  }
  const rawOwn =
    values["from-file"] === undefined && existsSync(paths.own)
      ? readFileSync(paths.own, "utf8")
      : undefined;
  const own =
    values["from-file"] !== undefined
      ? sanitizeOwn(readJson(resolve(values["from-file"])), deny)
      : rawOwn === undefined
        ? { version: 1, results: [] }
        : sanitizeOwn(JSON.parse(rawOwn), deny);
  const catalog = buildCatalog(spec, snapshot, own);
  // Every string published for an own result is screened as published, assembled text included.
  for (const entry of catalog.entries.filter(
    (/** @type {any} */ e) => e.kind === "own-evaluation",
  )) {
    const flat = JSON.stringify(entry)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    for (const word of deny.map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, "")).filter(Boolean)) {
      if (flat.includes(word)) {
        throw new Error(`catalog entry ${entry.id} contains a name this repository must not carry`);
      }
    }
  }
  if (values.check === true) {
    // The committed bytes, not their parse: an extra field or a shadowed duplicate key is a difference.
    const committed = existsSync(paths.catalog) ? readFileSync(paths.catalog, "utf8") : undefined;
    const files = [
      ["catalog", committed, serialize(catalog)],
      ["snapshot", rawSnapshot, serialize(snapshot)],
      ...(rawOwn === undefined ? [] : [["own results", rawOwn, serialize(own)]]),
    ];
    const off = files.filter(([, have, want]) => have !== want);
    if (off.length > 0) {
      const parsed = committed === undefined ? undefined : JSON.parse(committed);
      const ids = new Set(catalog.entries.map((/** @type {any} */ e) => e.id));
      const behind = catalog.entries
        .filter(
          (/** @type {any} */ e) =>
            JSON.stringify(e) !==
            JSON.stringify(parsed?.entries?.find((/** @type {any} */ c) => c.id === e.id)),
        )
        .map((/** @type {any} */ e) => e.id);
      const extra = (parsed?.entries ?? [])
        .filter((/** @type {any} */ c) => !ids.has(c.id))
        .map((/** @type {any} */ c) => c.id);
      console.error(
        `refresh-recommendations: not what the committed inputs generate: ${off.map(([name]) => name).join(", ")} (entries: ${[...behind, ...extra].join(", ") || "none; bytes, extra fields or duplicate keys"}); run scripts/refresh-recommendations.mjs`,
      );
      return 1;
    }
    console.log(`refresh-recommendations: catalog matches (${catalog.entries.length} entries)`);
    return 0;
  }
  /** @type {Array<[string, unknown]>} */
  const outputs = [[paths.catalog, catalog]];
  if (values.fetch === true) {
    outputs.unshift([paths.snapshot, snapshot]);
  }
  if (values["from-file"] !== undefined) {
    outputs.unshift([paths.own, own]);
  }
  writeAll(outputs);
  console.log(`refresh-recommendations: wrote the catalog (${catalog.entries.length} entries)`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await run(process.argv.slice(2));
}
