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
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
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

/**
 * Write several files so that a failure leaves none of them changed: every output is staged first, then the
 * renames run back to back, and a failed rename puts the earlier files back.
 * @param {Array<[string, unknown]>} outputs
 */
export function writeAll(outputs) {
  const stage = mkdtempSync(join(tmpdir(), "refresh-recommendations-"));
  try {
    const staged = outputs.map(([path, value], i) => {
      const file = join(stage, String(i));
      writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
      return { path, file, before: existsSync(path) ? readFileSync(path, "utf8") : undefined };
    });
    const done = [];
    try {
      for (const item of staged) {
        copyFileSync(item.file, `${item.path}.new`);
        renameSync(`${item.path}.new`, item.path);
        done.push(item);
      }
    } catch (error) {
      for (const item of done) {
        if (item.before === undefined) {
          rmSync(item.path, { force: true });
        } else {
          writeFileSync(item.path, item.before);
        }
      }
      for (const item of staged) {
        rmSync(`${item.path}.new`, { force: true });
      }
      throw error;
    }
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

/**
 * The rows the catalog can use, from a full board: current rows only (a superseded row is the receipt of an
 * earlier figure), with the fields this tool reads.
 * @param {any} board
 * @param {string} fetched
 */
export function reduceBoard(board, fetched) {
  if (!DATE.test(fetched)) {
    throw new Error(`fetched date ${fetched} is not YYYY-MM-DD`);
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
 * The strings an own result may carry: a fixed set of keys, numbers, effort names and one short plain-text
 * cohort line. Anything that could name a private repository, path, case or account is refused; extra words to
 * refuse (private names this repository must not know) come from `deny`.
 * @param {any} input
 * @param {string[]} [deny]
 */
export function sanitizeOwn(input, deny = []) {
  /** @type {string[]} */
  const problems = [];
  if (input?.version !== 1 || !Array.isArray(input.results)) {
    throw new Error("own results: expected { version: 1, results: [...] }");
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
    const text = (/** @type {string} */ key, /** @type {RegExp} */ pattern) => {
      const value = r?.[key];
      if (typeof value !== "string" || !pattern.test(value)) {
        problems.push(`${at}.${key}: not a plain value of the allowed shape`);
        return "";
      }
      if (/api[_-]?key|token|secret|password|passwd|bearer|credential/i.test(value)) {
        problems.push(`${at}.${key}: names a credential`);
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
    const of = number("of", 1, 100000);
    const found = number("found", 0, of);
    return {
      id,
      model: text("model", MODEL),
      harness: text("harness", NAME),
      effort,
      found,
      of,
      falseSharePercent: number("falseSharePercent", 0, 100),
      wallMinutesPerReview: number("wallMinutesPerReview", 0, 100000),
      cohort: text("cohort", PLAIN),
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
  const best = rows.reduce((/** @type {any} */ a, /** @type {any} */ b) =>
    b.fixed > a.fixed ? b : a,
  );
  const fewest = rows.reduce((/** @type {any} */ a, /** @type {any} */ b) =>
    b.fixed < a.fixed ? b : a,
  );
  if (rows.length < 2 || best === fewest) {
    return `${best.effort} fixed ${best.fixed} of ${total} planted bugs.`;
  }
  const gap = round(best.fixed - fewest.fixed);
  if (gap < noisePoints) {
    return `${best.effort} fixed ${best.fixed} and ${fewest.effort} ${fewest.fixed} of ${total}, a gap within the board's run-to-run spread, so the efforts are not distinguishable on fixed bugs.`;
  }
  // A saving is stated only when it is one: a lower-fixing rung that costs more or runs longer says nothing.
  const saved = (/** @type {string} */ key) => {
    const pct =
      best[key] > 0 && fewest[key] !== null && best[key] !== null
        ? Math.round((1 - fewest[key] / best[key]) * 100)
        : 0;
    return pct > 0 ? pct : undefined;
  };
  const cost = saved("costUsd");
  const time = saved("wallMinutes");
  const parts = [
    ...(cost === undefined ? [] : [`${cost}% less cost`]),
    ...(time === undefined ? [] : [`${time}% less time`]),
  ];
  return (
    `${best.effort} fixed the most (${best.fixed} of ${total}); ${fewest.effort} fixed ${gap} fewer` +
    (parts.length > 0 ? ` for ${parts.join(" and ")}` : "") +
    "."
  );
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
 */
export async function fetchBoard(url) {
  const target = new URL(url);
  if (target.protocol !== "https:") {
    throw new Error(`refusing to fetch ${url}: only https`);
  }
  // A redirect would leave the host the spec names, so it is an error, not a hop.
  const response = await fetch(target, { signal: AbortSignal.timeout(30000), redirect: "error" });
  if (!response.ok) {
    throw new Error(`${url} answered ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > MAX_BOARD_BYTES) {
    throw new Error(`${url} is larger than ${MAX_BOARD_BYTES} bytes`);
  }
  return JSON.parse(new TextDecoder().decode(bytes));
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
    if (values.today !== undefined && !DATE.test(values.today)) {
      throw new Error("--today is YYYY-MM-DD");
    }
  } catch (error) {
    console.error(`refresh-recommendations: ${/** @type {Error} */ (error).message}`);
    return 2;
  }
  try {
    const spec = readJson(paths.spec);
    const deny = readDeny(values["deny-file"]);
    let snapshot = readJson(paths.snapshot);
    let own = sanitizeOwn(readJson(paths.own), deny);
    if (values.fetch === true) {
      const board =
        values["board-file"] !== undefined
          ? readJson(resolve(values["board-file"]))
          : await fetchBoard(spec.board.url);
      snapshot = reduceBoard(board, values.today ?? today);
    }
    if (values["from-file"] !== undefined) {
      own = sanitizeOwn(readJson(resolve(values["from-file"])), deny);
    }
    const catalog = buildCatalog(spec, snapshot, own);
    if (values.check === true) {
      const committed = existsSync(paths.catalog) ? readJson(paths.catalog) : undefined;
      if (JSON.stringify(committed) !== JSON.stringify(catalog)) {
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
          `refresh-recommendations: the catalog is not what the snapshot, spec and own results generate (differs: ${[...behind, ...extra].join(", ") || "header"}); run scripts/refresh-recommendations.mjs`,
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
  } catch (error) {
    console.error(`refresh-recommendations: ${/** @type {Error} */ (error).message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await run(process.argv.slice(2));
}
