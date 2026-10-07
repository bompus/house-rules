#!/usr/bin/env python3
"""Navigation analysis of explicitly selected coding-agent transcripts.

  retro.py rank --repo-root NAME=ROOT ... [--since-days 30] [--repo NAME ...]
               [--top 8] [--subagents] [--json PATH] TRANSCRIPT ...
  retro.py timeline <transcript.jsonl> [--width 240]

`rank` reads only the explicit TRANSCRIPT files, counts events within the
requested timestamp window, and prints one summary row per
repository (with at least --min-sessions sessions), then the highest-scoring
sessions per repository with their transcript path. `timeline` prints one
transcript as prompts, assistant text, numbered tool calls and `!!` failed or
empty results, so a session can be read without loading the raw JSONL.

Per-session metrics:
  tools     tool calls
  nav       navigation calls: Read/Grep/Glob/LS, codegraph_explore, or a shell
            command that starts with grep, rg, find, ls, cat, sed -n, head, tail,
            tree, git grep/log/show, fd, wc, awk or codegraph explore
  navEdit   navigation calls before the first edit (Edit/Write/apply_patch)
  misses    navigation that found nothing: "No matches/No files found", or a
            missing-file error. `.codegraph/*` globs, `opencode*` patterns and
            ToolSearch are excluded as noise.
  widen     a miss within 4 calls of the previous miss (a search being widened)
  rereads   files read 3+ times (Read, or cat/sed -n/head/tail on a path)
  stale     unverified assistant text matches about stale, moved or wrong paths
  score     misses + 2*widen + 2*rereads (heuristic weights; stale text matches
            remain visible but do not contribute to ranking)
  rate      score per 100 tool calls. The top list sorts by rate (or --sort
            score) among sessions with at least --min-tools calls, so a long
            session does not outrank a short one by length alone.

Limits: Claude/Codex JSONL, OpenCode JSON exports, Cursor stream JSON and ACP v1
recordings. All recorded events are included unless --since-days is requested;
missing or malformed timestamps are excluded from dated rank. Repository names
come from explicit root mappings and each command's working directory, falling
back to session metadata. Unmapped paths remain unknown.
One batched call counts once in each participating repository, so summed rows
can exceed outer calls. Mixed-repository results and remarks are ambiguous and
are not counted as misses or stale remarks. Dynamic command directories remain
unknown. Literal leading cd and normalized absolute read paths are supported;
complex shell state and JavaScript expressions are not evaluated.
Outputs contain raw session text and filesystem paths, without redaction.
Keep them local. --json overwrites its output, but cannot overwrite an input.
"""
import argparse
import collections
import json
import os
import re
import sys
import time
import shlex
import math
from datetime import datetime, timezone
from transcripts import records, opencode, acp_update, acp_calls, acp, cursor

if sys.version_info < (3, 11):
    sys.exit("retro.py requires Python 3.11 or newer")

HOME = os.path.expanduser("~")
REPO_ROOTS = []
DEFAULT_CWD = None
NAV_TOOLS = {"Read", "Grep", "Glob", "LS"}
EDIT_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit", "apply_patch"}
NAV_SHELL = re.compile(
    r"^\s*(?:cd [^;&]+(?:&&|;)\s*)?(grep|rg|find|ls|cat|sed -n|head|tail|tree|git grep|git log|git show|fd|wc|awk|codegraph explore)\b",
    re.M,
)
EMPTY_SEARCH = re.compile(r"\s*(No matches found|No files found)")
MISSING_FILE = re.compile(r"No such file or directory|File does not exist|does not exist|ENOENT")
NOISE = re.compile(r"\.codegraph/\*|opencode\*|^select:")
READ_PATH = re.compile(r"(?:sed -n \S+ |cat |head (?:-n ?\d+ |-\d+ )?|tail (?:-n ?\d+ |-\d+ )?)((?:[A-Za-z]:)?[~\w./\\-]+\.\w+)")
STALE = re.compile(
    r"out of date|out-of-date|\bstale\b|outdated|no longer (?:exists?|there|true|accurate)"
    r"|doesn'?t (?:match|exist)|does not (?:match|exist)|wrong path|moved to"
    r"|(?:docs?|README|AGENTS\.md|CLAUDE\.md|plan|guidance|skill) (?:says|said|claims|still says)"
    r"|(?:was|has been) (?:removed|renamed|moved)",
    re.I,
)


def repo_of(cwd):
    if not isinstance(cwd, str) or not cwd or not os.path.isabs(cwd):
        return "?"
    path = os.path.normcase(os.path.normpath(cwd))
    for name, root in REPO_ROOTS:
        try:
            if os.path.commonpath([path, root]) == root:
                return name
        except ValueError:  # Different filesystem drives.
            continue
    return "?"


def text_of(content):
    if isinstance(content, list):
        return " ".join(c.get("text", "") for c in content if isinstance(c, dict))
    return content if isinstance(content, str) else json.dumps(content) if content else ""


JS_STRING = r'''"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`'''
JS_COMMAND = re.compile(r'exec_command\(\s*(\{(?:' + JS_STRING + r'|[^{}"\'`])*\})')
JS_FIELD = re.compile(JS_STRING + r'|(?P<key>\b(?:cmd|workdir))\s*:')


def shell_commands(name, arg, cwd):
    """Shell commands run by a call: Claude Bash, Codex exec_command, or each
    tools.exec_command in a Codex `exec` code cell. Empty for other tools."""
    if name == "Bash":
        return [(arg, cwd)]
    if name == "exec":
        commands = []
        for obj in JS_COMMAND.findall(arg):
            fields = {}
            seen = set()
            for match in JS_FIELD.finditer(obj):
                key = match.group('key')
                rest = obj[match.end():].lstrip()
                if not key:
                    # Quoted property names are valid; quoted values are not keys.
                    token = match[0]
                    key = token[1:-1]
                    if key not in ('cmd', 'workdir') or not rest.startswith(':'):
                        continue
                    rest = rest[1:].lstrip()
                seen.add(key)
                fields.pop(key, None)  # A later unresolved value replaces an earlier literal.
                value = re.match(JS_STRING, rest)
                if not value or not rest[value.end():].lstrip().startswith((',', '}')):
                    continue
                literal = value[0]
                if '${' in literal or '`' in literal[1:-1]:
                    continue
                try:
                    fields[key] = json.loads(literal) if literal[0] == '"' else literal[1:-1]
                except ValueError:
                    continue
            syntax = re.sub(JS_STRING, '""', obj)
            unresolved = '...' in syntax or re.search(r'[,{}]\s*workdir\s*[,}]', syntax)
            workdir = None if unresolved else fields.get('workdir') if 'workdir' in seen else cwd
            commands.append((fields.get('cmd'), workdir))
        if len(re.findall(r'\bexec_command\s*\(', arg)) > len(commands):
            commands.append((None, None))  # An unparsed child keeps the result ambiguous.
        return commands
    if name in ("exec_command", "shell", "local_shell"):
        try:
            parsed = json.loads(arg)
        except ValueError:
            return [(arg, cwd)]
        value = parsed.get("cmd") or parsed.get("command") if isinstance(parsed, dict) else None
        if isinstance(value, list):
            if not all(isinstance(part, str) for part in value):
                return [(None, parsed.get('workdir', cwd))]
            command = value[-1] if len(value) >= 3 and value[1] in ('-c', '-lc') else ' '.join(value)
            return [(command, parsed.get('workdir', cwd))]
        return [(value if isinstance(value, str) else arg, parsed.get('workdir', cwd) if isinstance(parsed, dict) else cwd)]
    return []


def physical_path(path, cwd):
    if not isinstance(path, str) or not path or '$' in path or '`' in path:
        return None
    if path == '~' or path.startswith('~/'):
        path = HOME + path[1:]
    if not os.path.isabs(path):
        if not cwd:
            return None
        path = os.path.join(cwd, path)
    return os.path.normpath(path)


def command_context(command, cwd):
    if not isinstance(command, str):
        return None, cwd
    match = re.match(r'^\s*cd\s+([^;&\n]+)\s*(?:&&|;)\s*', command)
    if match:
        try:
            parts = shlex.split(match[1])
        except ValueError:
            parts = []
        cwd = physical_path(parts[0], cwd) if len(parts) == 1 else None
        command = command[match.end():]
    return command, cwd


def timestamp(value):
    try:
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return (value / 1000 if value > 100_000_000_000 else value) if math.isfinite(value) else None
        date = datetime.fromisoformat(value)
        return date.replace(tzinfo=timezone.utc).timestamp() if date.tzinfo is None else date.timestamp()
    except (TypeError, ValueError, OverflowError):
        return None


def raw_events(path):
    """Normalized events from a Claude or Codex transcript.

    ("meta", cwd, title, sub) | ("context", cwd) | ("user", text) | ("assistant", text)
    | ("call", name, arg, id) | ("result", id, text, is_error), each followed
    by its record timestamp in seconds, or None when unavailable.
    """
    if DEFAULT_CWD:
        yield ('meta', DEFAULT_CWD, '', False, None)
    calls, seen, finished, cursor_seen = None, set(), set(), set()
    session_ids = set()
    for record in records(path):
        if isinstance(record.get('messages'), list) and isinstance(record.get('info'), dict):
            yield from opencode(record, timestamp)
            continue
        session, update = acp_update(record)
        if isinstance(update, dict):
            if isinstance(session, str) and session:
                session_ids.add(session)
                if len(session_ids) > 1:
                    raise ValueError('select one ACP session per transcript')
            if calls is None:
                calls = acp_calls(path)
            yield from acp(record, calls, seen, finished, timestamp)
            continue
        if record.get('method') in ('session/new', 'session/load', 'session/resume'):
            params = record.get('params')
            if isinstance(params, dict) and isinstance(params.get('cwd'), str):
                yield ('context', params['cwd'], timestamp(record.get('timestamp')))
            continue
        if record.get('type') == 'tool_call' and isinstance(record.get('tool_call'), dict):
            yield from cursor(record, cursor_seen, timestamp)
            continue
        payload = record.get("payload")
        stamp = timestamp(record.get('timestamp_ms')) or timestamp(record.get('timestamp'))
        emit = lambda event: (*event, stamp)
        if isinstance(payload, dict):
            kind = payload.get("type")
            if record.get("type") == "session_meta":
                sub = payload.get("source") == "exec" or payload.get("originator") == "codex_exec"
                yield emit(("meta", payload.get("cwd"), "", sub))
            elif record.get('type') == 'turn_context':
                yield emit(('context', payload.get('cwd')))
            elif kind == "message":
                role = payload.get("role")
                if role in ('user', 'assistant'):
                    yield emit((role, text_of(payload.get("content"))))
            elif kind in ("function_call", "custom_tool_call"):
                arg = payload.get("arguments") or payload.get("input") or ""
                yield emit(("call", payload.get("name") or "", arg if isinstance(arg, str) else json.dumps(arg), payload.get("call_id")))
            elif kind in ("function_call_output", "custom_tool_call_output"):
                yield emit(("result", payload.get("call_id"), text_of(payload.get("output")), False))
            continue
        if record.get("type") == "ai-title":
            yield emit(("meta", None, record.get("aiTitle", ""), False))
        if record.get("cwd"):
            yield emit(("meta", record["cwd"], "", False))
        message = record.get("message")
        if not isinstance(message, dict):
            continue
        content = message.get("content")
        role = message.get('role', record.get('type'))
        if isinstance(content, str):
            if role in ('user', 'assistant'):
                yield emit((role, content))
            continue
        for part in content if isinstance(content, list) else []:
            if not isinstance(part, dict):
                continue
            kind = part.get("type")
            if kind == "text":
                if role in ('user', 'assistant'):
                    yield emit((role, part.get("text", "")))
            elif kind == "tool_use":
                inp = part.get("input")
                if not isinstance(inp, dict):
                    continue
                arg = inp.get("command") or inp.get("file_path") or inp.get("pattern") or inp.get("query") or inp.get("prompt") or json.dumps(inp)
                yield emit(("call", part.get("name") or "", str(arg), part.get("id")))
            elif kind == "tool_result":
                yield emit(("result", part.get("tool_use_id"), text_of(part.get("content")), bool(part.get("is_error"))))


def events(path):
    chunks = []
    role, stamp = None, None
    for event in raw_events(path):
        kind = event[0]
        if kind in ('user_chunk', 'assistant_chunk'):
            next_role = kind.removesuffix('_chunk')
            if role and next_role != role:
                yield (role, ''.join(chunks), stamp)
                chunks = []
            if not chunks:
                role, stamp = next_role, event[-1]
            chunks.append(event[1])
            continue
        if chunks:
            yield (role, ''.join(chunks), stamp)
            chunks, role = [], None
        yield event
    if chunks:
        yield (role, ''.join(chunks), stamp)


def missing_path(text, is_error=False):
    """Inspect complete result diagnostics, including serialized shell outputs."""
    lines = text.splitlines()
    decoder = json.JSONDecoder()
    fence = None
    for line in lines:
        rest = line.lstrip()
        marker = re.match(r'(`{3,}|~{3,})(.*)$', rest)
        if fence:
            if marker and marker[1][0] == fence[0] and len(marker[1]) >= len(fence) and not marker[2].strip():
                fence = None
            continue
        if marker:
            fence = marker[1]
            continue
        while rest.startswith('{'):
            try:
                result, end = decoder.raw_decode(rest)
            except ValueError:
                break
            if isinstance(result, dict):
                if is_error and result.get('code') == 'ENOENT':
                    return 'ENOENT: ' + str(result.get('message', 'missing path'))
                if ('chunk_id' in result or 'wall_time_seconds' in result) and isinstance(result.get('output'), str):
                    lines.extend(result['output'].splitlines())
            rest = rest[end:].lstrip()
        if re.match(r'^(?:cat|rg|grep|find|ls|sed|head|tail|bash|sh|Error|FileNotFoundError):', rest) or re.match(
            r'^(?:No such file or directory|File does not exist|does not exist|ENOENT)\b', rest
        ):
            if MISSING_FILE.search(rest):
                return rest
    return None


def scan(path, sub=False, cutoff=None):
    rows = {}
    cwd, title, prompt, index = None, '', '', 0
    last_repos = set()
    pending = {}
    total_calls, undated = 0, 0
    def state(repo):
        if repo not in rows:
            rows[repo] = dict(path=path, repo=repo, sub=sub, title=title, prompt=prompt,
                              tools=0, nav=0, navEdit=None, misses=0, widen=0,
                              rereads=0, stale=0, missExamples=[], staleExamples=[],
                              rereadFiles=[], reads=collections.Counter(), last_miss=None)
        return rows[repo]
    for stamped in events(path):
        *event, stamp = stamped
        kind = event[0]
        if kind == "context":
            cwd = event[1] or cwd
            last_repos = set()
            continue
        if kind == "meta":
            _, new_cwd, new_title, is_sub = event
            if new_cwd and new_cwd != cwd:
                last_repos = set()
            cwd = new_cwd or cwd
            title = title or new_title
            sub = sub or is_sub
            continue
        if kind == 'call':
            index += 1  # Same full-transcript numbering as timeline.
            total_calls += 1
            undated += stamp is None
        if cutoff is not None and (stamp is None or stamp < cutoff):
            continue
        elif kind == "user":
            text = event[1].strip()
            if not prompt and text and not text.startswith(("<", "#")):
                prompt = re.sub(r"\s+", " ", text)[:160]
        elif kind == "assistant":
            if len(last_repos) > 1:
                continue  # Do not duplicate an ambiguous batch's remarks.
            s = state(next(iter(last_repos), repo_of(cwd)))
            for match in STALE.finditer(event[1]):
                s["stale"] += 1
                if len(s["staleExamples"]) < 10:
                    snippet = event[1][max(0, match.start() - 140): match.end() + 140]
                    s["staleExamples"].append([index, re.sub(r"\s+", " ", snippet)])
        elif kind == "call":
            _, name, arg, call_id = event
            commands = [command_context(c, physical_path(d, cwd)) for c, d in shell_commands(name, arg, cwd)]
            targets = {}
            for command, directory in commands:
                repo = repo_of(directory)
                paths = [physical_path(m[1], directory) for m in READ_PATH.finditer(command or '')]
                targets.setdefault(repo, [False, []])
                targets[repo][0] |= bool(command and NAV_SHELL.search(command))
                targets[repo][1].extend(p for p in paths if p)
            if not targets:
                file = physical_path(arg, cwd) if name == 'Read' else None
                targets[repo_of(file or cwd)] = [name in NAV_TOOLS or 'codegraph_explore' in name, [file] if file else []]
            is_edit = name in EDIT_TOOLS or (name == "exec" and "apply_patch" in arg) or "*** Begin Patch" in arg[:200]
            for repo, (is_nav, paths) in targets.items():
                s = state(repo)
                s['tools'] += 1
                if is_edit and s['navEdit'] is None:
                    s['navEdit'] = s['nav']
                s['nav'] += is_nav
                s['reads'].update(paths)
            pending[call_id] = (name, arg, targets, index)
            last_repos = set(targets)
        elif kind == "result":
            _, call_id, text, is_error = event
            name, arg, targets, call_index = pending.get(call_id, ('', '', {}, 0))
            if len(targets) != 1 or NOISE.search(arg) or name == 'ToolSearch':
                continue
            repo = next(iter(targets))
            if not targets[repo][0]:
                continue
            miss = (name in ("Grep", "Glob") and EMPTY_SEARCH.match(text)) or (
                (is_error or name not in NAV_TOOLS) and missing_path(text, is_error)
            )
            if miss:
                s = state(repo)
                s["misses"] += 1
                if s['last_miss'] is not None and 0 <= call_index - s['last_miss'] <= 4:
                    s["widen"] += 1
                s['last_miss'] = call_index
                if len(s["missExamples"]) < 8:
                    s["missExamples"].append([call_index, name, arg[:160]])
    if not total_calls:
        print(f'warning: no supported tool-call evidence in {path}', file=sys.stderr)
    if undated:
        action = 'excluded from dated ranking' if cutoff is not None else 'included without date filtering'
        print(f'warning: {undated} undated tool calls {action} in {path}', file=sys.stderr)
    for s in rows.values():
        reads = s.pop('reads')
        s.pop('last_miss')
        s.update(title=title, prompt=prompt, sub=sub)
        s["rereadFiles"] = [[f.replace(HOME, '~', 1), n] for f, n in reads.most_common() if n >= 3][:8]
        s["rereads"] = sum(n >= 3 for n in reads.values())
        s["score"] = s["misses"] + 2 * s["widen"] + 2 * s["rereads"]
        s["rate"] = round(100 * s["score"] / max(s["tools"], 1), 1)
    return list(rows.values())


def rank(args):
    cutoff = time.time() - args.since_days * 86400 if args.since_days is not None else None
    sessions = [row for path in args.transcripts
                for row in scan(path, "/subagents/" in path.replace("\\", "/"), cutoff)]
    sessions = [s for s in sessions if s["tools"] and (args.subagents or not s["sub"])]
    if args.repo:
        sessions = [s for s in sessions if s["repo"] in args.repo]
    if args.json:
        with open(args.json, "w") as out:
            json.dump(sessions, out)
    by_repo = collections.defaultdict(list)
    for s in sessions:
        by_repo[s["repo"]].append(s)
    repos = sorted((r for r, rows in by_repo.items() if len(rows) >= args.min_sessions), key=lambda r: -len(by_repo[r]))
    hidden = sum(len(rows) for r, rows in by_repo.items() if r not in repos)
    print(f"{'repo':32} {'sessions':>8} {'tools':>7} {'nav%':>5} {'navEdit':>7} {'misses':>6} {'widen':>5} {'rereads':>7} {'stale':>5}")
    for repo in repos:
        rows = by_repo[repo]
        tools = sum(s["tools"] for s in rows)
        before_edit = sorted(s["navEdit"] for s in rows if s["navEdit"] is not None)
        median = before_edit[len(before_edit) // 2] if before_edit else "-"
        nav_share = 100 * sum(s["nav"] for s in rows) // max(tools, 1)
        print(f"{repo[:32]:32} {len(rows):8} {tools:7} {nav_share:4}% {median!s:>7} "
              + " ".join(f"{sum(s[k] for s in rows):{w}}" for k, w in (("misses", 6), ("widen", 5), ("rereads", 7), ("stale", 5))))
    if hidden:
        print(f"({hidden} sessions omitted: fewer than --min-sessions)")
    for repo in repos:
        print(f"\n== {repo}: top sessions by {args.sort}")
        ranked = sorted((s for s in by_repo[repo] if s["tools"] >= args.min_tools), key=lambda s: -s[args.sort])
        for s in ranked[: args.top]:
            print(f"  rate={s['rate']} score={s['score']} misses={s['misses']} widen={s['widen']} rereads={s['rereads']} "
                  f"stale={s['stale']} tools={s['tools']} | {(s['title'] or s['prompt'])[:70]!r}\n    {s['path']}")


def timeline(args):
    def short(value, width=args.width):
        return re.sub(r"\s+", " ", str(value))[:width]

    index = 0
    for event in events(args.transcript):
        kind = event[0]
        if kind in ("user", "assistant") and event[1].strip() and not event[1].lstrip().startswith("<"):
            print(f"[{kind}] {short(event[1])}")
        elif kind == "call":
            index += 1
            print(f"  #{index} {event[1]}: {short(event[2], 200)}")
        elif kind == "result":
            text = event[2]
            diagnostic = missing_path(text, event[3])
            if event[3] or EMPTY_SEARCH.match(text) or diagnostic or not text.strip() \
                    or re.search(r"Process exited with code [1-9]", text[:800]):
                print(f"     !! {short(diagnostic or text or '(empty)', 160)}")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    commands = parser.add_subparsers(dest="command", required=True)
    r = commands.add_parser("rank", help="summarize repositories and rank sessions by friction")
    r.add_argument("--since-days", type=float, help="rank only this recent window; excludes undated events (default: all recorded events)")
    r.add_argument("--repo", action="append", help="filter output by repository name; does not limit input access")
    r.add_argument("--repo-root", action="append", required=True, metavar="NAME=ROOT",
                   help="repository name and absolute recorded root; repeat for multiple checkouts")
    r.add_argument("transcripts", nargs="+", metavar="TRANSCRIPT", help="explicit JSON/JSONL inputs; no store discovery")
    r.add_argument("--top", type=int, default=8)
    r.add_argument("--min-sessions", type=int, default=3)
    r.add_argument("--min-tools", type=int, default=100, help="shortest session the top list ranks")
    r.add_argument("--sort", choices=("rate", "score"), default="rate")
    r.add_argument("--subagents", action="store_true", help="include transcripts identified as subagent sessions")
    r.add_argument("--json", help="also write every session's metrics to this file")
    t = commands.add_parser("timeline", help="print one transcript compactly")
    t.add_argument("transcript")
    t.add_argument("--width", type=int, default=240)
    for command in (r, t):
        command.add_argument('--cwd', help='fallback absolute recorded session cwd when the transcript omits it')
    args = parser.parse_args()
    if args.command == 'rank' and args.since_days is not None and (not math.isfinite(args.since_days) or args.since_days < 0):
        parser.error('--since-days requires a finite nonnegative number')
    global DEFAULT_CWD
    if args.cwd:
        if not os.path.isabs(args.cwd):
            parser.error('--cwd requires an absolute recorded session directory')
        DEFAULT_CWD = args.cwd
    if args.command == "rank":
        roots = {}
        for mapping in args.repo_root:
            name, separator, root = mapping.partition("=")
            root = os.path.expanduser(root)
            if not separator or not name or not os.path.isabs(root):
                parser.error("--repo-root requires NAME=absolute-root")
            root = os.path.normcase(os.path.normpath(root))
            if root in roots and roots[root] != name:
                parser.error("one repository root cannot have conflicting names")
            roots[root] = name
        global REPO_ROOTS
        REPO_ROOTS = sorted(((name, root) for root, name in roots.items()),
                            key=lambda pair: len(pair[1]), reverse=True)
        paths = list(dict.fromkeys(os.path.realpath(path) for path in args.transcripts))
        for path in paths:
            if not os.path.isfile(path):
                parser.error("transcript is not a regular file: " + path)
            if args.json and (os.path.realpath(args.json) == path or
                             (os.path.exists(args.json) and os.path.samefile(args.json, path))):
                parser.error("--json cannot overwrite an input transcript")
        args.transcripts = paths
    try:
        (rank if args.command == "rank" else timeline)(args)
    except (OSError, ValueError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    sys.exit(main())
