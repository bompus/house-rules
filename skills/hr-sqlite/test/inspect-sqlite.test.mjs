import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/inspect-sqlite.py", import.meta.url));
const python = (args, input) =>
  spawnSync("python3", ["-I", ...args], {
    encoding: "utf8",
    timeout: 20000,
    input,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });

function fixture(t) {
  const dir = mkdtempSync(join(process.env.HOUSE_RULES_TEST_TMP || tmpdir(), "hr-sqlite-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function createDatabase(dir, extra = "") {
  const made = python(
    ["-", dir],
    `
import sqlite3, sys
c = sqlite3.connect(sys.argv[1] + "/app.db")
c.execute("PRAGMA journal_mode=WAL")
c.execute("CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT)")
c.execute("CREATE INDEX notes_body ON notes(body)")
c.executemany("INSERT INTO notes(body) VALUES (?)", [("n%d" % i,) for i in range(200)])
c.commit()
${extra}
c.close()
`,
  );
  assert.equal(made.status, 0, made.stderr);
  return join(dir, "app.db");
}

const inspect = (...args) => {
  const run = python([script, ...args, "--json"]);
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
};

test("reports file settings and absent statistics, then present ones after ANALYZE", (t) => {
  const dir = fixture(t);
  const database = createDatabase(dir);
  const before = inspect(database);
  assert.equal(before.journalMode, "wal");
  assert.equal(before.tables, 1);
  assert.equal(before.indexes, 1);
  assert.equal(before.statistics.sqliteStat1, false);
  assert.deepEqual(before.statistics.tablesWithoutStatistics, ["notes"]);
  assert.ok(before.notes.some((n) => n.includes("no sqlite_stat1")));

  const analyzed = createDatabase(fixture(t), "c.execute('ANALYZE'); c.commit()");
  const after = inspect(analyzed);
  assert.equal(after.statistics.sqliteStat1, true);
  assert.deepEqual(after.statistics.tablesWithoutStatistics, []);
});

test("leaves the database file unchanged", (t) => {
  const dir = fixture(t);
  const database = createDatabase(dir);
  const bytes = readFileSync(database);
  const mtime = statSync(database).mtimeMs;
  inspect(database);
  assert.deepEqual(readFileSync(database), bytes);
  assert.equal(statSync(database).mtimeMs, mtime);
});

test("lists FTS5 virtual tables without counting their shadow tables", (t) => {
  const dir = fixture(t);
  const database = createDatabase(
    dir,
    "try:\n    c.execute('CREATE VIRTUAL TABLE docs USING fts5(body)'); c.commit()\nexcept sqlite3.OperationalError:\n    pass",
  );
  const result = inspect(database);
  if (!result.virtualTables.docs) return; // This Python's SQLite has no FTS5.
  assert.equal(result.virtualTables.docs, "fts5");
  assert.equal(result.tables, 1);
});

test("source scan flags journal_mode before busy_timeout or without one", (t) => {
  const dir = fixture(t);
  const database = createDatabase(dir);
  const src = join(dir, "src");
  mkdirSync(src);
  writeFileSync(
    join(src, "bad.ts"),
    'db.exec("PRAGMA journal_mode=WAL");\ndb.exec("PRAGMA busy_timeout=5000");\n',
  );
  writeFileSync(join(src, "missing.js"), 'db.pragma("journal_mode = WAL");\n');
  writeFileSync(
    join(src, "good.py"),
    'c.execute("PRAGMA busy_timeout=5000")\nc.execute("PRAGMA journal_mode=WAL")\n',
  );
  writeFileSync(join(src, "unrelated.py"), "print('no sqlite here')\n");
  const result = inspect(database, "--source", src);
  const byName = Object.fromEntries(result.source.map((f) => [f.file.split("/").pop(), f]));
  assert.deepEqual(Object.keys(byName).sort(), ["bad.ts", "good.py", "missing.js"]);
  assert.equal(byName["bad.ts"].ok, false);
  assert.match(byName["bad.ts"].status, /comes before busy_timeout/);
  assert.equal(byName["missing.js"].ok, false);
  assert.match(byName["missing.js"].status, /no busy_timeout/);
  assert.equal(byName["good.py"].ok, true);
});

test("fails with a message for a missing file", (t) => {
  const dir = fixture(t);
  const run = python([script, join(dir, "absent.db")]);
  assert.equal(run.status, 2);
  assert.match(run.stderr, /not a file/);
});
