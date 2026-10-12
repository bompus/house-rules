# Tool decisions

What was evaluated, what was decided and what would reopen it. Most of these are
document assessments, not benchmarks; the basis is stated on each row. Re-check
a decision when its trigger is met or when the project's own documentation has
changed since the date.

| Candidate                                                                                 | Decision (date)                       | Basis                                                                                                                                                                                                                                                                                                                                        | Reopen when                                                                                                                                                     |
| ----------------------------------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Turso or libSQL engine for local stores                                                   | Keep SQLite (2026-09-30)              | Documentation and source read; no benchmark run. The engine's FTS was incompatible with the stores' FTS5 use, some pragmas were partial, and one database file could not be shared between the two engines across processes                                                                                                                  | Shared state must live across devices or machines                                                                                                               |
| [sqlite-multiwriter](https://github.com/sqliteai/sqlite-multiwriter) (per-writer WAL VFS) | Watch (2026-10-09)                    | README read at release 0.5.2, one day after its creation; its figures (49,277 against 8,630 transactions per second for 16 threads) came from one Apple machine with `synchronous=FULL` and were not reproduced. WAL only; extra `-mw*` files are part of the database; callers must retry on `SQLITE_BUSY_SNAPSHOT`; local filesystems only | A measured workload shows writer throughput, `SQLITE_BUSY` retries or long commit tails on one database that `busy_timeout` and shorter transactions do not fix |
| A Node connection-pool package                                                            | No adoption (2026-10-05)              | Code read: the driver in use is synchronous and there are no worker threads; no missing capability was shown. No benchmark                                                                                                                                                                                                                   | A new Node service needs leased connections, or a measured problem a pool would address                                                                         |
| Swapping the SQLite driver for speed                                                      | Not worth it (2026-09-16)             | Three drivers within noise on an indexing workload (see the evidence); most call time was inside SQLite itself                                                                                                                                                                                                                               | No trigger was recorded. Suggested: a profile that shows time in driver binding or row materialization rather than in SQLite                                    |
| Tantivy or another search engine in place of FTS5                                         | Keep FTS5 (2026-09-28 and 2026-10-04) | Source and documentation read; no engine performance measured. FTS5 runs in the same process and transaction as the writes, with no second searchable copy to keep in sync                                                                                                                                                                   | Profiling shows an FTS5 bottleneck on your corpus. Tantivy is then the first embedded alternative worth a controlled comparison                                 |

## Runtime notes

- **Bun's `node:sqlite` `get()`** was about 1.5 times slower than Node's when
  returning table columns, because it builds a new row structure per call. A fix
  pull request was open when this was written
  ([oven-sh/bun#44084](https://github.com/oven-sh/bun/issues/44084)).
- **`SQLITE_DEFAULT_MEMSTATUS`.** The SQLite documentation recommends
  `SQLITE_DEFAULT_MEMSTATUS=0`. `PRAGMA compile_options` shows it on Node's
  SQLite but not on Bun's (checked 2026-10-12, both SQLite 3.53.4). A plain C
  program with 8 threads, each on its own connection, ran each thread about 25%
  slower with memory statistics on. The 8-thread to 1-thread time ratio was 0.89
  to 1.03 with them on and 0.71 to 0.82 with them off, over 3 alternating
  rounds. One thread showed no difference. No Bun build with the flag was run,
  so its share of Bun's slower multi-worker reads is suspected, not confirmed
  ([oven-sh/bun#44187](https://github.com/oven-sh/bun/issues/44187)).
- **Different runtimes in one process.** Two SQLite builds in one process on one
  WAL file corrupted state; give the second library a checkpointed copy.

## Held, unselected

- A pre-backup `sqlite3 .backup` step ahead of file-level snapshots. One restore
  of live database and WAL files opened cleanly, so it stayed a possible
  hardening item. Against an active writer `.backup` restarts (see the
  evidence), so it needs a quiet writer or a bounded retry.
