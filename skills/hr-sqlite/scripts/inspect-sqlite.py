#!/usr/bin/env python3
"""Read-only inspection of a SQLite database file and, optionally, the source
that opens it.

    inspect-sqlite.py DATABASE [--source PATH ...] [--quick-check] [--json]

Reports what the file itself records (journal mode, page and freelist counts,
planner statistics, FTS tables, WAL size) plus the filesystem it sits on. It
never writes to the database. SQLite may create an empty `-shm` file beside a
WAL database that no process has open.

Connection settings such as busy_timeout, synchronous, foreign_keys and
cache_size are not stored in the file, so no database inspection can show what
an application sets. `--source` is a text scan: for each mention of
journal_mode it reports whether a busy_timeout mention comes earlier in the
same file. It does not establish run order or which connection each belongs
to. Treat those lines as places to read, not verdicts.
"""
import argparse
import json
import os
import pathlib
import re
import sqlite3
import sys

NETWORK_FILESYSTEMS = {"9p", "drvfs", "cifs", "smb3", "smbfs", "nfs", "nfs4", "fuse.sshfs", "virtiofs"}
SHADOW_SUFFIXES = ("_data", "_idx", "_content", "_docsize", "_config", "_segments", "_segdir", "_stat", "_node", "_parent", "_rowid")
SOURCE_SUFFIXES = {".py", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".rs", ".go", ".rb", ".java", ".kt", ".cs", ".c", ".cc", ".cpp", ".swift", ".php", ".sql"}


def mount_for(path):
    """Return (mount point, filesystem type, options) for the longest mount prefix."""
    try:
        with open("/proc/self/mountinfo", encoding="utf-8", errors="replace") as handle:
            lines = handle.read().splitlines()
    except OSError:
        return None
    real = os.path.realpath(path)
    best = None
    for line in lines:
        left, _, right = line.partition(" - ")
        fields = left.split()
        if len(fields) < 6 or len(right.split()) < 3:
            continue
        point = fields[4].replace("\\040", " ")
        if real == point or real.startswith(point.rstrip("/") + "/") or point == "/":
            if best is None or len(point) > len(best[0]):
                kind, _, super_options = right.split()[:3]
                best = (point, kind, ",".join([fields[5], super_options]))
    return best


def scan_source(paths):
    """For each file that mentions journal_mode, note where busy_timeout appears."""
    findings = []
    files = []
    for entry in paths:
        if os.path.isdir(entry):
            for root, dirs, names in os.walk(entry):
                dirs[:] = [d for d in dirs if d not in {".git", "node_modules", ".venv", "target", "dist"}]
                files.extend(
                    os.path.join(root, n) for n in names if os.path.splitext(n)[1] in SOURCE_SUFFIXES
                )
        else:
            files.append(entry)
    for file in sorted(files):
        try:
            with open(file, encoding="utf-8", errors="replace") as handle:
                lines = handle.read().splitlines()
        except OSError:
            continue
        journals = [i + 1 for i, l in enumerate(lines) if re.search(r"journal_mode", l, re.I)]
        timeouts = [i + 1 for i, l in enumerate(lines) if re.search(r"busy_timeout|busyTimeout|set_busy_timeout", l, re.I)]
        for journal in journals:
            earlier = [t for t in timeouts if t < journal]
            if earlier:
                status = "busy_timeout at line %d comes before journal_mode at line %d" % (earlier[-1], journal)
            elif timeouts:
                status = "journal_mode at line %d comes before busy_timeout at line %d" % (journal, timeouts[0])
            else:
                status = "journal_mode at line %d; no busy_timeout in this file" % journal
            findings.append({"file": file, "line": journal, "status": status, "ok": bool(earlier)})
    return findings


def inspect(path, quick_check=False):
    result = {"path": os.path.abspath(path)}
    size = os.path.getsize(path)
    result["fileBytes"] = size
    uri = pathlib.Path(result["path"]).as_uri() + "?mode=ro"
    connection = sqlite3.connect(uri, uri=True, timeout=2)
    try:
        connection.execute("PRAGMA busy_timeout = 2000")

        def pragma(name):
            row = connection.execute("PRAGMA " + name).fetchone()
            return row[0] if row else None

        result["library"] = {"version": sqlite3.sqlite_version}
        options = [r[0] for r in connection.execute("PRAGMA compile_options")]
        result["library"]["memstatusDisabled"] = "DEFAULT_MEMSTATUS=0" in options
        result["library"]["threadsafe"] = next((o for o in options if o.startswith("THREADSAFE")), None)
        result["journalMode"] = pragma("journal_mode")
        result["pageSize"] = pragma("page_size")
        result["pageCount"] = pragma("page_count")
        result["freelistCount"] = pragma("freelist_count")
        result["autoVacuum"] = pragma("auto_vacuum")
        result["userVersion"] = pragma("user_version")
        result["encoding"] = pragma("encoding")
        names = connection.execute(
            "SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name"
        ).fetchall()
        tables = [n for n, _ in names if not n.startswith("sqlite_")]
        virtual = {n: s for n, s in names if s and s.upper().startswith("CREATE VIRTUAL TABLE")}
        shadow = {n for table in virtual for n in tables if n in {table + s for s in SHADOW_SUFFIXES}}
        plain = [n for n in tables if n not in virtual and n not in shadow]
        result["tables"] = len(plain)
        result["indexes"] = connection.execute(
            "SELECT count(*) FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'"
        ).fetchone()[0]
        result["virtualTables"] = {
            n: (re.search(r"USING\s+(\w+)", s, re.I) or [None, "unknown"])[1].lower()
            for n, s in virtual.items()
        }
        has_stat = any(n == "sqlite_stat1" for n, _ in names)
        analyzed = set()
        if has_stat:
            analyzed = {r[0] for r in connection.execute("SELECT DISTINCT tbl FROM sqlite_stat1")}
        result["statistics"] = {
            "sqliteStat1": has_stat,
            "rows": connection.execute("SELECT count(*) FROM sqlite_stat1").fetchone()[0] if has_stat else 0,
            "tablesWithoutStatistics": [n for n in plain if n not in analyzed],
        }
        if quick_check:
            result["quickCheck"] = [r[0] for r in connection.execute("PRAGMA quick_check(10)")]
    finally:
        connection.close()
    for suffix, key in (("-wal", "walBytes"), ("-shm", "shmBytes")):
        side = result["path"] + suffix
        result[key] = os.path.getsize(side) if os.path.exists(side) else None
    mount = mount_for(result["path"])
    if mount:
        point, kind, options = mount
        result["filesystem"] = {"mount": point, "type": kind, "options": options}
    else:
        result["filesystem"] = None
    return result


def notes(result):
    out = []
    if result["journalMode"] != "wal":
        out.append("journal_mode is %s, not wal; concurrent readers and one writer will block each other" % result["journalMode"])
    stats = result["statistics"]
    if not stats["sqliteStat1"]:
        out.append("no sqlite_stat1: the planner has no statistics; run PRAGMA optimize at a time you choose (the first run on a large file can take over a minute and hold the write lock)")
    elif stats["tablesWithoutStatistics"]:
        out.append("tables with no statistics rows: " + ", ".join(stats["tablesWithoutStatistics"][:8]))
    pages = result["pageCount"] or 0
    if pages and result["freelistCount"] and result["freelistCount"] / pages > 0.2:
        out.append("more than 20%% of pages are free (%d of %d); the file is larger than its content" % (result["freelistCount"], pages))
    if result["walBytes"] and result["walBytes"] > result["fileBytes"]:
        out.append("the WAL file is larger than the database; look for a long-running reader or a blocked checkpoint")
    fs = result["filesystem"]
    if fs:
        if fs["type"] in NETWORK_FILESYSTEMS:
            out.append("filesystem %s: WAL needs shared memory on one host and does not work reliably here" % fs["type"])
        if re.search(r"(^|,)discard(,|$)", fs["options"]):
            out.append("mounted with online discard; this stalled fsync on one host (see the evidence), so check fsync latency")
    if "quickCheck" in result and result["quickCheck"] != ["ok"]:
        out.append("quick_check reported: " + "; ".join(result["quickCheck"][:3]))
    return out


def render(result, source):
    lines = ["database: %s" % result["path"]]
    lines.append("size: %d bytes; %s pages of %s bytes; %s free" % (
        result["fileBytes"], result["pageCount"], result["pageSize"], result["freelistCount"]))
    lines.append("journal_mode: %s; auto_vacuum: %s; user_version: %s; encoding: %s" % (
        result["journalMode"], result["autoVacuum"], result["userVersion"], result["encoding"]))
    lines.append("tables: %d; indexes: %d; virtual tables: %s" % (
        result["tables"], result["indexes"],
        ", ".join("%s (%s)" % kv for kv in result["virtualTables"].items()) or "none"))
    stats = result["statistics"]
    lines.append("statistics: sqlite_stat1 %s, %d rows" % ("present" if stats["sqliteStat1"] else "absent", stats["rows"]))
    lines.append("wal file: %s; shm file: %s" % (result["walBytes"], result["shmBytes"]))
    fs = result["filesystem"]
    lines.append("filesystem: %s" % ("%s at %s (%s)" % (fs["type"], fs["mount"], fs["options"]) if fs else "not available on this platform"))
    lines.append("inspector library: SQLite %s, %s" % (result["library"]["version"], result["library"]["threadsafe"]))
    lines.append("not in the file: busy_timeout, synchronous, foreign_keys, cache_size, mmap_size, temp_store; read the code that opens the connection")
    for note in notes(result):
        lines.append("note: " + note)
    if source is not None:
        lines.append("source scan (journal_mode mentions): %d" % len(source))
        for item in source:
            lines.append("  %s: %s%s" % (item["file"], item["status"], "" if item["ok"] else "  <- read this"))
    return "\n".join(lines)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("database")
    parser.add_argument("--source", nargs="+", metavar="PATH", help="files or directories to scan for busy_timeout order")
    parser.add_argument("--quick-check", action="store_true", help="also run PRAGMA quick_check (reads the whole file)")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    if not os.path.isfile(args.database):
        print("error: not a file: %s" % args.database, file=sys.stderr)
        return 2
    try:
        result = inspect(args.database, args.quick_check)
    except (sqlite3.Error, OSError) as error:
        print("error: %s" % error, file=sys.stderr)
        return 2
    source = scan_source(args.source) if args.source else None
    if args.json:
        payload = dict(result)
        payload["notes"] = notes(result)
        if source is not None:
            payload["source"] = source
        print(json.dumps(payload, indent=2, sort_keys=True))
    else:
        print(render(result, source))
    return 0


if __name__ == "__main__":
    sys.exit(main())
