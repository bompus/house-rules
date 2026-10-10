// ACP v1 read-only review transport. See ../references/acp-client.md.
import { execFileSync, spawn } from "node:child_process";
import { realpathSync, readFileSync, writeFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import * as readline from "node:readline";
const rawArgs = process.argv.slice(2);
function takeFlag(name, def) {
  const i = rawArgs.indexOf(name);
  if (i >= 0 && i + 1 < rawArgs.length) {
    const v = rawArgs[i + 1];
    rawArgs.splice(i, 2);
    return v;
  }
  return def;
}
const maxTurns = Math.max(1, parseInt(takeFlag("--max-turns", "1"), 10));
const verdictMarker = takeFlag("--verdict", "");
const modelArg = takeFlag("--model", "");
const effortArg = takeFlag("--effort", "");
const timeoutMin = Math.max(1, Number(takeFlag("--timeout-min", "60")) || 60);
const idleArg = Number(takeFlag("--idle-min", "5"));
const IDLE_MS = (idleArg > 0 ? idleArg : 5) * 60 * 1000;
const [serverCmdJson, promptFile, outText, cwdArg] = rawArgs;
if (!serverCmdJson || !promptFile || !outText) {
  console.error(
    "usage: node acp-panel-client.mjs <server-cmd-json> <prompt-file> <out-text> [cwd] [--max-turns N] [--verdict MARK] [--model ID] [--effort LEVEL] [--idle-min N] [--timeout-min N]",
  );
  process.exit(2);
}
const serverCmd = JSON.parse(serverCmdJson);
const cwd = realpathSync(cwdArg || process.cwd());
const promptText = readFileSync(promptFile, "utf8");
const HARD_TIMEOUT_MS = timeoutMin * 60 * 1000;
function gitStatus() {
  try {
    return execFileSync("git", ["-C", cwd, "status", "--porcelain"], { encoding: "utf8" });
  } catch {
    return null;
  }
}
const statusBefore = gitStatus();
const child = spawn(serverCmd[0], serverCmd.slice(1), {
  cwd,
  env: process.env,
  stdio: ["pipe", "pipe", "inherit"],
});
let nextId = 1;
let isCodex = false;
const pending = new Map();
function rejectPending(error) {
  for (const p of pending.values()) p.reject(error);
  pending.clear();
}
child.on("error", rejectPending);
child.on("exit", (code, signal) =>
  rejectPending(new Error(`ACP server exited (${code ?? signal})`)),
);
const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
function send(msg) {
  child.stdin.write(JSON.stringify(msg) + "\n");
}
function request(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    send({ jsonrpc: "2.0", id, method, params });
  });
}
function replyOk(id, result) {
  send({ jsonrpc: "2.0", id, result });
}
function replyErr(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}
// Resolve physical targets; the client is not an OS sandbox for agent-owned tools.
async function underCwd(path) {
  if (typeof path !== "string" || !path) return null;
  const lexical = resolve(cwd, path);
  const inside = (target) => {
    const rel = relative(cwd, target);
    return rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel);
  };
  if (!inside(lexical)) return null;
  // Same resolver as the root, so a runtime whose async and sync realpath spell a path
  // differently cannot make an inside file look outside.
  const physical = realpathSync(lexical);
  if (!inside(physical) || !(await stat(physical)).isFile()) return null;
  return physical;
}
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
      const reject = opts.find((o) => String(o.kind || "").startsWith("reject"));
      console.error(`[client] rejected ${kind || "unknown"} permission request`);
      rejections++;
      return replyOk(
        id,
        reject
          ? { outcome: { outcome: "selected", optionId: reject.optionId } }
          : { outcome: { outcome: "cancelled" } },
      );
    }
    return replyErr(id, -32601, "method not implemented by panel client: " + method);
  } catch (e) {
    return replyErr(id, -32603, e instanceof Error ? e.message : String(e));
  }
}
let collected = "";
let rejections = 0;
let updateCount = 0;
rl.on("line", (line) => {
  if (!line.trim()) {
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
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
      else p.resolve(msg.result);
    }
    return;
  }
  if (msg.id !== undefined && msg.method) {
    handleServerRequest(msg);
    return;
  }
  if (msg.method === "session/update") {
    const u = msg.params?.update;
    if (
      u?.sessionUpdate === "agent_message_chunk" &&
      u.content &&
      typeof u.content.text === "string"
    ) {
      collected += u.content.text;
    }
    updateCount++;
    if (updateCount % 25 === 0) {
      console.error(`[client] ${updateCount} session updates...`);
    }
    return;
  }
});
let lastActivity = Date.now();
let longestGapMs = 0;
function noteActivity() {
  const now = Date.now();
  longestGapMs = Math.max(longestGapMs, now - lastActivity);
  lastActivity = now;
}
const gapNote = () => `longest silent gap ${Math.round(longestGapMs / 1000)}s`;
let deadlineHit = false;
function abort(reason) {
  deadlineHit = true;
  console.error(`[client] ${reason} (${gapNote()}), killing server`);
  try {
    if (sessionId) send({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId } });
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
let sessionId;
try {
  const init = await request("initialize", {
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: true, writeTextFile: false }, terminal: false },
    clientInfo: { name: "acp-panel-client", version: "0.2.0" },
  });
  if (init.protocolVersion !== 1) throw new Error("ACP protocol version 1 required");
  const agentName = (init.agentInfo && (init.agentInfo.name || init.agentInfo.title)) || "unknown";
  isCodex = /codex/i.test(agentName);
  console.error(`[client] initialized, protocol=${init.protocolVersion}, agent=${agentName}`);
  send({ jsonrpc: "2.0", method: "initialized", params: {} });
  const s = await request("session/new", { cwd, mcpServers: [] });
  sessionId = s.sessionId;
  if (typeof sessionId !== "string" || !sessionId) throw new Error("Missing session identity");
  let options = s.configOptions || [];
  const modeRequired = isCodex || options.some((o) => o.id === "mode");
  const required = new Map();
  // Set responses are complete snapshots; later changes must preserve earlier bindings.
  async function bind(ids, value, optional = false) {
    const matches = options.filter((o) => ids.includes(o.id));
    if (matches.length !== 1) {
      if (optional && !matches.length) return;
      throw new Error(`agent exposes no unique ${ids.join("/")} option; cannot bind ${value}`);
    }
    const option = matches[0];
    const values = (option.options || []).flatMap((o) => o.options || [o]);
    if (!values.some((o) => o.value === value))
      throw new Error(`Unsupported ${option.id} value: ${value}`);
    required.set(option.id, value);
    const res = await request("session/set_config_option", {
      sessionId,
      configId: option.id,
      value,
    });
    if (!Array.isArray(res?.configOptions)) throw new Error(`Missing ${option.id} confirmation`);
    options = res.configOptions;
    for (const [id, expected] of required) {
      const echoed = options.filter((o) => o.id === id);
      if (echoed.length !== 1 || echoed[0].currentValue !== expected)
        throw new Error(`Unverified ${id} binding`);
    }
    console.error(`[client] ${option.id} -> ${value}`);
  }
  if (modelArg) await bind(["model"], modelArg);
  if (effortArg) await bind(["effort", "reasoning_effort"], effortArg);
  await bind(["mode"], "read-only", !modeRequired);
  console.error(
    `[client] session ${sessionId}, maxTurns=${maxTurns}${verdictMarker ? `, verdictMarker=${JSON.stringify(verdictMarker)}` : ""}`,
  );
  let stopReason;
  for (let turn = 1; turn <= maxTurns; turn++) {
    const text =
      turn === 1
        ? promptText
        : `Continue the panel task. Your previous reply did not contain ${JSON.stringify(verdictMarker)}. Do no new setup; use only read/glob/grep on the repo, no MCP tools, and now deliver the full answer ending with ${verdictMarker} plus a value. Keep it under 30 lines.`;
    console.error(`[client] turn ${turn}/${maxTurns}, sending prompt (${text.length} chars)...`);
    const rejectionsBefore = rejections;
    const res = await request("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text }],
    });
    stopReason = res?.stopReason;
    if (deadlineHit) break;
    const hit = verdictMarker ? collected.includes(verdictMarker) : true;
    console.error(
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
  const ok = verdictMarker ? collected.includes(verdictMarker) : true;
  const changed = statusBefore !== null && gitStatus() !== statusBefore;
  if (changed) {
    console.error(
      `[client] WORKSPACE CHANGED: git status in ${cwd} differs from launch; the seat wrote files`,
    );
  }
  // The answer is written after the status comparison so an output path inside the review
  // root is not mistaken for a change the seat made.
  writeFileSync(outText, collected);
  console.error(`[client] wrote ${collected.length} chars to ${outText}; ${gapNote()}`);
  process.exitCode = deadlineHit ? 124 : changed ? 4 : ok ? 0 : 3;
  setTimeout(() => process.exit(), 2500).unref();
} catch (e) {
  console.error("[client] FATAL: " + (e instanceof Error ? e.message : String(e)));
  clearTimeout(timer);
  clearInterval(idleCheck);
  child.kill("SIGKILL");
  process.exit(deadlineHit ? 124 : 1);
}
