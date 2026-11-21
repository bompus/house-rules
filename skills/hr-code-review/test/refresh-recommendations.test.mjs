import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCatalog,
  fetchBoard,
  pathsIn,
  reduceBoard,
  run,
  sanitizeOwn,
  writeAll,
} from "../scripts/refresh-recommendations.mjs";

const refs = resolve(dirname(fileURLToPath(import.meta.url)), "..", "references");
const real = pathsIn(refs);
/** @param {string} path */
const read = (path) => JSON.parse(readFileSync(path, "utf8"));

/** A references folder copy that a test may write to; removed after the test. */
async function inCopy(/** @type {(dir: string) => Promise<void> | void} */ fn) {
  const dir = mkdtempSync(join(tmpdir(), "refresh-rec-"));
  try {
    for (const path of Object.values(real)) {
      cpSync(path, join(dir, path.slice(refs.length + 1)));
    }
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const silent = async (/** @type {() => Promise<number>} */ fn) => {
  const err = console.error;
  const log = console.log;
  /** @type {string[]} */
  const lines = [];
  console.error = (...a) => void lines.push(a.join(" "));
  console.log = (...a) => void lines.push(a.join(" "));
  try {
    return { code: await fn(), text: lines.join("\n") };
  } finally {
    console.error = err;
    console.log = log;
  }
};

const row = (/** @type {any} */ over = {}) => ({
  model: "Model A",
  vendor: "V",
  harness: "CLI A",
  effort: "high",
  n_runs: 3,
  fixed: 30,
  wall_min: 20,
  cost_usd: 10,
  cost_kind: "list",
  date: "2026-11-01",
  superseded: null,
  ...over,
});
const board = (/** @type {any[]} */ runs) => ({
  meta: { planted_total: 105, updated: "2026-11-02" },
  runs,
});
const spec = {
  board: {
    url: "https://example.org/b.json",
    task: "t",
    timeDefinition: "td",
    costDefinition: "cd",
  },
  own: { task: "ot", timeDefinition: "otd", limitations: "ol", rationaleTail: "ort" },
  entries: [
    {
      id: "a",
      profiles: ["balanced"],
      model: "model-a",
      boardModel: "Model A",
      harness: "CLI A",
      boardHarness: "CLI A",
      route: "r",
      efforts: ["medium", "high"],
      limitations: "l",
      rationaleTail: "tail",
    },
  ],
};

test("the committed catalog is what the snapshot, the spec and the own results generate", async () => {
  const { code, text } = await silent(() => run(["--check"]));
  assert.equal(code, 0, text);
});

test("a superseded row is dropped and the newest current row per effort is used", () => {
  const snap = reduceBoard(
    board([
      row({ effort: "medium", fixed: 20 }),
      row({ effort: "high", fixed: 25, superseded: "Superseded by a later mean" }),
      row({ effort: "high", fixed: 31, date: "2026-11-02" }),
    ]),
    "2026-11-03",
  );
  assert.equal(snap.rows.length, 2);
  const catalog = buildCatalog(spec, snap, { version: 1, results: [] });
  assert.deepEqual(
    catalog.entries[0].efforts.map((/** @type {any} */ e) => [e.effort, e.fixed]),
    [
      ["medium", 20],
      ["high", 31],
    ],
  );
  assert.equal(catalog.entries[0].checked, "2026-11-03");
  assert.equal(catalog.reviewed, "2026-11-03");
  assert.match(
    catalog.entries[0].rationale,
    /high fixed the most \(31 of 105\); medium fixed 11 fewer\./,
  );
});

test("a wanted effort the board no longer lists is an error that names it", () => {
  const snap = reduceBoard(board([row({ effort: "high" })]), "2026-11-03");
  assert.throws(() => buildCatalog(spec, snap, { version: 1, results: [] }), /Model A medium/);
});

test("a board whose layout changed is refused, not guessed at", () => {
  assert.throws(() => reduceBoard({ runs: [] }, "2026-11-03"), /layout changed/);
  assert.throws(() => reduceBoard(board([row({ fixed: "many" })]), "2026-11-03"), /cannot read/);
  assert.throws(() => reduceBoard(board([]), "yesterday"), /YYYY-MM-DD/);
});

const good = {
  id: "astra-62-medium-heldout",
  model: "gpt-6.2-astra",
  harness: "Codex CLI",
  effort: "medium",
  found: 80,
  of: 141,
  falseSharePercent: 0.2,
  wallMinutesPerReview: 2.7,
  cohort: "46 held-out code changes, judged blind by a second model",
  checked: "2026-11-21",
};
const own = (/** @type {any} */ over) => ({ version: 1, results: [{ ...good, ...over }] });

test("a sanitized own result becomes a catalog entry that says whose figure it is", () => {
  const catalog = buildCatalog(
    spec,
    reduceBoard(board([row({ effort: "medium" }), row()]), "2026-11-03"),
    sanitizeOwn(own({})),
  );
  const entry = catalog.entries.at(-1);
  assert.equal(entry.id, "own-astra-62-medium-heldout");
  assert.equal(entry.kind, "own-evaluation");
  assert.equal(entry.provenance, "own-evaluation");
  assert.equal(entry.sourceUrl, undefined);
  assert.equal(entry.efforts[0].found, 80);
  assert.equal(entry.limitations, "ol");
  assert.equal(catalog.reviewed, "2026-11-21");
});

test("own results that could carry a private name, path, address or link are refused", () => {
  const bad = [
    { id: "x/y" },
    { cohort: "cases from acme/widgets" },
    { cohort: "files under /home/someone/cases" },
    { cohort: "reported by someone@example.com" },
    { cohort: "see https://private.example/cases" },
    { cohort: "C:\\cases\\private" },
    { harness: "codex --api-key abc" },
    { model: "Model With Spaces" },
    { effort: "extreme" },
    { found: 200 },
    { falseSharePercent: -1 },
    { wallMinutesPerReview: "2" },
    { extra: "field" },
  ];
  for (const over of bad) {
    assert.throws(() => sanitizeOwn(own(over)), /own results refused/, JSON.stringify(over));
  }
  assert.throws(() => sanitizeOwn({ version: 1, results: [good, good] }), /duplicate/);
  assert.throws(() => sanitizeOwn({ results: [] }), /expected/);
});

test("a name on the deny list is refused wherever it appears, whatever its case", () => {
  assert.throws(
    () => sanitizeOwn(own({ cohort: "46 Held-Out cases of Widget Co changes" }), ["widget co"]),
    /must not carry/,
  );
  assert.doesNotThrow(() => sanitizeOwn(own({}), ["widget co", ""]));
});

test("the committed own results and catalog name no private repository, path, address or credential", () => {
  const text = JSON.stringify([read(real.own), read(real.catalog)]);
  assert.doesNotMatch(text, /\/home\/|\/Users\/|api[_-]?key|token|@/i);
  sanitizeOwn(read(real.own));
});

test("--from-file sanitizes, rewrites the own file and the catalog, and --check then agrees", async () => {
  await inCopy(async (dir) => {
    const file = join(dir, "incoming.json");
    writeFileSync(file, JSON.stringify(own({})));
    const deny = join(dir, "deny.txt");
    writeFileSync(deny, "widget co\n");
    const done = await silent(() =>
      run(["--from-file", file, "--deny-file", deny], "2026-11-21", dir),
    );
    assert.equal(done.code, 0, done.text);
    assert.equal(read(join(dir, "panel-recommendations.own.json")).results.length, 1);
    assert.equal(
      read(join(dir, "panel-recommendations.json")).entries.at(-1).id,
      "own-astra-62-medium-heldout",
    );
    assert.equal((await silent(() => run(["--check"], "2026-11-21", dir))).code, 0);
    // A hand edit of the catalog is what --check exists to catch.
    const catalog = read(join(dir, "panel-recommendations.json"));
    catalog.entries[0].efforts[0].fixed += 1;
    writeFileSync(join(dir, "panel-recommendations.json"), JSON.stringify(catalog));
    const drift = await silent(() => run(["--check"], "2026-11-21", dir));
    assert.equal(drift.code, 1);
    assert.match(drift.text, /differs: opus-5-5-bug-hunt/);
  });
});

test("a refused own file changes nothing", async () => {
  await inCopy(async (dir) => {
    const before = readFileSync(join(dir, "panel-recommendations.json"), "utf8");
    const file = join(dir, "incoming.json");
    writeFileSync(file, JSON.stringify(own({ cohort: "from /home/x" })));
    const deny = join(dir, "deny.txt");
    writeFileSync(deny, "held-out\n");
    const out = await silent(() =>
      run(["--from-file", file, "--deny-file", deny], "2026-11-21", dir),
    );
    assert.equal(out.code, 1);
    assert.equal(readFileSync(join(dir, "panel-recommendations.json"), "utf8"), before);
    writeFileSync(file, JSON.stringify(own({})));
    assert.equal(
      (await silent(() => run(["--from-file", file, "--deny-file", deny], "2026-11-21", dir))).code,
      1,
    );
  });
});

test("--fetch with a saved board rewrites the snapshot and regenerates", async () => {
  await inCopy(async (dir) => {
    const saved = join(dir, "board.json");
    writeFileSync(saved, JSON.stringify(board([row({ effort: "medium" }), row()])));
    writeFileSync(join(dir, "panel-recommendations.sources.json"), JSON.stringify(spec));
    const out = await silent(() =>
      run(["--fetch", "--board-file", saved, "--today", "2026-11-05"], "2026-11-21", dir),
    );
    assert.equal(out.code, 0, out.text);
    assert.equal(read(join(dir, "panel-board-snapshot.json")).fetched, "2026-11-05");
    assert.equal(read(join(dir, "panel-recommendations.json")).entries.length, 1);
  });
});

test("an unknown, positional, empty or conflicting argument is an error and writes nothing", async () => {
  await inCopy(async (dir) => {
    const before = readFileSync(join(dir, "panel-recommendations.json"), "utf8");
    for (const argv of [
      ["--unknown"],
      ["stray"],
      ["--from-file"],
      ["--from-file="],
      ["--from-file", "x.json"],
      ["--from-file", "a.json", "--from-file", "b.json", "--deny-file", "d.txt"],
      ["--check", "--check"],
      ["--check", "--fetch"],
      ["--check", "--from-file", "x.json"],
      ["--fetch", "--from-file", "x.json"],
      ["--check", "--today", "2026-11-05"],
      ["--board-file", "x.json"],
      ["--fetch", "--today", "yesterday"],
    ]) {
      const out = await silent(() => run(argv, "2026-11-21", dir));
      assert.equal(out.code, 2, `${argv.join(" ")}: ${out.text}`);
    }
    assert.equal(readFileSync(join(dir, "panel-recommendations.json"), "utf8"), before);
  });
});

test("a fetch goes only to https", async () => {
  await assert.rejects(() => fetchBoard("http://example.org/b.json"), /only https/);
});

test("an own file is refused without a deny file, and a deny entry matches however it is spelled", async () => {
  await inCopy(async (dir) => {
    const file = join(dir, "incoming.json");
    writeFileSync(file, JSON.stringify(own({})));
    const out = await silent(() => run(["--from-file", file], "2026-11-21", dir));
    assert.equal(out.code, 2);
    assert.match(out.text, /needs --deny-file/);
  });
  // A name made of letters and hyphens passes the shape checks, so only a deny entry can stop it.
  assert.doesNotThrow(() => sanitizeOwn(own({ cohort: "46 cases from internal-tool" })));
  for (const spelled of ["internal tool", "INTERNAL-TOOL", "Internal.Tool", "internaltool"]) {
    assert.throws(
      () => sanitizeOwn(own({ cohort: `46 cases from ${spelled}` }), ["internal-tool"]),
      /must not carry/,
      spelled,
    );
  }
});

test("harness is a short name, not a second free-text field", () => {
  assert.throws(
    () => sanitizeOwn(own({ harness: "Codex CLI with a long description of the setup used" })),
    /own results refused/,
  );
  assert.throws(() => sanitizeOwn(own({ checked: "2026-13-45" })), /not a real date/);
});

test("the newest current row wins, then the one with more runs; a saving is stated only when it is one", () => {
  const snap = reduceBoard(
    board([
      row({ effort: "medium", fixed: 10, date: "2026-11-02", cost_usd: 30, wall_min: 50 }),
      row({ effort: "medium", fixed: 20, date: "2026-11-01", cost_usd: 5, wall_min: 5 }),
      row({ effort: "high", fixed: 40, date: "2026-11-02", n_runs: 2, cost_usd: 10, wall_min: 10 }),
      row({ effort: "high", fixed: 41, date: "2026-11-02", n_runs: 5, cost_usd: 10, wall_min: 10 }),
    ]),
    "2026-11-03",
  );
  const [entry] = buildCatalog(spec, snap, { version: 1, results: [] }).entries;
  assert.deepEqual(
    entry.efforts.map((/** @type {any} */ e) => [e.effort, e.fixed]),
    [
      ["medium", 10],
      ["high", 41],
    ],
  );
  // The lower-fixing rung costs more and takes longer, so no "less cost" or "less time" is claimed.
  assert.match(entry.rationale, /^high fixed the most \(41 of 105\); medium fixed 31 fewer\.( |$)/);
});

test("a gap inside the board's run-to-run spread is not ranked", () => {
  const snap = reduceBoard(
    board([row({ effort: "medium", fixed: 40 }), row({ effort: "high", fixed: 40.5 })]),
    "2026-11-03",
  );
  const [entry] = buildCatalog({ ...spec, board: { ...spec.board, noisePoints: 1.5 } }, snap, {
    version: 1,
    results: [],
  }).entries;
  assert.match(entry.rationale, /not distinguishable/);
});

test("a board figure that is null or boolean is refused, not read as a number", () => {
  assert.throws(() => reduceBoard(board([row({ fixed: null })]), "2026-11-03"), /cannot read/);
  assert.throws(() => reduceBoard(board([row({ n_runs: true })]), "2026-11-03"), /cannot read/);
});

test("several outputs are written together or not at all", async () => {
  await inCopy(async (dir) => {
    const a = join(dir, "a.json");
    writeFileSync(a, "old a\n");
    // The second target's directory does not exist, so its rename fails and the first file is restored.
    assert.throws(() =>
      writeAll([
        [a, { n: 1 }],
        [join(dir, "missing-dir", "b.json"), { n: 2 }],
      ]),
    );
    assert.equal(readFileSync(a, "utf8"), "old a\n");
    writeAll([[a, { n: 3 }]]);
    assert.deepEqual(read(a), { n: 3 });
  });
});
