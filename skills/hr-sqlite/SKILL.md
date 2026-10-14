---
name: hr-sqlite
description: Checklist of settings, failure patterns and measured effects for SQLite code. Use when adding or changing code that opens, queries or copies a SQLite database, or when diagnosing "database is locked", SQLITE_BUSY, slow queries or WAL growth.
---

# SQLite

Run `python3 <this skill's directory>/scripts/inspect-sqlite.py <database>` first
when you have a database file. It opens the file read-only and reports what the
file records, the WAL size and the mount options. It cannot show connection
settings, because SQLite does not store them in the file; read the code that
opens the connection for those. With `--source <directory>` it also scans source
text for each `journal_mode` mention that has no earlier `busy_timeout` in the
same file. That scan does not establish run order or which connection a mention
belongs to.

Each item carries an evidence tier:

- **M**: measured on a real workload. [The evidence](references/evidence.md)
  gives the counts, the workload and its limits.
- **D**: stated by the SQLite documentation, not measured here.
- **U**: suspected or reported by one source. Do not rely on it.

The numbers come from specific workloads. Before changing a setting for speed,
measure your own with `hr-benchmarking`. Before adopting or rejecting a
different engine, driver or pool, read
[the tool decisions](references/tool-decisions.md).

## Open a connection

1. **Set `PRAGMA busy_timeout` first**, before `journal_mode` and every other
   statement, on every connection, including short-lived probe, lock and status
   databases. The default is 0, so any competing lock fails at once. Set it
   long enough to cover the longest holder you expect. A deliberate fail-fast
   probe sets 0 and says why in a comment. A connection has one busy handler,
   and `PRAGMA busy_timeout` replaces any handler the driver or your code
   installed (D), so where you register a custom handler, configure that and do
   not also set the pragma. (M: a mail server's first start and a wake-lock
   probe failed this way. A test with a holder of 300 ms failed the old order in
   5 ms and passed once the timeout came first.)
2. **Convert to WAL once.** Switching a brand-new file to `journal_mode=WAL`
   takes an exclusive lock, and several processes doing it together failed.
   Create and convert the file in one place, or retry the conversion on
   `database is locked` and `disk I/O error`. Do not ignore a failed
   conversion: that connection failed later statements. A busy timeout set
   first does cover `journal_mode`. (M: 22 of 300 failures without the retry,
   0 of 480 with it.)
3. **Keep a WAL database on a local filesystem.** WAL needs shared memory, so
   network filesystems do not work (D). A database on a WSL `/mnt/<drive>` mount
   failed with `disk I/O error`; the cause was not isolated (one host).
4. **Choose `synchronous` per store.** In WAL mode NORMAL skips the sync at
   commit. An application crash loses nothing, but a power loss or OS crash can
   lose the most recent commits (D). Keep FULL where lost commits cannot be
   replayed or their side effects are not idempotent. Never choose it from a
   microbenchmark. (M: 3.09 to 0.52 ms per message send; 4.18 to 2.93 ms
   end-to-end median.)
5. **Do not expect `temp_store=MEMORY` or `mmap_size` to help a small
   database.** No difference beyond noise on a 560 KB database (M). Both are
   untested on large databases here; measure before adopting.
6. **Use one SQLite build per process for a WAL file.** A runtime's built-in
   SQLite and a native module's bundled SQLite shared one process, and the WAL
   state was corrupted in about a third of runs. The lock-registry mechanism is
   asserted (M). Open the file with one library. Give the other a checkpointed
   copy, and close its connections deterministically: one run in five still
   hit SIGBUS from a connection closed only at garbage collection (M).
7. **Set per-connection pragmas on every connection.** `busy_timeout`,
   `synchronous`, `foreign_keys` and `cache_size` do not persist in the file;
   `journal_mode=WAL` does (D).

## Write

8. **Start write transactions with `BEGIN IMMEDIATE`** and retry the whole
   transaction on `SQLITE_BUSY`. A deferred transaction that reads and then
   writes cannot wait: SQLite returns busy without calling the handler when
   waiting could deadlock (D). `BEGIN IMMEDIATE` takes the write lock at once:
   it waits behind an existing writer and blocks every other writer until it
   ends, even if its body only reads. Using it for reads therefore serializes
   them with writers (read from one server's source, not measured). Keep write
   transactions short and free of I/O.
9. **Expect a checkpoint to wait.** A long-running reader stops a checkpoint
   from finishing, so the WAL grows (D). A `TRUNCATE` checkpoint also waits for
   a backfill already running and for an idle reader's WAL mark. With a 2 s
   timeout it lost to a backfill of a 420 MB WAL in about one run in three.
   Draining the backfill first and accepting a complete `PASSIVE` backfill fixed
   it, because a file copy only needs every frame in the database file (M).

## Read

10. **Keep planner statistics.** Run `PRAGMA optimize` just before closing a
    short-lived connection. For a long-lived one, run `PRAGMA optimize=0x10002`
    when it opens and `PRAGMA optimize` periodically. Run it after
    `CREATE INDEX` (D). The `0x10000` bit and the automatic analysis limit
    arrived in SQLite 3.46.0. On older releases set `PRAGMA analysis_limit`
    yourself and run `ANALYZE` (D). Missing statistics made one query scan: 10.3
    to 12.5 ms became 0.0075 ms. The first run on a 15 GB file took 72 to 80 s
    and blocked writers; repeats took 0.5 to 1.2 s. Run it first at a time you
    choose (M).
11. **Check the plan before rewriting a query.** `EXPLAIN QUERY PLAN`, then
    statistics. A slow query that looked like bad SQL was missing statistics
    (M).
12. **Index what an FTS5 index is deleted and read by.** Deleting by an
    `UNINDEXED` column scans the whole index per row. Keep an ordinary indexed
    table from source to rowid, delete through it, and look up hits and their
    context by indexed rowid. Read rank first: select `rowid` ordered by `rank`
    with a limit, then join content. (M: refresh reads 79.9 to 18.2 MiB; hit and
    context lookups 5,742 to 134 ms after the later read-side change; rank-first
    84 to 37 ms.)
13. **Cover `LIKE` lookups with an index** on the columns the query reads. A
    covering index took 7 to 10 ms to 1 to 2.4 ms (M). The built-in `lower()`
    handles ASCII only (D).
14. **Poll for change with `PRAGMA data_version`.** It differs between two reads
    on one connection when another connection committed (D). Rescan only then.
15. **Look inside SQLite before swapping a driver.** 80 to 92% of an explore
    call was inside SQLite. Three drivers took 1,330 to 1,810 ms on an
    indexing workload, with no clear difference (M). A driver can still differ in one call; see
    [the tool decisions](references/tool-decisions.md).

## Copy, back up and host settings

16. **Copy a live database with `VACUUM INTO` or the driver's backup API**,
    then run `PRAGMA integrity_check` on the copy. Copying the files while a
    transaction is active can capture old and new content together (D).
    `sqlite3 .backup` restarts whenever another connection writes, so against a
    busy writer it can run without end (D); one run read 2.8 TB. (M: 54 s for 14
    GB with `VACUUM INTO`; 36 s for 15.2 GB with the driver's `backup()`.)
17. **Treat a file-level snapshot of the database and its `-wal` as a drill, not
    a guarantee.** One restore of three live databases with their WAL files
    passed `integrity_check` (M, one drill). Restore and check before relying on
    the method.
18. **Check mount options.** Online `discard` on ext4 stalled `fsync`: the main
    thread's disk wait fell from 26.8% and 16.8% to under 1% after remounting
    with `nodiscard`, and a weekly `fstrim` replaced it (M). The inspection
    script prints them.

## Measure

19. **Report cold and warm separately.** The same `PRAGMA optimize` took 72 s
    cold and 0.5 s warm (M).
20. **Time the change in the real loop.** Turning foreign keys off ran 7.6
    times faster alone and made no difference in the loop (32.9 to 32.8 s)
    (M).
21. **Match durability settings before comparing stores.** A ratio between two
    stores whose `synchronous` settings differ, or are unrecorded, compares the
    settings. One comparison reported 84 to 563 times against stores whose
    setting was not recorded (M).
22. **Record the SQLite version and compile options**
    (`PRAGMA compile_options`). Two builds of the same version can differ: the
    documentation recommends `SQLITE_DEFAULT_MEMSTATUS=0`, and one runtime's
    build lacks it (D; see [the tool decisions](references/tool-decisions.md)).

## Keep reads off the event loop

23. **With a synchronous driver, run reads on a worker connection.** Node's
    built-in `node:sqlite` runs each statement on the calling thread, so a slow
    read holds the event loop for its whole duration. Where the application
    shares one queued connection for reads and writes, a read also waits behind
    any open write transaction. Route read-only queries to a separate read-only
    connection in a worker thread. That connection sees only committed data, as a
    snapshot, so move only reads that tolerate that; a read that must see the
    caller's uncommitted changes stays on the writer. A text search over 86,163 messages held the
    loop for a median 165 ms (range 97 to 308) on the writer connection and 2.5 ms
    (2 to 4) on the worker, with no clear change in wall time (165 and 157 ms; 12
    runs per arm, 2 ms probe) (M). Prove the routing with a test that keeps the
    main thread busy on a latch and checks the worker read still completes; an
    open writer transaction alone proves nothing, because in WAL mode a second
    main-thread connection can read past it. Record
    the longest event-loop stall, not only the query time; `hr-benchmarking`'s
    JavaScript reference covers the probe.

## What to leave out of a record

Do not repeat a claim from [the withdrawn list](references/evidence.md#claims-that-did-not-hold)
without re-measuring it. Mark anything unmeasured as such, and give the count
and the workload with any figure.
