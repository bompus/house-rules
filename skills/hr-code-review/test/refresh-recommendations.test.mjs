import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCatalog,
  canonicalSnapshot,
  fetchBoard,
  pathsIn,
  reduceBoard,
  run,
  sanitizeOwn,
  serialize,
  withLock,
  writeAll,
} from "../scripts/refresh-recommendations.mjs";

const refs = resolve(dirname(fileURLToPath(import.meta.url)), "..", "references");
const real = pathsIn(refs);
/** @param {string} path */
const read = (path) => JSON.parse(readFileSync(path, "utf8"));

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
const vocabulary = { models: ["model-a", "model-b"], harnesses: ["CLI A", "CLI B"] };
const empty = { version: 1, results: [] };

const good = {
  model: "model-a",
  harness: "CLI A",
  effort: "medium",
  found: 80,
  of: 141,
  falseSharePercent: 0.2,
  wallMinutesPerReview: 2.7,
  cases: 46,
  caseSet: "held-out",
  judging: "blind-second-model",
  checked: "2026-11-21",
};
const own = (/** @type {any} */ over = {}) => ({ version: 1, results: [{ ...good, ...over }] });

/**
 * A complete controlled references folder: a test spec, a snapshot reduced from a small board and the catalog
 * they generate. Mutation tests run here; the committed files are read only by the committed-artifact checks.
 * @param {(dir: string) => Promise<void> | void} fn
 */
async function inFixture(fn) {
  const dir = mkdtempSync(join(tmpdir(), "refresh-rec-"));
  try {
    const paths = pathsIn(dir);
    const snapshot = reduceBoard(
      board([row({ effort: "medium", fixed: 20 }), row()]),
      "2026-11-03",
    );
    writeFileSync(paths.spec, serialize(spec));
    writeFileSync(paths.snapshot, serialize(snapshot));
    writeFileSync(paths.catalog, serialize(buildCatalog(spec, snapshot, empty)));
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
/** Import a result file with a deny file, as a maintainer does. */
async function importOwn(
  /** @type {string} */ dir,
  /** @type {any} */ file,
  deny = "unrelated-name\n",
) {
  writeFileSync(join(dir, "incoming.json"), JSON.stringify(file));
  writeFileSync(join(dir, "deny.txt"), deny);
  return silent(() =>
    run(
      ["--from-file", join(dir, "incoming.json"), "--deny-file", join(dir, "deny.txt")],
      "2026-11-21",
      dir,
    ),
  );
}
const check = (/** @type {string} */ dir) => silent(() => run(["--check"], "2026-11-21", dir));

test("the committed catalog is what the snapshot, the spec and the own facts it carries generate", async () => {
  const { code, text } = await silent(() => run(["--check"]));
  assert.equal(code, 0, text);
  const catalog = read(real.catalog);
  assert.doesNotMatch(JSON.stringify(catalog), /\/home\/|\/Users\/|@/i);
  // The committed own entries are valid facts, so a plain regeneration would keep them.
  const facts = catalog.entries
    .filter((/** @type {any} */ e) => e.kind === "own-evaluation")
    .map((/** @type {any} */ e) => e.facts);
  assert.doesNotThrow(() => sanitizeOwn({ version: 1, results: facts }, committedVocabulary()));
});
/** The committed spec's own names, for the committed-artifact check. */
function committedVocabulary() {
  const committed = read(real.spec);
  return {
    models: committed.entries.map((/** @type {any} */ e) => e.model),
    harnesses: committed.entries.map((/** @type {any} */ e) => e.harness),
  };
}

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
  const catalog = buildCatalog(spec, snap, empty);
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
  assert.throws(() => buildCatalog(spec, snap, empty), /Model A medium/);
});

test("a board whose layout changed, or a measurement outside its domain, is refused", () => {
  assert.throws(() => reduceBoard({ runs: [] }, "2026-11-03"), /layout changed/);
  assert.throws(() => reduceBoard(board([row({ fixed: "many" })]), "2026-11-03"), /cannot read/);
  assert.throws(() => reduceBoard(board([row({ fixed: null })]), "2026-11-03"), /cannot read/);
  assert.throws(() => reduceBoard(board([row({ n_runs: true })]), "2026-11-03"), /cannot read/);
  assert.throws(() => reduceBoard(board([]), "yesterday"), /YYYY-MM-DD/);
  assert.throws(() => reduceBoard(board([row()]), "2026-02-31"), /real YYYY-MM-DD/);
  assert.doesNotThrow(() => reduceBoard(board([row()]), "2028-02-29"));
  for (const over of [
    { cost_usd: -5 },
    { wall_min: -1 },
    { n_runs: 0 },
    { n_runs: 2.5 },
    { fixed: 106 },
    { fixed: -1 },
  ]) {
    assert.throws(
      () => reduceBoard(board([row(over)]), "2026-11-03"),
      /snapshot/,
      JSON.stringify(over),
    );
  }
  assert.doesNotThrow(() =>
    reduceBoard(board([row({ fixed: 40.25, wall_min: 12.5, n_runs: 3 })]), "2026-11-03"),
  );
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
  const [entry] = buildCatalog(spec, snap, empty).entries;
  assert.deepEqual(
    entry.efforts.map((/** @type {any} */ e) => [e.effort, e.fixed]),
    [
      ["medium", 10],
      ["high", 41],
    ],
  );
  assert.match(entry.rationale, /^high fixed the most \(41 of 105\); medium fixed 31 fewer\.( |$)/);
});

test("a gap inside the board's run-to-run spread is not ranked; every effort inside it is named", () => {
  const withSpread = { ...spec, board: { ...spec.board, noisePoints: 1.5 } };
  const snap = reduceBoard(
    board([row({ effort: "medium", fixed: 40 }), row({ effort: "high", fixed: 40.5 })]),
    "2026-11-03",
  );
  assert.match(buildCatalog(withSpread, snap, empty).entries[0].rationale, /not distinguishable/);
  const three = {
    ...withSpread,
    entries: [{ ...spec.entries[0], efforts: ["medium", "high", "xhigh"] }],
  };
  const [entry] = buildCatalog(
    three,
    reduceBoard(
      board([
        row({ effort: "medium", fixed: 50.3, cost_usd: 5, wall_min: 10 }),
        row({ effort: "high", fixed: 59.6, cost_usd: 8, wall_min: 48.5 }),
        row({ effort: "xhigh", fixed: 60.2, cost_usd: 10, wall_min: 84 }),
      ]),
      "2026-11-03",
    ),
    empty,
  ).entries;
  assert.match(
    entry.rationale,
    /^xhigh fixed the most \(60\.2 of 105\); high \(59\.6\) is within the board's run-to-run spread of it for 20% less cost and 42% less time; medium fixed 9\.9 fewer for 50% less cost and 88% less time\./,
  );
  const tie = reduceBoard(
    board([row({ effort: "medium", fixed: 40 }), row({ effort: "high", fixed: 40 })]),
    "2026-11-03",
  );
  assert.match(
    buildCatalog(spec, tie, empty).entries[0].rationale,
    /medium fixed 40 and high 40 of 105/,
  );
});

test("the snapshot has one schema and one byte layout", async () => {
  const committed = readFileSync(real.snapshot, "utf8");
  assert.equal(serialize(canonicalSnapshot(JSON.parse(committed))), committed);
  await inFixture(async (dir) => {
    const file = pathsIn(dir).snapshot;
    const canonical = readFileSync(file, "utf8");
    const snap = JSON.parse(canonical);
    /** @type {Array<[string, (s: any) => void]>} */
    const edits = [
      ["an extra field", (x) => void (x.project = "acme")],
      ["an impossible date", (x) => void (x.fetched = "2026-02-31")],
      ["a row reordered", (x) => void x.rows.reverse()],
      ["a row with an extra field", (x) => void (x.rows[0].note = "x")],
    ];
    for (const [name, edit] of edits) {
      const edited = structuredClone(snap);
      edit(edited);
      writeFileSync(file, serialize(edited));
      const out = await check(dir);
      assert.equal(out.code, 1, `${name}: ${out.text}`);
    }
    // Reformatted bytes: the printed repair, a plain run, makes the next check pass.
    writeFileSync(file, JSON.stringify(snap));
    assert.equal((await check(dir)).code, 1);
    assert.equal((await silent(() => run([], "2026-11-21", dir))).code, 0);
    assert.equal((await check(dir)).code, 0);
    assert.equal(readFileSync(file, "utf8"), canonical);
  });
});

test("an own result is structured facts: nothing a maintainer types becomes public text", () => {
  const entry = buildCatalog(
    spec,
    canonicalSnapshot(
      JSON.parse(serialize(reduceBoard(board([row({ effort: "medium" }), row()]), "2026-11-03"))),
    ),
    sanitizeOwn(own(), vocabulary),
  ).entries.at(-1);
  assert.equal(entry.id, "own-model-a-medium-held-out");
  assert.equal(entry.kind, "own-evaluation");
  assert.equal(entry.provenance, "own-evaluation");
  assert.equal(entry.sourceUrl, undefined);
  assert.equal(entry.efforts[0].found, 80);
  assert.equal(
    entry.samples,
    "141 known defects across 46 held-out code changes, judged blind by a second model",
  );
  assert.deepEqual(entry.facts, good);
  const bad = [
    { cohort: "46 cases of acme" },
    { id: "x" },
    { model: "internal-model" },
    { model: "bench.internal.example" },
    { harness: "Internal Tool" },
    { effort: "extreme" },
    { caseSet: "private" },
    { judging: "see https://private.example" },
    { found: 200 },
    { found: 0.5 },
    { of: 2.5 },
    { cases: 0 },
    { falseSharePercent: -1 },
    { wallMinutesPerReview: "2" },
    { checked: "2026-13-45" },
  ];
  for (const over of bad) {
    assert.throws(
      () => sanitizeOwn(own(over), vocabulary),
      /own results refused/,
      JSON.stringify(over),
    );
  }
  const missing = { ...good };
  delete /** @type {any} */ (missing).judging;
  assert.throws(
    () => sanitizeOwn({ version: 1, results: [missing] }, vocabulary),
    /judging is missing/,
  );
  assert.throws(
    () => sanitizeOwn({ version: 1, results: [good, good] }, vocabulary),
    /second model-a/,
  );
  assert.throws(
    () => sanitizeOwn({ version: 1, results: [], project: "x" }, vocabulary),
    /exactly/,
  );
  assert.throws(() => sanitizeOwn({ results: [] }, vocabulary), /exactly/);
  // Two results for one model differ by effort or case set.
  assert.doesNotThrow(() =>
    sanitizeOwn(
      { version: 1, results: [good, { ...good, effort: "high" }, { ...good, caseSet: "mixed" }] },
      vocabulary,
    ),
  );
});

test("an import rewrites the catalog alone, keeps the snapshot's bytes, and --check then agrees", async () => {
  await inFixture(async (dir) => {
    const paths = pathsIn(dir);
    const snapshotBefore = readFileSync(paths.snapshot, "utf8");
    const done = await importOwn(dir, own());
    assert.equal(done.code, 0, done.text);
    assert.equal(readFileSync(paths.snapshot, "utf8"), snapshotBefore);
    assert.deepEqual(
      readdirSync(dir).filter((n) => n.includes("own")),
      [],
    );
    const catalog = read(paths.catalog);
    assert.equal(catalog.entries.at(-1).id, "own-model-a-medium-held-out");
    assert.equal(catalog.reviewed, "2026-11-21");
    assert.equal((await check(dir)).code, 0);
    // A plain run keeps the own entries it finds in the catalog.
    assert.equal((await silent(() => run([], "2026-11-21", dir))).code, 0);
    assert.equal(read(paths.catalog).entries.length, 2);
    // A later import replaces all of them: removing a result is an import without it.
    assert.equal((await importOwn(dir, own({ effort: "high" }))).code, 0);
    assert.deepEqual(
      read(paths.catalog).entries.map((/** @type {any} */ e) => e.id),
      ["a", "own-model-a-high-held-out"],
    );
    assert.equal((await importOwn(dir, empty)).code, 0);
    assert.deepEqual(
      read(paths.catalog).entries.map((/** @type {any} */ e) => e.id),
      ["a"],
    );
  });
});

test("a refused import changes nothing, and an import needs a deny file", async () => {
  await inFixture(async (dir) => {
    const before = readFileSync(pathsIn(dir).catalog, "utf8");
    const refused = await importOwn(dir, own({ model: "internal-model" }));
    assert.equal(refused.code, 1);
    assert.equal(readFileSync(pathsIn(dir).catalog, "utf8"), before);
    // A deny entry that matches a published string refuses the import.
    const denied = await importOwn(dir, own(), "model-a\n");
    assert.equal(denied.code, 1);
    assert.match(denied.text, /must not carry/);
    assert.equal(readFileSync(pathsIn(dir).catalog, "utf8"), before);
    writeFileSync(join(dir, "incoming.json"), JSON.stringify(own()));
    const out = await silent(() =>
      run(["--from-file", join(dir, "incoming.json")], "2026-11-21", dir),
    );
    assert.equal(out.code, 2);
    assert.match(out.text, /needs --deny-file/);
  });
});

test("a deny entry matches inside one published string, never across neighbouring fields", async () => {
  await inFixture(async (dir) => {
    // "ownmodel" would span the id prefix and the next JSON key if the entry were joined; no value holds it.
    const ok = await importOwn(dir, own(), "id-kind\n");
    assert.equal(ok.code, 0, ok.text);
    // A phrase inside one generated sample line refuses.
    const refused = await importOwn(dir, own(), "known defects across 46\n");
    assert.equal(refused.code, 1);
    // A deny entry covers the generated id and the effort as published.
    assert.equal((await importOwn(dir, own(), "own-model-a-medium-held-out\n")).code, 1);
    assert.equal((await importOwn(dir, own({ effort: "high" }), "high\n")).code, 1);
  });
});

test("the catalog is checked byte for byte: a hand edit, extra field, tampered own text or duplicate key fails", async () => {
  await inFixture(async (dir) => {
    const file = pathsIn(dir).catalog;
    await importOwn(dir, own());
    const canonical = readFileSync(file, "utf8");
    const edit = async (/** @type {string} */ name, /** @type {(c: any) => void} */ fn) => {
      const catalog = JSON.parse(canonical);
      fn(catalog);
      writeFileSync(file, serialize(catalog));
      const out = await check(dir);
      assert.equal(out.code, 1, name);
      return out.text;
    };
    assert.match(
      await edit("board figure", (c) => void (c.entries[0].efforts[0].fixed += 1)),
      /entries: a/,
    );
    assert.match(
      await edit("own text", (c) => void (c.entries[1].samples = "x")),
      /own-model-a-medium-held-out/,
    );
    await edit("extra field", (c) => void (c.entries[1].project = "acme"));
    await edit("extra top-level field", (c) => void (c.project = "acme"));
    writeFileSync(file, canonical.replace('"version": 1,', '"version": 1,\n  "version": 1,'));
    assert.match((await check(dir)).text, /duplicate keys/);
    // A plain run regenerates the catalog from the facts and the board, which repairs the own text.
    writeFileSync(
      file,
      serialize({
        ...JSON.parse(canonical),
        entries: JSON.parse(canonical).entries.map(
          (/** @type {any} */ e, /** @type {number} */ i) => (i === 1 ? { ...e, samples: "x" } : e),
        ),
      }),
    );
    assert.equal((await silent(() => run([], "2026-11-21", dir))).code, 0);
    assert.equal(readFileSync(file, "utf8"), canonical);
  });
});

test("--fetch with a saved board rewrites the snapshot and regenerates; a missing snapshot is rebuilt", async () => {
  await inFixture(async (dir) => {
    const paths = pathsIn(dir);
    const saved = join(dir, "board.json");
    writeFileSync(saved, JSON.stringify(board([row({ effort: "medium", fixed: 22 }), row()])));
    rmSync(paths.snapshot);
    const out = await silent(() =>
      run(["--fetch", "--board-file", saved, "--today", "2026-11-05"], "2026-11-21", dir),
    );
    assert.equal(out.code, 0, out.text);
    assert.equal(read(paths.snapshot).fetched, "2026-11-05");
    assert.equal(read(paths.catalog).entries[0].efforts[0].fixed, 22);
    assert.equal((await check(dir)).code, 0);
    const before = readFileSync(paths.catalog, "utf8");
    const bad = await silent(() => run(["--fetch", "--today", "2026-02-31"], "2026-11-21", dir));
    assert.equal(bad.code, 2);
    assert.equal(readFileSync(paths.catalog, "utf8"), before);
  });
});

test("an unknown, positional, empty or conflicting argument is an error and writes nothing", async () => {
  await inFixture(async (dir) => {
    const before = readFileSync(pathsIn(dir).catalog, "utf8");
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
    assert.equal(readFileSync(pathsIn(dir).catalog, "utf8"), before);
  });
});

test("a fetch goes only to https, and a board larger than the cap is cancelled at the cap", async () => {
  await assert.rejects(() => fetchBoard("http://example.org/b.json"), /only https/);
  let pulls = 0;
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) {
      pulls++;
      controller.enqueue(new Uint8Array(1 << 20));
    },
    cancel() {
      cancelled = true;
    },
  });
  const fake = async () => new Response(stream, { status: 200 });
  await assert.rejects(() => fetchBoard("https://example.org/b.json", fake), /larger than/);
  assert.ok(cancelled);
  assert.ok(pulls <= 25, `pulled ${pulls} chunks`);
  const small = async () => new Response('{"a":1}', { status: 200 });
  assert.deepEqual(await fetchBoard("https://example.org/b.json", small), { a: 1 });
});

test("several outputs are written together or not at all, and nothing else in the folder is touched", async () => {
  await inFixture(async (dir) => {
    const a = join(dir, "a.json");
    writeFileSync(a, "old a\n");
    // A pre-existing file named like the old temporary name must survive untouched.
    writeFileSync(`${a}.new`, "keep me\n");
    // The second target is a directory with content, so its rename fails and the first file is restored.
    const b = join(dir, "b.json");
    mkdirSync(b);
    writeFileSync(join(b, "x"), "x");
    assert.throws(() =>
      writeAll([
        [a, { n: 1 }],
        [b, { n: 2 }],
      ]),
    );
    assert.equal(readFileSync(a, "utf8"), "old a\n");
    assert.equal(readFileSync(`${a}.new`, "utf8"), "keep me\n");
    assert.deepEqual(
      readdirSync(dir).filter((n) => n.startsWith(".refresh")),
      [],
    );
    writeAll([[a, { n: 3 }]]);
    assert.deepEqual(read(a), { n: 3 });
    assert.throws(
      () =>
        writeAll([
          [a, 1],
          [join(dir, "sub", "c.json"), 2],
        ]),
      /one folder/,
    );
  });
});

test("a refresh reclaims only its own abandoned transactions", async () => {
  await inFixture(async (dir) => {
    // An abandoned transaction: the tool's name, its marker, and its new-<n> files only.
    const abandoned = join(dir, ".refresh-abc123");
    mkdirSync(abandoned);
    writeFileSync(join(abandoned, ".transaction"), "refresh-recommendations transaction\n");
    writeFileSync(join(abandoned, "new-0"), "x");
    // Look-alikes: a directory with the tool's name shape but no marker, one with extra content, a plain
    // directory and a file with the prefix. None is the tool's, so every mode leaves them.
    const unmarked = join(dir, ".refresh-abc124");
    mkdirSync(unmarked);
    writeFileSync(join(unmarked, "keep"), "mine");
    const extra = join(dir, ".refresh-abc125");
    mkdirSync(extra);
    writeFileSync(join(extra, ".transaction"), "refresh-recommendations transaction\n");
    writeFileSync(join(extra, "notes.txt"), "mine");
    const notes = join(dir, ".refresh-notes");
    mkdirSync(notes);
    writeFileSync(join(notes, "a"), "mine");
    // An import file named like the prefix is read, and survives.
    const input = join(dir, ".refresh-input.json");
    writeFileSync(input, JSON.stringify(own()));
    writeFileSync(join(dir, "deny.txt"), "unrelated-name\n");
    const out = await silent(() =>
      run(["--from-file", input, "--deny-file", join(dir, "deny.txt")], "2026-11-21", dir),
    );
    assert.equal(out.code, 0, out.text);
    assert.equal(existsSync(abandoned), false);
    for (const kept of [
      join(unmarked, "keep"),
      join(extra, "notes.txt"),
      join(notes, "a"),
      input,
    ]) {
      assert.equal(existsSync(kept), true, kept);
    }
    for (const argv of [[], ["--check"]]) {
      await silent(() => run(argv, "2026-11-21", dir));
      assert.equal(existsSync(join(notes, "a")), true);
    }
  });
});

test("the refresh lock never removes a lock it does not own", async () => {
  await inFixture(async (dir) => {
    const lock = join(dir, ".refresh.lock");
    writeFileSync(lock, "");
    await assert.rejects(() => withLock(dir, async () => 1), /retry/);
    assert.equal(readFileSync(lock, "utf8"), "");
    writeFileSync(lock, "not a pid\n");
    await assert.rejects(() => withLock(dir, async () => 1), /cannot be read/);
    // A live owner is busy.
    writeFileSync(lock, `${process.pid}\n`);
    await assert.rejects(() => withLock(dir, async () => 1), /retry/);
    assert.equal(readFileSync(lock, "utf8"), `${process.pid}\n`);
    // The holder finishes between the failed claim and the read: the waiter acquires on retry.
    assert.equal(
      await withLock(dir, async () => "ran", {
        afterContended: () => rmSync(lock, { force: true }),
      }),
      "ran",
    );
    assert.equal(existsSync(lock), false);
    // A lock is released only when it is still the file this call linked.
    await withLock(dir, async () => {
      rmSync(lock, { force: true });
      writeFileSync(lock, "99999\n");
    });
    assert.equal(readFileSync(lock, "utf8"), "99999\n");
  });
});

test("a stale observer paused after its read cannot remove a successor's lock: at most one holder at a time", async () => {
  await inFixture(async (dir) => {
    const lock = join(dir, ".refresh.lock");
    writeFileSync(lock, "2147483646\n");
    let holders = 0;
    let most = 0;
    /** @type {() => void} */
    let releaseObserver = () => {};
    const observerGate = new Promise((resolveGate) => {
      releaseObserver = /** @type {() => void} */ (resolveGate);
    });
    /** @type {() => void} */
    let releaseHolder = () => {};
    const holderGate = new Promise((resolveGate) => {
      releaseHolder = /** @type {() => void} */ (resolveGate);
    });
    const hold = async () => {
      holders++;
      most = Math.max(most, holders);
      await holderGate;
      holders--;
      return "ran";
    };
    // The observer reads the dead owner, then pauses.
    const observer = withLock(dir, hold, { afterRead: () => observerGate });
    await new Promise((r) => setTimeout(r, 20));
    // A successor takes the stale lock over and holds it; a third contender finds a live lock.
    const successor = withLock(dir, hold);
    await new Promise((r) => setTimeout(r, 20));
    const third = withLock(dir, hold);
    await assert.rejects(third, /retry/);
    // The observer resumes: it must find the successor's live lock and leave it alone.
    releaseObserver();
    await assert.rejects(observer, /retry/);
    assert.equal(existsSync(lock), true);
    releaseHolder();
    assert.equal(await successor, "ran");
    assert.equal(most, 1);
    assert.equal(existsSync(lock), false);
    assert.deepEqual(
      readdirSync(dir).filter((n) => n.startsWith(".refresh")),
      [],
    );
  });
});

test("a second refresh while one holds the lock fails with a retry message", async () => {
  await inFixture(async (dir) => {
    const lock = join(dir, ".refresh.lock");
    writeFileSync(lock, `${process.pid}\n`);
    const busy = await silent(() => run([], "2026-11-21", dir));
    assert.equal(busy.code, 1);
    assert.match(busy.text, /retry/);
    writeFileSync(lock, "2147483646\n");
    assert.equal((await silent(() => run([], "2026-11-21", dir))).code, 0);
    assert.equal(existsSync(lock), false);
  });
});

test("a deny file screens every published string, the snapshot's unused rows included", async () => {
  await inFixture(async (dir) => {
    const paths = pathsIn(dir);
    const deny = join(dir, "deny.txt");
    writeFileSync(deny, "internal-harness\n");
    const saved = join(dir, "board.json");
    // A row no recommendation uses still lands in the published snapshot.
    writeFileSync(
      saved,
      JSON.stringify(
        board([
          row({ effort: "medium", fixed: 22 }),
          row(),
          row({ model: "Other", harness: "Internal Harness" }),
        ]),
      ),
    );
    const snapshotBefore = readFileSync(paths.snapshot, "utf8");
    const catalogBefore = readFileSync(paths.catalog, "utf8");
    const refused = await silent(() =>
      run(
        ["--fetch", "--board-file", saved, "--deny-file", deny, "--today", "2026-11-05"],
        "2026-11-21",
        dir,
      ),
    );
    assert.equal(refused.code, 1);
    assert.match(refused.text, /snapshot would publish a name/);
    assert.equal(readFileSync(paths.snapshot, "utf8"), snapshotBefore);
    assert.equal(readFileSync(paths.catalog, "utf8"), catalogBefore);
    // Without the deny file the same board is accepted; the offline check with it then fails.
    const accepted = await silent(() =>
      run(["--fetch", "--board-file", saved, "--today", "2026-11-05"], "2026-11-21", dir),
    );
    assert.equal(accepted.code, 0, accepted.text);
    const checked = await silent(() => run(["--check", "--deny-file", deny], "2026-11-21", dir));
    assert.equal(checked.code, 1);
    assert.match(checked.text, /must not carry/);
  });
});

test("a raw own-results file in the skill folder is an obsolete source: every mode refuses it", async () => {
  await inFixture(async (dir) => {
    writeFileSync(
      join(dir, "panel-recommendations.own.json"),
      serialize({ version: 1, results: [], project: "acme" }),
    );
    for (const argv of [[], ["--check"]]) {
      const out = await silent(() => run(argv, "2026-11-21", dir));
      assert.equal(out.code, 1);
      assert.match(out.text, /obsolete source/);
    }
    rmSync(join(dir, "panel-recommendations.own.json"));
    assert.equal((await check(dir)).code, 0);
  });
});

test("damage to an own entry's derived fields never drops its facts", async () => {
  await inFixture(async (dir) => {
    const file = pathsIn(dir).catalog;
    await importOwn(dir, own());
    const canonical = readFileSync(file, "utf8");
    // The discriminator is changed or removed: the facts are intact, so a plain run restores the entry.
    for (const edit of [
      (/** @type {any} */ e) => void (e.kind = "board"),
      (/** @type {any} */ e) => void delete e.kind,
    ]) {
      const catalog = JSON.parse(canonical);
      edit(catalog.entries[1]);
      writeFileSync(file, serialize(catalog));
      assert.equal((await check(dir)).code, 1);
      assert.equal((await silent(() => run([], "2026-11-21", dir))).code, 0);
      assert.equal(readFileSync(file, "utf8"), canonical);
    }
    // Facts removed: nothing to recover from, so the run stops and the catalog is left as it was.
    const catalog = JSON.parse(canonical);
    delete catalog.entries[1].facts;
    writeFileSync(file, serialize(catalog));
    const damaged = readFileSync(file, "utf8");
    const out = await silent(() => run([], "2026-11-21", dir));
    assert.equal(out.code, 1);
    assert.match(out.text, /carries no facts/);
    assert.equal(readFileSync(file, "utf8"), damaged);
  });
});
