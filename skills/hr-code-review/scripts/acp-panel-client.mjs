// ACP v1 read-only review transport. See ../references/acp-client.md.
import { execFileSync, spawn } from "node:child_process";
import {
  closeSync,
  fchmodSync,
  lstatSync,
  constants as fsConstants,
  existsSync,
  openSync,
  realpathSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { constants as osConstants } from "node:os";
import { createHash } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { AGY_UNMASKED, gitEnvironment, gitProgram, privateDir } from "./seat-launch.mjs";
import { programFolder, reviewBase, trustedDirs } from "./seat-paths.mjs";
import { argParser, isFlagLike } from "./client-args.mjs";
import { SEAT_AGENTS, launchPreview, takeServerArgs } from "./seat-spec.mjs";
import { seatLaunch } from "./seat-hooks.mjs";
const rawArgs = process.argv.slice(2);
// A client log line. Control characters in seat-supplied text are written as \xNN, so a seat cannot
// start a line of its own, such as a forged `[client] FATAL:` record.
/** @param {string} text */
const clean = (text) =>
  text.replace(
    /[\p{Cc}\u2028\u2029]/gu,
    (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`,
  );
// A line is cut at 8 KiB, so a long seat message cannot become a long log line.
// A seat's value as text: whatever type it sent, and an object whose own toString throws is empty text.
/** @param {unknown} v */
const textOf = (v) => {
  try {
    return String(v ?? "");
  } catch {
    return "";
  }
};
/** @param {string} line */
const log = (line) => {
  const text = clean(line);
  console.error(text.length > 8192 ? `${text.slice(0, 8192)}... (cut)` : text);
};
const { takeFlag, takeSwitch, takeAll } = argParser(rawArgs);
// JSON-RPC messages are whatever the ACP server sends; fields are checked where they are read.
/** @typedef {any} RpcMessage */
// The server's own arguments are taken first: a `--server-arg` left without its value must not take the
// next positional once `--server-exe` and the other flags are gone.
const serverArgs = takeServerArgs(rawArgs);
const seatAgentName = takeFlag("--seat-agent", "");
const exeGiven = rawArgs.includes("--server-exe");
const serverExe = takeFlag("--server-exe", "");
const binDirs = takeAll("--bin-dir");
const maxTurns = Math.max(1, parseInt(takeFlag("--max-turns", "1"), 10));
const verdictMarker = takeFlag("--verdict", "");
const modelArg = takeFlag("--model", "");
const effortArg = takeFlag("--effort", "");
const policyPath = takeFlag("--policy", "");
const policyOptions = Object.fromEntries(
  takeAll("--policy-option").map((entry) => {
    const eq = entry.indexOf("=");
    return eq < 0 ? [entry, "true"] : [entry.slice(0, eq), entry.slice(eq + 1)];
  }),
);
const noWeb = takeSwitch("--no-web");
const allowReads = takeSwitch("--allow-reads");
const timeoutMin = Math.max(1, Number(takeFlag("--timeout-min", "60")) || 60);
const idleArg = Number(takeFlag("--idle-min", "5"));
const IDLE_MS = (idleArg > 0 ? idleArg : 5) * 60 * 1000;
const USAGE =
  "usage: bun acp-panel-client.mjs --seat-agent NAME [--server-exe ABS] [--server-arg ARG]... [--bin-dir ABS]... <prompt-file> <out-text> [cwd] [--max-turns N] [--verdict MARK] [--model ID] [--effort LEVEL] [--idle-min N] [--timeout-min N] [--no-web] [--allow-reads] [--policy MODULE] [--policy-option KEY[=VALUE]]...";
// A flag the client does not know, or one missing its value, must not be taken for a positional
// argument or ignored: a caller that passes a restriction this version lacks would run unrestricted.
const [promptFile, outText, cwdArg] = rawArgs;
if (!seatAgentName || !promptFile || !outText || rawArgs.length > 3 || rawArgs.some(isFlagLike)) {
  console.error(USAGE);
  process.exit(2);
}
/** @param {string} message */
function refuse(message) {
  log(`[client] FATAL: ${message}`);
  process.exit(2);
}
if (exeGiven && !serverExe) {
  refuse("--server-exe needs the absolute path of the server");
}
if (!SEAT_AGENTS.includes(seatAgentName)) {
  refuse(`--seat-agent ${seatAgentName} is not one of ${SEAT_AGENTS.join(", ")}`);
}
const cwd = realpathSync(cwdArg || process.cwd());
// The folders a program may come from: the system's and the caller's own, none of them in the checkout.
const dirs = trustedDirs(binDirs, cwd, /** @type {(message: string) => never} */ (refuse));
// The client's private folder is made here, so a TMPDIR that cannot be carried in PATH or BUN_OPTIONS
// stops the launch before anything starts.
try {
  privateDir();
} catch (e) {
  refuse(e instanceof Error ? e.message : String(e));
}
// The answer goes to the physical path the output argument names now (a caller's symlink is followed
// once, here); the write refuses a final symlink and a directory that is no longer this one.
/** @type {string} */
let outPath;
try {
  outPath = existsSync(outText)
    ? realpathSync(outText)
    : join(realpathSync(dirname(resolve(outText))), basename(outText));
} catch (e) {
  log(
    `[client] FATAL: the answer file's directory cannot be used: ${e instanceof Error ? e.message : String(e)}`,
  );
  process.exit(1);
}
const NOFOLLOW = process.platform === "win32" ? 0 : fsConstants.O_NOFOLLOW;
function writeAnswer() {
  if (realpathSync(dirname(outPath)) !== dirname(outPath)) {
    throw new Error("the answer file's directory changed during the run");
  }
  // O_NOFOLLOW is absent on Windows, so a link the seat made is also looked for before opening.
  if (lstatSync(outPath, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new Error("the answer file became a symlink during the run");
  }
  // The answer goes to a new file that is then renamed over the answer path. Opening the path itself
  // would truncate whatever it names, and a seat can make that name a hard link to another file.
  // An existing answer file keeps its permissions (a 0600 file stays 0600).
  const existing = statSync(outPath, { throwIfNoEntry: false });
  const temp = join(dirname(outPath), `.${basename(outPath)}.${process.pid}.tmp`);
  const fd = openSync(
    temp,
    fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | NOFOLLOW,
    0o600,
  );
  try {
    try {
      fchmodSync(fd, existing ? existing.mode & 0o777 : 0o666 & ~process.umask());
      writeFileSync(fd, collected);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, outPath);
  } catch (e) {
    rmSync(temp, { force: true });
    throw e;
  }
}
const promptText = readFileSync(promptFile, "utf8");
const HARD_TIMEOUT_MS = timeoutMin * 60 * 1000;
// The caller's launch policy module (a `check({ model, effort, command, options })` export, or a default
// function) throws to refuse; a refusal exits 2 before any server starts.
// `agy acp` runs what it finds in the agent folders of the working directory and its parents; the caller
// declares them covered with `--policy-option agy-masked`, checked before any policy module is imported.
if (seatAgentName === "agy" && policyOptions["agy-masked"] !== "true") {
  refuse(AGY_UNMASKED);
}
if (policyPath) {
  try {
    const mod = await import(pathToFileURL(resolve(policyPath)).href);
    const check = mod.check ?? mod.default;
    if (typeof check !== "function") {
      throw new Error("the module exports no check function");
    }
    await check({
      model: modelArg,
      effort: effortArg,
      agent: seatAgentName,
      command: launchPreview(seatAgentName, serverExe, serverArgs),
      options: policyOptions,
    });
  } catch (e) {
    refuse(`launch policy ${policyPath}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

const refuseLaunch = /** @type {(message: string) => never} */ (refuse);
// Git runs in the review root after the seat worked there, and runs programs the repository's
// configuration names, so it gets a seat's narrowed environment (plus the variables that locate a
// repository, and a PATH outside the checkout) and the filesystem monitor is switched off.
// The server and git look programs up in a folder of links to the trusted programs, none of them in the checkout.
const pathValue = programFolder(dirs, cwd, join(privateDir(), "bin"), refuseLaunch);
const gitEnv = gitEnvironment(pathValue);
/**
 * @param {string[]} args
 * @param {"utf8" | "latin1"} encoding
 */
const git = (args, encoding, stdio = /** @type {"pipe"} */ ("pipe")) => {
  return execFileSync(
    gitProgram(dirs, reviewBase(cwd)),
    ["-c", "core.fsmonitor=false", "-C", cwd, ...args],
    {
      encoding,
      env: gitEnv,
      stdio: ["ignore", stdio, "pipe"],
      maxBuffer: 512 * 1024 * 1024,
    },
  );
};
// Only git's own "not a git repository", or no git program at all, means there is nothing to compare. Any
// other failure (a bad config, a checkout git refuses as owned by someone else) propagates: treating it as
// "not a checkout" would skip the comparison and let a seat's writes pass.
function inGitCheckout() {
  try {
    git(["rev-parse", "--is-inside-work-tree"], "utf8", "pipe");
    return true;
  } catch (e) {
    const { code, stderr = "" } = /** @type {{ code?: string, stderr?: string }} */ (e);
    if (code === "ENOENT") {
      return false;
    }
    // Git's own discovery message names the parent directories it searched; "not a git repository: <path>"
    // is a GIT_DIR or --git-dir that cannot be opened, which is a failure to check.
    if (/not a git repository \(or any of the parent directories\)/i.test(stderr)) {
      return false;
    }
    throw e;
  }
}
// Both listings come from `git status --porcelain -z --untracked-files=all`: -z gives raw, unquoted paths
// (no escapes, no arrows), and --untracked-files=all lists each new file instead of collapsing a new
// directory into one `?? skills/` entry that cannot be told from the seat's own files. A status that
// fails inside a git checkout throws: that is a failure to check, not "nothing to compare". The listing is
// read as latin1, one character per byte, so two different file names never decode to the same string (a
// name that is not valid UTF-8 would otherwise turn into U+FFFD); changedPaths decodes the names it reports.
function gitStatus() {
  if (!inGitCheckout()) {
    return null; // not a git checkout: nothing to compare
  }
  return git(["status", "--porcelain", "-z", "--untracked-files=all", "--renames"], "latin1");
}
// The repository the comparison belongs to. If the checkout at launch is gone at the end and git finds an
// enclosing one, a clean listing from that one says nothing about the launch directory's files.
function gitDir() {
  return git(["rev-parse", "--absolute-git-dir"], "latin1").replace(/\n$/, "");
}
// Porcelain paths are relative to the repository root; the launch directory's path inside it is the prefix
// (empty at the root). Only the output's final newline goes: a directory name may begin or end with a space.
// It is read as latin1 like the listing. A failure throws: the runtime exemption would otherwise apply to
// the wrong directory.
function gitPrefix() {
  return git(["rev-parse", "--show-prefix"], "latin1").replace(/\n$/, "");
}
// A seat's runtime can write its own files into the launch directory without the seat doing anything:
// Codex materializes its bundled system skills (for example run-workflow) under skills/system/ when a
// session starts. Untracked files there are not the seat's changes. A tracked change, and a file that was
// under skills/system/ at launch and is gone at the end, still count.
const RUNTIME_DIR = "skills/system/";
/**
 * @param {string} listing
 * @returns {{ status: string, path: string, from: string }[]}
 */
function statusEntries(listing) {
  const parts = listing.split("\0");
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] ?? "";
    if (part.length < 4) {
      continue;
    }
    const status = part.slice(0, 2);
    // A rename or copy is followed by its original path, which is not an entry of its own but is part of
    // what the entry says: two renames that swap their sources are a change.
    const from = /[RC]/.test(status) ? (parts[++i] ?? "") : "";
    out.push({ status, path: part.slice(3), from });
  }
  return out;
}
// A path shown in the log: valid UTF-8 as text with control characters (a newline in a name could forge a
// log line) written as \xNN; otherwise each byte outside printable ASCII as \xNN, so two names that differ
// only in bytes that are not valid UTF-8 stay distinguishable.
/** @param {string} path latin1-decoded bytes */
function displayPath(path) {
  const escape = (/** @type {string} */ c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(path, "latin1"));
    return text
      .split("")
      .map((c) => (c < " " || c === "\x7f" ? escape(c) : c))
      .join("");
  } catch {
    return path.replace(/[^\x20-\x7e]/g, escape);
  }
}
/**
 * Paths whose status differs between the launch and final listings, leaving out untracked files the
 * runtime added under skills/system/.
 * @param {string} before
 * @param {string} after
 * @param {string} prefix
 */
function changedPaths(before, after, prefix) {
  const key = (/** @type {{ status: string, path: string, from: string }} */ e) =>
    `${e.status}\0${e.path}\0${e.from}`;
  const was = statusEntries(before);
  const now = statusEntries(after);
  const wasKeys = new Set(was.map(key));
  const nowKeys = new Set(now.map(key));
  const added = now.filter(
    (e) => !wasKeys.has(key(e)) && !(e.status === "??" && e.path.startsWith(prefix + RUNTIME_DIR)),
  );
  const removed = was.filter((e) => !nowKeys.has(key(e)));
  return [...new Set([...added, ...removed].map((e) => e.path))].map(displayPath);
}
/** @type {string | null} */
let statusBefore;
/** @type {string | null} */
let gitDirBefore = null;
try {
  statusBefore = gitStatus();
  gitDirBefore = statusBefore === null ? null : gitDir();
} catch (e) {
  log(
    "[client] FATAL: git status failed at launch: " + (e instanceof Error ? e.message : String(e)),
  );
  process.exit(1);
}
const launch = seatLaunch({
  agent: seatAgentName,
  exe: serverExe || undefined,
  args: serverArgs,
  root: cwd,
  dirs,
  pathValue,
  noWeb,
  masked: policyOptions["hooks-masked"] === "true",
  refuse: refuseLaunch,
});
const launchCmd = launch.cmd;
const child = spawn(launchCmd[0] ?? "", launchCmd.slice(1), {
  cwd: launch.cwd,
  env: launch.env,
  argv0: launch.argv0,
  stdio: ["pipe", "pipe", "pipe"],
});
// The seat's stderr passes through with each line marked, so it cannot pass for the client's own.
// A seat's stderr is also bounded: 64 MiB in all, then dropped.
let seatStderr = 0;
splitLines(
  child.stderr,
  1024 * 1024,
  (line) => {
    seatStderr += line.length + 1;
    if (seatStderr <= MAX_SEAT_STDERR) {
      log(`[seat] ${line}`);
    } else if (seatStderr - line.length - 1 <= MAX_SEAT_STDERR) {
      log("[seat] (more than 64 MiB of output; the rest is dropped)");
    }
  },
  () => log("[seat] (a line over 1 MiB was cut)"),
);
const MAX_SEAT_STDERR = 64 * 1024 * 1024;
let nextId = 1;
/** @type {Map<number, { resolve: (result: RpcMessage) => void, reject: (error: Error) => void }>} */
const pending = new Map();
/** @param {Error} error */
function rejectPending(error) {
  for (const p of pending.values()) {
    p.reject(error);
  }
  pending.clear();
}
// A failure no request is waiting on (a limit passed after the last reply) still ends the run: the
// request calls and the end of each turn check it.
/** @type {Error | undefined} */
let failure;
// Set once the answer is written: what the server sends after that is not read, so it cannot grow memory
// or change the outcome.
let committed = false;
/** @param {Error} error */
function fail(error) {
  failure ??= error;
  rejectPending(error);
}
child.on("error", rejectPending);
// A stopped run (a runner's deadline, systemctl stop) ends the server and exits 128 + the signal
// number, so exit handlers such as the private directory's cleanup still run. A server that ignores
// SIGTERM is killed after 5 s; helper processes it started may outlive it.
let stopped = /** @type {boolean} */ (false);
for (const sig of /** @type {const} */ (["SIGTERM", "SIGINT", "SIGHUP"])) {
  process.on(sig, () => {
    stopped = true;
    const code = 128 + osConstants.signals[sig];
    if (child.exitCode !== null || child.signalCode !== null) {
      process.exit(code);
    }
    child.once("close", () => process.exit(code));
    child.kill("SIGTERM");
    setTimeout(() => {
      child.kill("SIGKILL");
      process.exit(code);
    }, 5000);
  });
}
// "close" fires once stdout is drained, so a final reply the server wrote just before exiting is still
// read first; "exit" is the fallback after 1 s, because a helper that inherited the pipes holds "close"
// back. A write to a server that is already gone raises EPIPE on stdin.
/** @param {number | null} code @param {string | null} signal */
const serverGone = (code, signal) =>
  rejectPending(new Error(`ACP server exited (${code ?? signal})`));
child.on("close", serverGone);
child.on("exit", (code, signal) =>
  setTimeout(() => stopped || serverGone(code, signal), 1000).unref(),
);
child.stdin.on("error", rejectPending);
// What an untrusted seat can make the client hold: one message, the answer, the tool calls tracked.
const MAX_MESSAGE = 16 * 1024 * 1024;
const MAX_ANSWER = 32 * 1024 * 1024;
const MAX_TRACKED = 100_000;
/**
 * Calls `onLine` per line; a partial line over `max` is dropped and reported.
 * @param {NodeJS.ReadableStream} stream
 * @param {number} max
 * @param {(line: string) => void} onLine
 * @param {() => void} onOverflow
 */
function splitLines(stream, max, onLine, onOverflow) {
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffer += chunk;
    let start = 0;
    for (let nl = buffer.indexOf("\n"); nl >= 0; nl = buffer.indexOf("\n", start)) {
      onLine(buffer.slice(start, nl).replace(/\r$/, ""));
      start = nl + 1;
    }
    buffer = buffer.slice(start);
    if (buffer.length > max) {
      buffer = "";
      onOverflow();
    }
  });
  stream.on("end", () => {
    if (buffer) {
      onLine(buffer);
    }
  });
}
/** @param {RpcMessage} msg */
function send(msg) {
  child.stdin.write(JSON.stringify(msg) + "\n");
}
/**
 * @param {string} method
 * @param {RpcMessage} params
 * @returns {Promise<RpcMessage>}
 */
function request(method, params) {
  if (failure) {
    return Promise.reject(failure);
  }
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    send({ jsonrpc: "2.0", id, method, params });
  });
}
/**
 * @param {RpcMessage} id
 * @param {RpcMessage} result
 */
function replyOk(id, result) {
  send({ jsonrpc: "2.0", id, result });
}
/**
 * @param {RpcMessage} id
 * @param {number} code
 * @param {string} message
 */
function replyErr(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}
// Resolve physical targets; the client is not an OS sandbox for agent-owned tools.
/** @param {unknown} path */
async function underCwd(path) {
  if (typeof path !== "string" || !path) {
    return null;
  }
  const lexical = resolve(cwd, path);
  /** @param {string} target */
  const inside = (target) => {
    const rel = relative(cwd, target);
    return rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel);
  };
  if (!inside(lexical)) {
    return null;
  }
  // Same resolver as the root, so a runtime whose async and sync realpath spell a path
  // differently cannot make an inside file look outside.
  const physical = realpathSync(lexical);
  if (!inside(physical) || !(await stat(physical)).isFile()) {
    return null;
  }
  return physical;
}
// With --allow-reads these kinds are allowed (search and fetch only without --no-web), except for Codex; without
// it every request is refused. Shell, edit, delete, move, MCP and kind-less requests are refused either way.
// `search` is allowed only without --no-web: an agent can call a web search a search, and Claude's own
// Grep and Glob ask for no permission at all.
const ALLOWED_KINDS = new Set(["read", "think", ...(noWeb ? [] : ["search", "fetch"])]);
/** @param {RpcMessage} msg */
async function handleServerRequest(msg) {
  const { id, method } = msg;
  const params = msg.params ?? {};
  try {
    if (method === "fs/read_text_file") {
      const ok = await underCwd(params.path);
      if (!ok) {
        return replyErr(id, -32602, "path outside cwd");
      }
      const content = await readFile(ok, "utf8");
      return replyOk(id, { content });
    }
    if (method === "fs/write_text_file") {
      return replyErr(id, -32601, "write_text_file disabled by panel policy");
    }
    if (method?.startsWith("terminal/")) {
      return replyErr(id, -32601, "terminal execution disabled by review policy");
    }
    if (method === "session/request_permission") {
      const opts = params.options || [];
      const kind = params.toolCall?.kind;
      // The seat's own values: text for a log or a key, whatever type the seat sent.
      const toolCallId = textOf(params.toolCall?.toolCallId);
      const typedWeb = params.toolCall?.rawInput?.type === "webSearch";
      if (typedWeb) {
        if (!webSearches.has(toolKey(toolCallId)) && webSearches.size >= MAX_TRACKED) {
          tooMany();
        } else {
          webSearches.add(toolKey(toolCallId));
        }
      }
      if (
        !allowReads ||
        isCodex ||
        !ALLOWED_KINDS.has(kind ?? "") ||
        onNetwork(kind, toolCallId, typedWeb)
      ) {
        const reject = opts.find((/** @type {RpcMessage} */ o) =>
          String(o.kind || "").startsWith("reject"),
        );
        log(`[client] rejected ${String(kind || "unknown").slice(0, 64)} permission request`);
        rejections++;
        if (toolCallId && (refused.has(toolKey(toolCallId)) || refused.size < MAX_TRACKED)) {
          refused.add(toolKey(toolCallId));
        }
        return replyOk(
          id,
          reject
            ? { outcome: { outcome: "selected", optionId: reject.optionId } }
            : { outcome: { outcome: "cancelled" } },
        );
      }
      const pick =
        opts.find((/** @type {RpcMessage} */ o) => o.kind === "allow_once") ||
        opts.find((/** @type {RpcMessage} */ o) => String(o.kind || "").startsWith("allow")) ||
        opts[0];
      if (!pick) {
        return replyOk(id, { outcome: { outcome: "cancelled" } });
      }
      return replyOk(id, { outcome: { outcome: "selected", optionId: pick.optionId } });
    }
    return replyErr(id, -32601, "method not implemented by panel client: " + method);
  } catch (e) {
    return replyErr(id, -32603, e instanceof Error ? e.message : String(e));
  }
}
let collected = "";
let rejections = 0;
let webCalls = 0;
let isCodex = false;
// Tool calls by id: their kind (later updates may omit it) and the ones refused at the permission
// prompt. Some agents announce a call before asking, and a call blocked by the agent's own rules ends
// "failed", so a call counts as network use only when it completes without having been refused.
/** @type {Map<string, string | undefined>} */
const toolKinds = new Map();
// A tool id is the seat's text, so the sets hold a fixed-size key for a long one.
/** @param {string} id */
const toolKey = (id) => (id.length > 64 ? createHash("sha256").update(id).digest("hex") : id);
const refused = new Set();
const counted = new Set();
const webSearches = new Set();
// Under --no-web, every tool kind outside a seat's offline set counts as network use. Codex's shell runs
// in a sandbox without network, but Codex reports web search as "search" (and a file search through its
// shell as "search" under an id that starts "exec-"; a web search's input is typed "webSearch");
// Claude reports Grep and Glob as "search" and its shell as "execute". Edits, deletes and moves are
// caught by the workspace check instead.
const OFFLINE = new Set(["read", "think", "edit", "delete", "move"]);
// Devin reports its skill tool, which loads a local skill file, with no kind and names it only in its
// metadata; it is a read. Every other call without a kind still counts.
/** @param {Record<string, unknown> | undefined} meta */
const devinKind = (meta) =>
  meta?.["cognition.ai/inferenceToolName"] === "skill" ? "read" : undefined;
/**
 * @param {string | undefined} kind
 * @param {string} id
 * @param {boolean} [typedWeb] the update or request itself carries a webSearch input
 */
const onNetwork = (kind, id, typedWeb = false) =>
  noWeb &&
  // A call the agent itself typed as a web search is network use whatever kind it reports.
  (typedWeb ||
    webSearches.has(toolKey(id)) ||
    (!OFFLINE.has(kind ?? "") &&
      kind !== (isCodex ? "execute" : "search") &&
      !(isCodex && kind === "search" && id.startsWith("exec-"))));
let updateCount = 0;
splitLines(child.stdout, MAX_MESSAGE, onServerLine, () =>
  fail(new Error(`a server message is longer than ${MAX_MESSAGE} characters`)),
);
/** @param {string} line */
function onServerLine(line) {
  if (committed || failure || !line.trim()) {
    return;
  }
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  noteActivity();
  if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
    const p = pending.get(msg.id);
    if (p) {
      pending.delete(msg.id);
      if (msg.error) {
        p.reject(new Error(JSON.stringify(msg.error)));
      } else {
        p.resolve(msg.result);
      }
    }
    return;
  }
  if (msg.id !== undefined && msg.method) {
    // A reply that cannot be sent fails the run, like a server that exits.
    handleServerRequest(msg).catch(rejectPending);
    return;
  }
  if (msg.method === "session/update") {
    const u = msg.params?.update;
    if (u?.sessionUpdate === "tool_call" || u?.sessionUpdate === "tool_call_update") {
      const id = textOf(u.toolCallId);
      const key = toolKey(id);
      if (!toolKinds.has(key) && toolKinds.size >= MAX_TRACKED) {
        return tooMany();
      }
      const typedWeb = u.rawInput?.type === "webSearch";
      if (typedWeb) {
        webSearches.add(key);
      }
      if (u.kind !== undefined || !toolKinds.has(key)) {
        const seen = u.kind ?? devinKind(u._meta) ?? toolKinds.get(key);
        toolKinds.set(key, seen === undefined ? undefined : String(seen).slice(0, 64));
      }
      const kind = toolKinds.get(key);
      const finished = u.status === "completed" || u.status === "failed";
      if (finished && noWeb) {
        log(
          `[client] tool ${id.slice(0, 64)} ${kind ?? "unknown"} ${u.status}: ${textOf(u.title).slice(0, 120)}`,
        );
      }
      // A search typed or titled as a web search is network use; a local search (Claude's Grep and Glob,
      // both kind search) is not, and the client cannot tell the rest apart.
      // The title is remembered by tool id until the call completes, whatever kind or update carried it.
      if (/^\s*(web[\s_-]?search|search the web)\b/i.test(textOf(u.title))) {
        webSearches.add(key);
      }
      if (
        u.status === "completed" &&
        onNetwork(kind, id, typedWeb) &&
        !refused.has(key) &&
        !counted.has(key)
      ) {
        counted.add(key);
        webCalls++;
        log(`[client] a ${kind} tool call ran despite --no-web`);
      }
    }
    if (
      u?.sessionUpdate === "agent_message_chunk" &&
      u.content &&
      typeof u.content.text === "string"
    ) {
      collected += u.content.text;
      if (collected.length > MAX_ANSWER) {
        return fail(new Error(`the answer is longer than ${MAX_ANSWER} characters`));
      }
    }
    updateCount++;
    if (updateCount % 25 === 0) {
      log(`[client] ${updateCount} session updates...`);
    }
    return;
  }
}
function tooMany() {
  fail(new Error(`the seat started more than ${MAX_TRACKED} tool calls`));
}
let lastActivity = Date.now();
let longestGapMs = 0;
function noteActivity() {
  const now = Date.now();
  longestGapMs = Math.max(longestGapMs, now - lastActivity);
  lastActivity = now;
}
const gapNote = () => `longest silent gap ${Math.round(longestGapMs / 1000)}s`;
// Set by abort(), which timers and stream handlers call.
let deadlineHit = /** @type {boolean} */ (false);
/** @param {string} reason */
function abort(reason) {
  deadlineHit = true;
  log(`[client] ${reason} (${gapNote()}), killing server`);
  try {
    if (sessionId) {
      send({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId } });
    }
  } catch {}
  setTimeout(() => {
    child.kill("SIGKILL");
    process.exit(124);
  }, 2000).unref();
}
const timer = setTimeout(() => abort("HARD TIMEOUT"), HARD_TIMEOUT_MS).unref();
const idleCheck = setInterval(
  () => {
    if (Date.now() - lastActivity > IDLE_MS) {
      clearInterval(idleCheck);
      abort(`IDLE TIMEOUT: no server message for ${Math.round(IDLE_MS / 1000)}s`);
    }
  },
  Math.min(IDLE_MS / 4, 15000),
).unref();
// A model id differs from the requested one only by case, `_` for `-` or a leading `provider/`; any
// other change is another model.
/** @param {string} id */
const modelKey = (id) => String(id).toLowerCase().replaceAll("_", "-");
// A provider prefix may be present on one side only; when both name one, they must be the same.
/**
 * @param {string} expected
 * @param {string} actual
 */
const sameModel = (expected, actual) => {
  const [a, b] = [modelKey(expected), modelKey(actual)];
  const split = (/** @type {string} */ s) => {
    const slash = s.indexOf("/");
    return slash < 0 ? [undefined, s] : [s.slice(0, slash), s.slice(slash + 1)];
  };
  const [pa, ma] = split(a);
  const [pb, mb] = split(b);
  return ma === mb && (pa === undefined || pb === undefined || pa === pb);
};
// The Claude adapter takes `tools` as its built-in tool list (no shell) and, with strictMcpConfig,
// ignores the user's MCP servers; web tools only with --allow-reads and no --no-web. With an empty
// settingSources the SDK query excludes the user, project and local settings, so no hook configured in
// them runs in the seat, the checkout's own `.claude/settings.json` included; managed policy settings
// and the adapter's own hooks still apply. Others ignore _meta.
const claudeOptions = {
  tools:
    allowReads && !noWeb
      ? ["Read", "Grep", "Glob", "WebFetch", "WebSearch"]
      : ["Read", "Grep", "Glob"],
  ...(allowReads && !noWeb ? {} : { disallowedTools: ["WebFetch", "WebSearch"] }),
  strictMcpConfig: true,
  settingSources: [],
};
// A mode in which the agent can approve an edit without asking.
const APPROVES_EDITS = [
  "auto",
  "acceptEdits",
  "bypassPermissions",
  "accept-edits",
  "smart",
  "bypass",
];
/** @type {string | undefined} */
let sessionId;
try {
  const init = await request("initialize", {
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: true, writeTextFile: false }, terminal: false },
    clientInfo: { name: "acp-panel-client", version: "0.3.0" },
  });
  if (init.protocolVersion !== 1) {
    throw new Error("ACP protocol version 1 required");
  }
  const agentName = textOf(
    (init.agentInfo && (init.agentInfo.name || init.agentInfo.title)) || "unknown",
  ).slice(0, 64);
  // Codex by the launch, or by the agent's reported name or title.
  isCodex =
    seatAgentName === "codex" ||
    /codex/i.test(textOf(init.agentInfo?.name)) ||
    /codex/i.test(textOf(init.agentInfo?.title));
  log(`[client] initialized, protocol=${init.protocolVersion}, agent=${agentName}`);
  send({ jsonrpc: "2.0", method: "initialized", params: {} });
  const s = await request("session/new", {
    cwd,
    mcpServers: [],
    _meta: { claudeCode: { options: claudeOptions } },
  });
  sessionId = s.sessionId;
  if (typeof sessionId !== "string" || !sessionId) {
    throw new Error("Missing session identity");
  }
  /** @type {RpcMessage[]} */
  let options = s.configOptions || [];
  const required = new Map();
  /**
   * @param {string} id
   * @param {string} expected
   * @param {string} actual
   */
  const same = (id, expected, actual) =>
    id === "model" ? sameModel(expected, actual) : actual === expected;
  /** @param {RpcMessage} option */
  const advertised = (option) =>
    /** @type {RpcMessage[]} */ (option.options || []).flatMap(
      (/** @type {RpcMessage} */ o) => o.options || [o],
    );
  // Set responses are complete snapshots; later changes must preserve earlier bindings.
  /**
   * @param {string[]} ids
   * @param {string} value
   */
  async function bind(ids, value) {
    const matches = options.filter((o) => ids.includes(o.id));
    if (matches.length !== 1) {
      throw new Error(`agent exposes no unique ${ids.join("/")} option; cannot bind ${value}`);
    }
    const option = matches[0];
    // The agent is sent its own spelling of the value (an advertised `chosen` for a requested
    // `vendor/chosen`); the echo is still checked against what the caller asked for.
    // An advertised value that is exactly the requested one wins; otherwise one spelling-tolerant match.
    const all = advertised(option);
    const matching = all.filter((o) => same(option.id, value, o.value));
    const offered =
      all.find((o) => o.value === value) ?? (matching.length === 1 ? matching[0] : undefined);
    if (!offered) {
      throw new Error(
        matching.length > 1
          ? `${option.id} value ${value} matches more than one advertised value`
          : `Unsupported ${option.id} value: ${value}`,
      );
    }
    required.set(option.id, value);
    const res = await request("session/set_config_option", {
      sessionId,
      configId: option.id,
      value: offered.value,
    });
    if (!Array.isArray(res?.configOptions)) {
      throw new Error(`Missing ${option.id} confirmation`);
    }
    options = res.configOptions;
    for (const [id, expected] of required) {
      const echoed = options.filter((o) => o.id === id);
      if (echoed.length !== 1 || !same(id, expected, String(echoed[0].currentValue))) {
        throw new Error(`Unverified ${id} binding`);
      }
    }
    log(`[client] ${option.id} -> ${value}`);
  }
  if (modelArg) {
    await bind(["model"], modelArg);
  }
  if (effortArg) {
    await bind(["effort", "reasoning_effort", "thought_level", "thinking_level"], effortArg);
  }
  // Codex must confirm read-only; any other agent is set to read-only when it offers it. Claude's adapter
  // has none: `default` asks before an edit (refused above), while `auto`, `acceptEdits` and
  // `bypassPermissions` can approve one, as can Devin's `accept-edits` and `bypass`; from those it is set
  // to `default` (Devin: `ask`) and must echo it, or the run is refused. Any other start mode is kept.
  const modes = options.filter((o) => o.id === "mode");
  if (isCodex || modes.length > 1) {
    await bind(["mode"], "read-only");
  } else if (modes[0]) {
    const offers = (/** @type {string} */ value) =>
      advertised(modes[0]).some((o) => o.value === value);
    if (offers("read-only")) {
      await bind(["mode"], "read-only");
    } else if (APPROVES_EDITS.includes(String(modes[0].currentValue))) {
      // `default` (Claude) and `ask` (Devin) ask before an edit, which the permission handler refuses.
      const safe = ["default", "ask"].find(offers);
      if (!safe) {
        throw new Error(
          `agent starts in ${modes[0].currentValue}, which can approve an edit without asking, and offers none of read-only, default or ask mode`,
        );
      }
      await bind(["mode"], safe);
    }
  }
  log(
    `[client] session ${sessionId}, maxTurns=${maxTurns}${verdictMarker ? `, verdictMarker=${JSON.stringify(verdictMarker)}` : ""}`,
  );
  let stopReason;
  for (let turn = 1; turn <= maxTurns; turn++) {
    const text =
      turn === 1
        ? promptText
        : `Continue the panel task. Your previous reply did not contain ${JSON.stringify(verdictMarker)}. Do no new setup; use only read/glob/grep on the repo, no MCP tools, and now deliver the full answer ending with ${verdictMarker} plus a value. Keep it under 30 lines.`;
    log(`[client] turn ${turn}/${maxTurns}, sending prompt (${text.length} chars)...`);
    const rejectionsBefore = rejections;
    const res = await request("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text }],
    });
    stopReason = res?.stopReason;
    if (failure) {
      throw failure;
    }
    if (deadlineHit) {
      break;
    }
    const hit = verdictMarker ? collected.includes(verdictMarker) : true;
    log(
      `[client] turn ${turn} finished, stopReason=${JSON.stringify(stopReason)} collected=${collected.length} chars hasVerdict=${hit}`,
    );
    if (hit) {
      break;
    }
    const cancelledByRejection = stopReason === "cancelled" && rejections > rejectionsBefore;
    if (stopReason && stopReason !== "end_turn" && !cancelledByRejection) {
      break;
    }
  }
  clearTimeout(timer);
  clearInterval(idleCheck);
  child.stdin.end();
  setTimeout(() => child.kill(), 1000).unref();
  setTimeout(() => child.kill("SIGKILL"), 2000).unref();
  const ok = verdictMarker ? collected.includes(verdictMarker) : true;
  let changedFiles = /** @type {string[]} */ ([]);
  if (statusBefore !== null) {
    try {
      const statusAfter = gitStatus();
      changedFiles =
        statusAfter === null
          ? ["(git status failed)"]
          : gitDir() !== gitDirBefore
            ? ["(the git repository changed)"]
            : changedPaths(statusBefore, statusAfter, gitPrefix());
    } catch {
      changedFiles = ["(git status failed)"];
    }
  }
  const changed = changedFiles.length > 0;
  if (changed) {
    log(
      `[client] WORKSPACE CHANGED: git status in ${cwd} differs from launch; the seat wrote files: ${changedFiles.slice(0, 10).join(", ")}`,
    );
  }
  // The answer is written after the status comparison so an output path inside the review
  // root is not mistaken for a change the seat made.
  // Output already in the pipe is read before the answer is committed.
  await new Promise((resolve) => setImmediate(resolve));
  if (failure) {
    throw failure;
  }
  writeAnswer();
  committed = true;
  log(`[client] wrote ${collected.length} chars to ${outText}; ${gapNote()}`);
  process.exitCode = deadlineHit ? 124 : changed ? 4 : webCalls > 0 ? 5 : ok ? 0 : 3;
  setTimeout(() => stopped || process.exit(), 2500).unref();
} catch (e) {
  log("[client] FATAL: " + (e instanceof Error ? e.message : String(e)));
  clearTimeout(timer);
  clearInterval(idleCheck);
  child.kill("SIGKILL");
  // A stop in progress owns the exit status (128 + the signal), whatever the server answered meanwhile.
  if (!stopped) {
    process.exit(deadlineHit ? 124 : 1);
  }
}
