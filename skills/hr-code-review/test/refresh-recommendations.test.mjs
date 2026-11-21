import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCatalog,
  canonicalSnapshot,
  fetchBoard,
  looksSecret,
  plainWords,
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

/** A references folder copy that a test may write to; removed after the test. */
async function inCopy(/** @type {(dir: string) => Promise<void> | void} */ fn) {
  const dir = mkdtempSync(join(tmpdir(), "refresh-rec-"));
  try {
    // The own file is optional: a checkout without one is a supported state, so the copy does not require it.
    for (const path of Object.values(real)) {
      if (existsSync(path)) {
        cpSync(path, join(dir, path.slice(refs.length + 1)));
      }
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
    { cohort: "46 cases, key sk-proj1234567890abcdef" },
    { cohort: "46 cases, id 0123456789abcdef0123" },
    { cohort: "see 192.0.2.1" },
    { cohort: "see host.internal.example" },
    { cohort: "46 cases, addr 2001:db8::1" },
    { cohort: "46 cases, blob Zm9vYmFyMTIzNDU2Nzg5MDEyMzQ1" },
    { harness: "build.internal.example" },
    { id: "sk-proj1234567890abcdef" },
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
  assert.throws(() => sanitizeOwn({ version: 1, results: [], project: "x" }), /expected exactly/);
  assert.doesNotThrow(() => sanitizeOwn(own({})));
  assert.equal(
    looksSecret("46 held-out code changes, judged blind by a second model", true),
    false,
  );
});

test("a name on the deny list is refused wherever it appears, whatever its case", () => {
  assert.throws(
    () => sanitizeOwn(own({ cohort: "46 Held-Out cases of Widget Co changes" }), ["widget co"]),
    /must not carry/,
  );
  assert.doesNotThrow(() => sanitizeOwn(own({}), ["widget co", ""]));
});

test("the committed own results and catalog name no private repository, path, address or credential", () => {
  const text = JSON.stringify([existsSync(real.own) ? read(real.own) : null, read(real.catalog)]);
  assert.doesNotMatch(text, /\/home\/|\/Users\/|@/i);
  // The same detector the importer uses runs over every string the committed files hold.
  const strings = text.match(/"((?:[^"\\]|\\.)*)"/g) ?? [];
  for (const quoted of strings) {
    assert.equal(looksSecret(quoted.slice(1, -1)), false, quoted);
  }
  sanitizeOwn(existsSync(real.own) ? read(real.own) : { version: 1, results: [] });
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
    assert.match(drift.text, /entries: opus-5-5-bug-hunt/);
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

test("a board larger than the cap is cancelled at the cap, not read to the end", async () => {
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

test("several outputs are written together or not at all, and nothing else in the folder is touched", async () => {
  await inCopy(async (dir) => {
    const a = join(dir, "a.json");
    writeFileSync(a, "old a\n");
    // A pre-existing file of the old temporary name, and a symlink at that name, must survive untouched.
    writeFileSync(`${a}.new`, "keep me\n");
    const other = join(dir, "other.txt");
    writeFileSync(other, "other\n");
    symlinkSync(other, join(dir, "b.json.new"));
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
    assert.equal(readFileSync(other, "utf8"), "other\n");
    assert.deepEqual(
      readdirSync(dir).filter((name) => name.startsWith(".refresh")),
      [],
    );
    writeAll([[a, { n: 3 }]]);
    assert.deepEqual(read(a), { n: 3 });
    assert.equal(readFileSync(`${a}.new`, "utf8"), "keep me\n");
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

test("--check compares the committed bytes: a private extra field or a shadowed duplicate key fails", async () => {
  await inCopy(async (dir) => {
    const ownFile = join(dir, "panel-recommendations.own.json");
    const good = readFileSync(ownFile, "utf8");
    writeFileSync(ownFile, good.replace('"version": 1,', '"version": 1,\n  "project": "acme",'));
    const extra = await silent(() => run(["--check"], "2026-11-21", dir));
    assert.equal(extra.code, 1);
    assert.match(extra.text, /expected exactly/);
    writeFileSync(ownFile, good);
    const catalogFile = join(dir, "panel-recommendations.json");
    const catalog = readFileSync(catalogFile, "utf8");
    // A shadowed first value: same parse as the generated catalog, different bytes.
    writeFileSync(catalogFile, catalog.replace('"version": 1,', '"version": 1,\n  "version": 1,'));
    const dup = await silent(() => run(["--check"], "2026-11-21", dir));
    assert.equal(dup.code, 1);
    assert.match(dup.text, /duplicate keys/);
    writeFileSync(catalogFile, catalog);
    assert.equal((await silent(() => run(["--check"], "2026-11-21", dir))).code, 0);
  });
});

test("an interruption between publishing sources and the catalog leaves a complete old catalog that --check flags and a plain run repairs", async () => {
  await inCopy(async (dir) => {
    const before = readFileSync(join(dir, "panel-recommendations.json"), "utf8");
    const baseline = JSON.parse(before).entries.length;
    // The own file is already new, the catalog still old: what an interruption after the first rename leaves.
    writeFileSync(join(dir, "panel-recommendations.own.json"), serialize(own({ found: 81 })));
    assert.equal(readFileSync(join(dir, "panel-recommendations.json"), "utf8"), before);
    assert.ok(baseline > 0);
    const flagged = await silent(() => run(["--check"], "2026-11-21", dir));
    assert.equal(flagged.code, 1);
    assert.equal((await silent(() => run([], "2026-11-21", dir))).code, 0);
    assert.equal((await silent(() => run(["--check"], "2026-11-21", dir))).code, 0);
    // The repaired catalog is the old entries plus one for the new result, whatever the baseline was.
    assert.equal(read(join(dir, "panel-recommendations.json")).entries.length, baseline + 1);
  });
});

test("a second refresh while one holds the lock fails with a retry message; a dead owner's lock is taken over", async () => {
  await inCopy(async (dir) => {
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

test("the mode picks the inputs: fetch rebuilds a missing snapshot, an import replaces a denied old file, no own file is empty", async () => {
  await inCopy(async (dir) => {
    const saved = join(dir, "board.json");
    writeFileSync(saved, JSON.stringify(board([row({ effort: "medium" }), row()])));
    writeFileSync(join(dir, "panel-recommendations.sources.json"), JSON.stringify(spec));
    rmSync(join(dir, "panel-board-snapshot.json"));
    rmSync(join(dir, "panel-recommendations.own.json"));
    const fetched = await silent(() =>
      run(["--fetch", "--board-file", saved, "--today", "2026-11-05"], "2026-11-21", dir),
    );
    assert.equal(fetched.code, 0, fetched.text);
    assert.equal(read(join(dir, "panel-recommendations.json")).entries.length, 1);
    // An own file holding a name that is denied now is replaced by a clean import, not an abort.
    writeFileSync(
      join(dir, "panel-recommendations.own.json"),
      serialize(own({ cohort: "46 cases of widgetco" })),
    );
    const incoming = join(dir, "incoming.json");
    writeFileSync(incoming, JSON.stringify(own({ model: "model-a", harness: "CLI A" })));
    const deny = join(dir, "deny.txt");
    writeFileSync(deny, "widgetco\n");
    const replaced = await silent(() =>
      run(["--from-file", incoming, "--deny-file", deny], "2026-11-21", dir),
    );
    assert.equal(replaced.code, 0, replaced.text);
    assert.equal(read(join(dir, "panel-recommendations.own.json")).results[0].cohort, good.cohort);
    // A checkout without the optional own file passes the offline check too.
    rmSync(join(dir, "panel-recommendations.own.json"));
    assert.equal((await silent(() => run([], "2026-11-21", dir))).code, 0);
    assert.equal((await silent(() => run(["--check"], "2026-11-21", dir))).code, 0);
  });
});

test("a deny entry covers the published id, the effort and the assembled text", async () => {
  assert.throws(() => sanitizeOwn(own({}), ["own-astra-62-medium-heldout"]), /published id/);
  assert.throws(() => sanitizeOwn(own({}), ["medium"]), /published id or effort/);
  await inCopy(async (dir) => {
    const incoming = join(dir, "incoming.json");
    writeFileSync(incoming, JSON.stringify(own({})));
    const deny = join(dir, "deny.txt");
    // Spans the cohort wording and a generated phrase: only the assembled entry holds it whole.
    writeFileSync(deny, "known defects across 46\n");
    const out = await silent(() =>
      run(["--from-file", incoming, "--deny-file", deny], "2026-11-21", dir),
    );
    assert.equal(out.code, 1);
    assert.match(out.text, /must not carry/);
  });
});

test("every effort inside the spread of the leader is named, and an exact tie names both", () => {
  const rows = [
    row({ effort: "medium", fixed: 50.3, cost_usd: 5, wall_min: 10 }),
    row({ effort: "high", fixed: 59.6, cost_usd: 8, wall_min: 48.5 }),
    row({ effort: "xhigh", fixed: 60.2, cost_usd: 10, wall_min: 84 }),
  ];
  const withSpread = { ...spec, board: { ...spec.board, noisePoints: 1.5 } };
  const three = {
    ...spec,
    entries: [{ ...spec.entries[0], efforts: ["medium", "high", "xhigh"] }],
  };
  const [entry] = buildCatalog(
    { ...three, board: withSpread.board },
    reduceBoard(board(rows), "2026-11-03"),
    {
      version: 1,
      results: [],
    },
  ).entries;
  assert.match(
    entry.rationale,
    /^xhigh fixed the most \(60\.2 of 105\); high \(59\.6\) is within the board's run-to-run spread of it for 20% less cost and 42% less time; medium fixed 9\.9 fewer for 50% less cost and 88% less time\./,
  );
  const tie = reduceBoard(
    board([row({ effort: "medium", fixed: 40 }), row({ effort: "high", fixed: 40 })]),
    "2026-11-03",
  );
  const [tied] = buildCatalog(spec, tie, { version: 1, results: [] }).entries;
  assert.match(tied.rationale, /medium fixed 40 and high 40 of 105/);
});

test("an impossible calendar date is refused wherever a fetch date enters", async () => {
  assert.throws(() => reduceBoard(board([row()]), "2026-02-31"), /real YYYY-MM-DD/);
  assert.doesNotThrow(() => reduceBoard(board([row()]), "2028-02-29"));
  await inCopy(async (dir) => {
    const before = readFileSync(join(dir, "panel-recommendations.json"), "utf8");
    const out = await silent(() => run(["--fetch", "--today", "2026-02-31"], "2026-11-21", dir));
    assert.equal(out.code, 2);
    assert.equal(readFileSync(join(dir, "panel-recommendations.json"), "utf8"), before);
  });
});

test("a seed, a host or a key in any identifier or description is refused; ordinary words are not", () => {
  const bad = [
    { cohort: "46 cases, seed JBSWY3DPEHPK3PXP" },
    { cohort: "46 cases, seed JBSWYDPEHPKPXPAB" },
    { cohort: "46 cases, seed jbswy3dpehpk3pxp" },
    { cohort: "46 cases from bench.internal.example" },
    { model: "bench.internal.example" },
    { harness: "bench.internal.example" },
    { id: "jbswy3dpehpk3pxp" },
    { id: "key-0123456789abcdef0123" },
  ];
  for (const over of bad) {
    assert.throws(() => sanitizeOwn(own(over)), /own results refused/, JSON.stringify(over));
  }
  // "skipping" is a word, not a key; a decimal and a percent are numbers.
  assert.doesNotThrow(() =>
    sanitizeOwn(own({ cohort: "46 cases, skipping 2.5% of files (blind)" })),
  );
  assert.equal(plainWords("skipping the sk-proj1234567890abcdef"), false);
  assert.equal(looksSecret("skipping ahead"), false);
  // A model or harness the source spec does not name is refused even when it is plain.
  const vocabulary = { models: ["gpt-6.2-astra"], harnesses: ["Codex CLI"] };
  assert.doesNotThrow(() => sanitizeOwn(own({}), [], vocabulary));
  assert.throws(() => sanitizeOwn(own({ model: "internal-model" }), [], vocabulary), /spec names/);
  assert.throws(() => sanitizeOwn(own({ harness: "Internal Tool" }), [], vocabulary), /spec names/);
});

test("measurements outside their domain are refused, fractional means and durations are not", () => {
  const bad = (/** @type {any} */ over) =>
    assert.throws(
      () => reduceBoard(board([row(over)]), "2026-11-03"),
      /snapshot|cannot read/,
      JSON.stringify(over),
    );
  bad({ cost_usd: -5 });
  bad({ wall_min: -1 });
  bad({ n_runs: 0 });
  bad({ n_runs: 2.5 });
  bad({ fixed: 106 });
  bad({ fixed: -1 });
  assert.doesNotThrow(() =>
    reduceBoard(board([row({ fixed: 40.25, wall_min: 12.5, n_runs: 3 })]), "2026-11-03"),
  );
  for (const over of [
    { found: 0.5, of: 2 },
    { of: 2.5, found: 1 },
  ]) {
    assert.throws(() => sanitizeOwn(own(over)), /an integer/);
  }
});

test("the snapshot has one schema and one byte layout: an unknown field, a bad date or a changed row order fails offline", async () => {
  const committed = readFileSync(real.snapshot, "utf8");
  // Reducing the committed measurements again gives the same bytes.
  assert.equal(serialize(canonicalSnapshot(JSON.parse(committed))), committed);
  await inCopy(async (dir) => {
    const file = join(dir, "panel-board-snapshot.json");
    const snap = JSON.parse(committed);
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
      const out = await silent(() => run(["--check"], "2026-11-21", dir));
      assert.equal(out.code, 1, `${name}: ${out.text}`);
    }
    writeFileSync(file, committed);
    assert.equal((await silent(() => run(["--check"], "2026-11-21", dir))).code, 0);
  });
});

test("the repair --check prints fixes reformatted inputs: a plain run rewrites each input in its canonical form", async () => {
  await inCopy(async (dir) => {
    const snapshot = join(dir, "panel-board-snapshot.json");
    const ownFile = join(dir, "panel-recommendations.own.json");
    const canonicalSnap = readFileSync(snapshot, "utf8");
    writeFileSync(snapshot, JSON.stringify(JSON.parse(canonicalSnap)));
    writeFileSync(ownFile, JSON.stringify({ version: 1, results: [] }));
    const flagged = await silent(() => run(["--check"], "2026-11-21", dir));
    assert.equal(flagged.code, 1);
    assert.match(flagged.text, /snapshot, own results/);
    assert.equal((await silent(() => run([], "2026-11-21", dir))).code, 0);
    assert.equal((await silent(() => run(["--check"], "2026-11-21", dir))).code, 0);
    assert.equal(readFileSync(snapshot, "utf8"), canonicalSnap);
  });
});

test("a deny entry matches only inside one published string, never across neighbouring fields", async () => {
  await inCopy(async (dir) => {
    const incoming = join(dir, "incoming.json");
    writeFileSync(incoming, JSON.stringify(own({ id: "widget" })));
    const deny = join(dir, "deny.txt");
    // "widget-kind" spans the id's end and the next key in the serialized entry, but no value holds it.
    writeFileSync(deny, "widget-kind\n");
    const ok = await silent(() =>
      run(["--from-file", incoming, "--deny-file", deny], "2026-11-21", dir),
    );
    assert.equal(ok.code, 0, ok.text);
    writeFileSync(deny, "known defects across 46\n");
    const refused = await silent(() =>
      run(["--from-file", incoming, "--deny-file", deny], "2026-11-21", dir),
    );
    assert.equal(refused.code, 1);
  });
});

test("the refresh lock: an unreadable owner is busy, not stolen; a vanished lock is retried; a stale lock goes to exactly one racer", async () => {
  await inCopy(async (dir) => {
    const lock = join(dir, ".refresh.lock");
    writeFileSync(lock, "");
    await assert.rejects(() => withLock(dir, async () => 1), /retry/);
    assert.equal(readFileSync(lock, "utf8"), "");
    writeFileSync(lock, "not a pid\n");
    await assert.rejects(() => withLock(dir, async () => 1), /cannot be read/);
    // The holder finishes between the failed link and the read: the waiter acquires on retry.
    writeFileSync(lock, `${process.pid}\n`);
    assert.equal(
      await withLock(dir, async () => "ran", {
        afterContended: () => rmSync(lock, { force: true }),
      }),
      "ran",
    );
    assert.equal(existsSync(lock), false);
    // Two refreshes race on a dead owner's lock: one runs, the other is told to retry; nothing is left behind.
    writeFileSync(lock, "2147483646\n");
    const results = await Promise.allSettled([
      withLock(dir, async () => "a"),
      withLock(dir, async () => "b"),
    ]);
    assert.deepEqual(results.map((r) => r.status).toSorted(), ["fulfilled", "rejected"]);
    assert.equal(existsSync(lock), false);
    assert.deepEqual(
      readdirSync(dir).filter((n) => n.startsWith(".refresh")),
      [],
    );
    // A lock is removed only by the process whose file it still is.
    await withLock(dir, async () => {
      rmSync(lock, { force: true });
      writeFileSync(lock, "99999\n");
    });
    assert.equal(readFileSync(lock, "utf8"), "99999\n");
  });
});

test("work files of an interrupted refresh are reclaimed, and no before image is staged in the skill folder", async () => {
  await inCopy(async (dir) => {
    const abandoned = join(dir, ".refresh-abandoned");
    mkdirSync(abandoned);
    writeFileSync(join(abandoned, "old-0"), "a private name that a replacement removed\n");
    assert.equal((await silent(() => run([], "2026-11-21", dir))).code, 0);
    assert.equal(existsSync(abandoned), false);
    // The before image of a replaced file is kept outside the folder while the renames run.
    const seen = /** @type {string[]} */ ([]);
    const a = join(dir, "a.json");
    writeFileSync(a, "old a\n");
    const b = join(dir, "b.json");
    mkdirSync(b);
    writeFileSync(join(b, "x"), "x");
    assert.throws(() =>
      writeAll([
        [a, { n: 1 }],
        [b, { n: 2 }],
      ]),
    );
    seen.push(...readdirSync(dir).filter((n) => n.startsWith(".refresh")));
    assert.deepEqual(seen, []);
  });
});
