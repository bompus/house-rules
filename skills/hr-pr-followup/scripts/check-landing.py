#!/usr/bin/env python3
"""Report whether a checkout's work has landed in the base branch.

Squash-aware: a session branch whose commits were squash-merged is never an
ancestor of the base, so ancestry alone would cry unlanded forever. The check
therefore compares content: files unique to the checkout must be identical in
the base. Read-only; never fetches — the caller fetches first.

It also lists live processes whose working directory is inside the checkout
(Linux /proc only), excluding the checker's ancestors and its pipeline. Each listed process
blocks worktree removal unless its PID is one you recorded when you started it. The list says nothing
about landing or about fast-forwarding a default checkout: neither reads it. `own_session`
is true only for a process that descends from the nearest agent CLI above the checker (a
process whose comm is one of AGENT_COMMS); a process under another session of the same agent
host's server, or any process when the checker has no agent ancestor, is false. A process
reparented to init after its parent exited is false too.

Usage:
    python3 scripts/check-landing.py [--path <checkout>] [--base <ref>]
    python3 scripts/check-landing.py --path <checkout> --fail-on-unlanded

Without --base the base is origin/HEAD (the remote's default branch, which
need not be main), falling back to origin/main when origin/HEAD is unset.
"""

import argparse
import json
import os
import subprocess
import sys


def git(path, *args):
    return subprocess.run(
        ["git", *args],
        cwd=path,
        capture_output=True,
        text=True,
        timeout=60,
    )


def default_base(path):
    """origin/HEAD's target (e.g. origin/fork/consolidated), else origin/main."""
    r = git(path, "symbolic-ref", "--quiet", "--short",
            "refs/remotes/origin/HEAD")
    return r.stdout.strip() if r.returncode == 0 and r.stdout.strip() \
        else "origin/main"


def _ppid(pid):
    try:
        with open(f"/proc/{pid}/stat", encoding="utf-8", errors="replace") as f:
            return int(f.read().rsplit(")", 1)[1].split()[1])
    except (OSError, ValueError, IndexError):
        return 0


# comm names of the agent CLIs. "opencode.exe" is matched without its suffix.
AGENT_COMMS = {"claude", "codex", "cursor-agent", "opencode", "grok", "devin", "agy"}


def _comm(pid):
    try:
        with open(f"/proc/{pid}/comm", encoding="utf-8", errors="replace") as f:
            return f.read().strip()
    except OSError:
        return ""


def _chain(pid):
    """pid and its parents up to, but excluding, PID 1."""
    chain = []
    while pid > 1 and pid not in chain:
        chain.append(pid)
        pid = _ppid(pid)
    return chain


def nearest_agent(chain, read_comm=_comm):
    """First PID in chain whose comm is an agent CLI, else None."""
    for pid in chain:
        name = read_comm(pid)
        if name.endswith(".exe"):
            name = name[:-4]
        if name in AGENT_COMMS:
            return pid
    return None


def checkout_processes(path):
    """Processes whose cwd is inside path, or None without /proc."""
    if not os.path.isdir("/proc/self"):
        return None
    root = os.path.realpath(path)
    mine = _chain(os.getpid())
    ancestors = set(mine)
    agent = nearest_agent(mine)
    own_group = os.getpgid(0)
    found = []
    for entry in os.listdir("/proc"):
        if not entry.isdigit() or int(entry) in ancestors:
            continue
        try:
            if os.getpgid(int(entry)) == own_group:
                continue
            cwd = os.readlink(f"/proc/{entry}/cwd")
            with open(f"/proc/{entry}/comm", encoding="utf-8", errors="replace") as f:
                comm = f.read().strip()
        except (OSError, ProcessLookupError):
            continue
        if cwd != root and not cwd.startswith(root + os.sep):
            continue
        own = agent is not None and agent in _chain(int(entry))
        found.append({"pid": int(entry), "own_session": own,
                      "comm": comm})
    return found


def landing_state(path, base):
    """Return a JSON-serializable report dict for the checkout at path."""
    report = {"path": str(path), "base": base, "ok": False, "reason": ""}
    r = git(path, "rev-parse", "--verify", "--quiet", base)
    if r.returncode != 0:
        report["reason"] = f"base ref missing: {base}"
        return report
    report["base_head"] = r.stdout.strip()
    r = git(path, "rev-parse", "HEAD")
    if r.returncode != 0:
        report["reason"] = "not a git checkout (no HEAD)"
        return report
    report["head"] = r.stdout.strip()
    r = git(path, "symbolic-ref", "--quiet", "--short", "HEAD")
    report["branch"] = r.stdout.strip() if r.returncode == 0 else None
    r = git(path, "status", "--porcelain")
    if r.returncode != 0:
        report["reason"] = "git status failed"
        return report
    report["clean"] = r.stdout.strip() == ""
    report["processes"] = checkout_processes(path)
    r = git(path, "merge-base", "--is-ancestor", "HEAD", base)
    report["ancestor"] = r.returncode == 0
    if report["ancestor"]:
        report["content_landed"] = True
    else:
        r = git(path, "merge-base", base, "HEAD")
        if r.returncode != 0:
            report["reason"] = "no merge base with base ref"
            return report
        mb = r.stdout.strip()
        r = git(path, "diff", "--name-only", "--no-renames", "-z", mb, "HEAD")
        if r.returncode != 0:
            report["reason"] = "git diff failed"
            return report
        files = [f for f in r.stdout.split("\0") if f]
        report["unique_files"] = len(files)
        if not files:
            report["content_landed"] = True
        else:
            r = git(path, "diff", "--quiet", "HEAD", base, "--", *files)
            report["content_landed"] = r.returncode == 0
            report["indeterminate"] = False
            if not report["content_landed"]:
                # Base may have advanced on the same files after the merge
                # base: then a diff is expected even for landed content.
                r = git(path, "diff", "--name-only", "--no-renames", "-z", mb, base,
                         "--", *files)
                if r.returncode == 0 and any(
                        f for f in r.stdout.split("\0") if f):
                    report["indeterminate"] = True
    landed = bool(report["content_landed"])
    if landed and report["clean"]:
        report["ok"] = True
        report["reason"] = "landed and clean"
    elif landed:
        report["reason"] = "content landed but tree is dirty"
    elif report.get("indeterminate"):
        report["reason"] = ("indeterminate - base advanced on touched "
                            "files, confirm PR")
    else:
        report["reason"] = "unlanded content vs base"
    return report


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--path", default=".", help="checkout to inspect")
    ap.add_argument(
        "--base", help="base ref (default: origin/HEAD, else origin/main)"
    )
    ap.add_argument(
        "--fail-on-unlanded",
        action="store_true",
        help="exit 1 unless the checkout is clean and landed",
    )
    args = ap.parse_args(argv)
    report = landing_state(args.path, args.base or default_base(args.path))
    print(json.dumps(report, indent=2))
    if args.fail_on_unlanded and not report["ok"]:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
