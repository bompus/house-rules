import { test as nodeTest } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/inspect-sqlite.py", import.meta.url));
// On the Windows CI runner a Python start sometimes stalls for 7 s or more (issue #368), while
// these tests take 0.26 to 0.9 s there otherwise. Bun ends the test and its Python child at 5 s.
const limit = process.platform === "win32" ? { timeout: 30000 } : {};
const test = (name, fn) => nodeTest(name, limit, fn);
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

function createDatabase(dir, extra = "", name = "app.db") {
  const made = python(
    ["-", dir],
    `
import sqlite3, sys
c = sqlite3.connect(sys.argv[1] + "/" + ${JSON.stringify(name)})
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
  return join(dir, name);
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

test("lists FTS5 virtual tables and keeps a similarly named application table", (t) => {
  const probe = python([
    "-c",
    "import sqlite3; sqlite3.connect(':memory:').execute('CREATE VIRTUAL TABLE t USING fts5(x)')",
  ]);
  if (probe.status !== 0) return t.skip("this Python's SQLite has no FTS5");
  const dir = fixture(t);
  const database = createDatabase(
    dir,
    "c.execute('CREATE VIRTUAL TABLE docs USING fts5(body)')\nc.execute('CREATE TABLE docs_backup(id INTEGER)')\nc.commit()",
  );
  const result = inspect(database);
  assert.equal(result.virtualTables.docs, "fts5");
  assert.equal(result.tables, 2);
  assert.ok(result.statistics.tablesWithoutStatistics.includes("docs_backup"));
});

test("source scan checks each journal_mode mention against earlier busy_timeout mentions", (t) => {
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
  writeFileSync(
    join(src, "second.py"),
    'a.execute("PRAGMA busy_timeout=5000")\na.execute("PRAGMA journal_mode=WAL")\nb.execute("PRAGMA journal_mode=WAL")\n',
  );
  writeFileSync(join(src, "unrelated.py"), "print('no sqlite here')\n");
  const result = inspect(database, "--source", src);
  const rows = result.source.map((f) => [basename(f.file), f.line, f.ok]);
  assert.deepEqual(rows.sort(), [
    ["bad.ts", 1, false],
    ["good.py", 2, true],
    ["missing.js", 1, false],
    ["second.py", 2, true],
    ["second.py", 3, true],
  ]);
  const bad = result.source.find((f) => basename(f.file) === "bad.ts");
  assert.match(bad.status, /comes before busy_timeout/);
  const missing = result.source.find((f) => basename(f.file) === "missing.js");
  assert.match(missing.status, /no busy_timeout/);
});

test("opens a database whose path contains percent and hash characters", (t) => {
  const dir = fixture(t);
  const database = createDatabase(dir, "", "a%41#b.db");
  const result = inspect(database);
  assert.equal(result.journalMode, "wal");
  assert.equal(result.tables, 1);
});

test("fails with a message for a missing file", (t) => {
  const dir = fixture(t);
  const run = python([script, join(dir, "absent.db")]);
  assert.equal(run.status, 2);
  assert.match(run.stderr, /not a file/);
});

test("a source path that cannot be read is reported and fails the run", (t) => {
  const dir = fixture(t);
  const database = createDatabase(dir);
  const src = join(dir, "src");
  mkdirSync(src);
  writeFileSync(join(src, "ok.py"), 'c.execute("PRAGMA journal_mode=WAL")\n');
  const absent = join(dir, "absent.py");
  const run = python([script, database, "--source", src, absent, "--json"]);
  assert.equal(run.status, 2);
  assert.match(run.stderr, /could not scan .*absent\.py/);
  const result = JSON.parse(run.stdout);
  assert.equal(result.source.length, 1);
  assert.deepEqual(
    result.sourceErrors.map((e) => basename(e.file)),
    ["absent.py"],
  );
});
