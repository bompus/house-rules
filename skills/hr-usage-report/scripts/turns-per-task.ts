#!/usr/bin/env bun
// Turns per task in Claude Code transcripts: one task per human prompt, so a task's
// request count is the harness's own measure of work per ask. Reading it beside
// output per turn separates "the model writes less" from "the task took more steps".
//
//   bun turns-per-task.ts [--days N | --since ISO] [--compare ISO] [--by model|origin]
//                         [--claude-projects <dir,dir>] [--json]
//
// Read-only and local. Method and report shape: ../SKILL.md.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { claudeProjectRoots } from "./usage-by-model.ts";

export type Task = {
  /** Prompt time, ms since epoch. */
  t: number;
  /** UTC date of the prompt, `YYYY-MM-DD`. */
  day: string;
  /** Most frequent model among the task's main-chain responses. */
  model: string;
  origin: string;
  /** The client's prompt id: the same prompt replayed into another file is still one task. */
  promptId: string;
  /** Main-chain API responses before the next human prompt. */
  turns: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  toolCalls: number;
  /** One entry per main-chain response, so per-turn statistics are not task-weighted. */
  responses: ResponseStat[];
  /** Responses in a subagent transcript written into the same session file. */
  sideRequests: number;
  sideOutput: number;
};

export type ResponseStat = { output: number; cacheRead: number; tools: number };

type Entry = {
  type?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  promptId?: string;
  requestId?: string;
  timestamp?: string;
  turnOrigin?: string;
  message?: { id?: string; content?: unknown; usage?: Record<string, number>; model?: string };
};

const quantile = (xs: number[], p: number) =>
  xs.length === 0
    ? 0
    : ([...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.round(p * (xs.length - 1)))] ??
      0);
const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const median = (xs: number[]) => quantile(xs, 0.5);

/** A user entry with prose carries a human prompt unless it only holds tool results. */
export function looksLikePrompt(e: Entry): boolean {
  const c = e.message?.content;
  if (typeof c === "string") {
    return true;
  }
  if (Array.isArray(c)) {
    return !c.some((b) => (b as { type?: string } | null)?.type === "tool_result");
  }
  return false;
}

/**
 * Injected entries that arrive as `user` messages: command wrappers, local command output, system
 * reminders and entries the CLI flags as meta. They are not asks, so they neither end a task nor
 * start one. A message is metadata only when stripping those elements leaves nothing: a person can
 * prepend a command block and still ask something after it.
 */
/**
 * Slash commands that maintain the session rather than ask for work. Any other slash command,
 * such as a skill the person invoked, is an ask and starts a task.
 */
const CONTROL_COMMANDS = new Set([
  "compact",
  "clear",
  "resume",
  "exit",
  "quit",
  "model",
  "effort",
  "config",
  "login",
  "logout",
  "help",
  "cost",
  "status",
  "doctor",
  "permissions",
  "hooks",
  "mcp",
  "plugin",
  "agents",
  "init",
  "memory",
  "vim",
  "terminal-setup",
  "bug",
  "release-notes",
]);

// Anchored: a command echoed inside local command output is not an invocation.
const SLASH_COMMAND = /^\s*<command-name>\s*\/([^\s<]+)\s*<\/command-name>/i;

const META_ELEMENT =
  /^<(command-name|command-message|command-args|local-command-caveat|local-command-stdout|local-command-stderr|bash-input|bash-stdout|bash-stderr|system-reminder)>[\s\S]*?<\/\1>\s*/i;

export function isMetadataEntry(e: Entry): boolean {
  if (e.isMeta) {
    return true;
  }
  const content = e.message?.content;
  // An image or file block is an ask even when its text is only a metadata wrapper.
  if (
    Array.isArray(content) &&
    content.some((b) => (b as { type?: string } | null)?.type !== "text")
  ) {
    return false;
  }
  let text = allText(content).trim();
  const command = SLASH_COMMAND.exec(text);
  if (command && !CONTROL_COMMANDS.has(command[1]!.toLowerCase())) {
    return false;
  }
  for (let m = META_ELEMENT.exec(text); m; m = META_ELEMENT.exec(text)) {
    text = text.slice(m[0].length);
  }
  return text === "" && allText(content).trim() !== "";
}

/** Every text block of a message, in order. */
function allText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((block) => {
      const b = block as { type?: string; text?: string } | null;
      return b?.type === "text" && typeof b.text === "string" ? b.text : "";
    })
    .join("\n");
}

const isAsk = (e: Entry) => looksLikePrompt(e) && !isMetadataEntry(e);

/** A prompt counts once its entry also carries the prompt id. */
export const humanPrompt = (e: Entry) => Boolean(e.promptId) && isAsk(e);

/**
 * Whether a transcript file is one of a session's separate subagent transcripts. Windows joins
 * these with backslashes, so test the path's segments instead of a "/subagents/" substring.
 */
export const isSubagentTranscript = (path: string) => path.split(/[\\/]/).includes("subagents");

const inWindow = (e: Entry, since: number) => {
  const t = e.timestamp ? Date.parse(e.timestamp) : NaN;
  return Number.isFinite(t) && t >= since;
};

/**
 * Prompt-shaped entries with no prompt id. Claude Code writes the id on every version seen so
 * far; a release that stopped would otherwise make tasks vanish from a comparison silently.
 */
export function unattributedPrompts(roots: string[], since: number): number {
  let count = 0;
  for (const root of roots) {
    for (const path of transcriptFiles(root, since)) {
      let text: string;
      try {
        text = readFileSync(path, "utf8");
      } catch {
        continue;
      }
      for (const line of text.split("\n")) {
        if (!line.trim()) {
          continue;
        }
        try {
          const e = JSON.parse(line) as Entry;
          if (e.type === "user" && !e.isSidechain && !e.promptId && isAsk(e)) {
            count += inWindow(e, since) ? 1 : 0;
          }
        } catch {
          continue;
        }
      }
    }
  }
  return count;
}

/**
 * Responses in separate subagent transcripts (`<session>/subagents/agent-*.jsonl`). Each carries
 * its own prompt, so its turns belong to that agent's task, not to the parent task it served.
 */
export function subagentTranscripts(
  roots: string[],
  since: number,
): { files: number; responses: number } {
  let files = 0;
  let responses = 0;
  for (const root of roots) {
    for (const path of transcriptFiles(root, since)) {
      if (!isSubagentTranscript(path)) {
        continue;
      }
      files += 1;
      let text: string;
      try {
        text = readFileSync(path, "utf8");
      } catch {
        continue;
      }
      const counted = new Set<string>();
      for (const line of text.split("\n")) {
        if (!line.trim()) {
          continue;
        }
        try {
          const e = JSON.parse(line) as Entry;
          const m = e.message;
          if (
            e.type === "assistant" &&
            m?.usage &&
            m.model !== "<synthetic>" &&
            inWindow(e, since)
          ) {
            // A streamed response is written once per content block; count it once.
            const key = `${m.id ?? ""}|${e.requestId ?? ""}`;
            if (!counted.has(key)) {
              counted.add(key);
              responses += 1;
            }
          }
        } catch {
          continue;
        }
      }
    }
  }
  return { files, responses };
}

function* transcriptFiles(dir: string, since: number): Generator<string> {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const path = join(dir, name);
    let st;
    try {
      st = statSync(path);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      yield* transcriptFiles(path, since);
    } else if (name.endsWith(".jsonl") && st.mtimeMs >= since) {
      yield path;
    }
  }
}

const dayOf = (iso: string | undefined) => (iso ? iso.slice(0, 10) : "");

type Seen = {
  side: boolean;
  model: string;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  tools: Set<string>;
};

/** Tasks from the given Claude Code `projects` roots, prompts at or after `since` (ms). */
export function claudeTasks(roots: string[], since: number): Task[] {
  const byPrompt = new Map<string, Task>();
  for (const root of roots) {
    for (const path of transcriptFiles(root, since)) {
      if (isSubagentTranscript(path)) {
        continue;
      }
      let text: string;
      try {
        text = readFileSync(path, "utf8");
      } catch {
        continue;
      }
      let cur:
        | (Omit<Task, "model" | "turns" | "output" | "cacheRead" | "cacheWrite"> & {
            seen: Map<string, Seen>;
          })
        | null = null;
      const finish = () => {
        if (!cur || cur.t < since) {
          return;
        }
        const responses = [...cur.seen.values()];
        const main = responses.filter((r) => !r.side);
        const side = responses.filter((r) => r.side);
        if (main.length === 0) {
          return;
        }
        const models = new Map<string, number>();
        for (const r of main) {
          models.set(r.model, (models.get(r.model) ?? 0) + 1);
        }
        const top = [...models.entries()].sort((a, b) => b[1] - a[1])[0];
        const { seen: _streamed, ...head } = cur;
        const stats = main.map((r) => ({
          output: r.output,
          cacheRead: r.cacheRead,
          tools: r.tools.size,
        }));
        const task: Task = {
          ...head,
          model: top ? top[0] : "unknown",
          turns: main.length,
          output: sum(stats.map((r) => r.output)),
          cacheRead: sum(stats.map((r) => r.cacheRead)),
          cacheWrite: sum(main.map((r) => r.cacheWrite)),
          toolCalls: sum(stats.map((r) => r.tools)),
          responses: stats,
          sideRequests: side.length,
          sideOutput: sum(side.map((r) => r.output)),
        };
        // Resuming or continuing a session can replay its prompts into a new file; keep the
        // copy that carries more of the task rather than counting the same prompt twice.
        const prev = byPrompt.get(task.promptId);
        if (!prev || richer(task, prev)) {
          byPrompt.set(task.promptId, task);
        }
      };
      for (const line of text.split("\n")) {
        if (!line.trim()) {
          continue;
        }
        let e: Entry;
        try {
          e = JSON.parse(line) as Entry;
        } catch {
          continue;
        }
        // Any human-looking prompt ends the current task, even one without a prompt id: its
        // replies must not be counted as extra turns of the ask before it.
        if (e.type === "user" && !e.isSidechain && isAsk(e)) {
          finish();
          cur = humanPrompt(e)
            ? {
                t: e.timestamp ? Date.parse(e.timestamp) : 0,
                day: dayOf(e.timestamp),
                origin: e.turnOrigin ?? "user",
                promptId: e.promptId ?? "",
                toolCalls: 0,
                responses: [],
                sideRequests: 0,
                sideOutput: 0,
                seen: new Map(),
              }
            : null;
          continue;
        }
        const m = e.message;
        if (e.type !== "assistant" || !cur || !m?.usage || !m.model || m.model === "<synthetic>") {
          continue;
        }
        // One response streams as several lines that share a message id; keep the line
        // carrying the final output count and union the tool calls seen across them.
        const key = `${m.id ?? ""}|${e.requestId ?? ""}`;
        const output = m.usage.output_tokens ?? 0;
        const seen = cur.seen.get(key);
        if (!seen) {
          cur.seen.set(key, {
            side: Boolean(e.isSidechain),
            model: m.model,
            output,
            cacheRead: m.usage.cache_read_input_tokens ?? 0,
            cacheWrite: m.usage.cache_creation_input_tokens ?? 0,
            tools: new Set(toolIds(m.content)),
          });
        } else {
          if (output > seen.output) {
            seen.output = output;
            seen.cacheRead = m.usage.cache_read_input_tokens ?? 0;
            seen.cacheWrite = m.usage.cache_creation_input_tokens ?? 0;
          }
          for (const id of toolIds(m.content)) {
            seen.tools.add(id);
          }
        }
      }
      finish();
    }
  }
  return [...byPrompt.values()].sort((a, b) => a.t - b.t);
}

/**
 * Which copy of a replayed prompt to keep: more turns, and at equal turns the one carrying more
 * usage, so a partially written replay cannot discard the fuller copy.
 */
const richer = (next: Task, prev: Task) =>
  next.turns !== prev.turns
    ? next.turns > prev.turns
    : next.output + next.cacheRead > prev.output + prev.cacheRead;

function toolIds(content: unknown): string[] {
  if (!Array.isArray(content)) {
    return [];
  }
  return content
    .filter((b) => (b as { type?: string } | null)?.type === "tool_use")
    .map((b) => String((b as { id?: string }).id ?? ""));
}

/** Splits tasks at an instant, so `--compare` honors the time of day it is given. */
export function splitAt(tasks: Task[], cutMs: number): { before: Task[]; after: Task[] } {
  return {
    before: tasks.filter((t) => t.t < cutMs),
    after: tasks.filter((t) => t.t >= cutMs),
  };
}

export type Summary = {
  tasks: number;
  turnsPerTask: { mean: number; median: number; p75: number; p90: number };
  outputPerTurn: { mean: number; median: number };
  outputPerTask: { mean: number; median: number; p95: number };
  cacheReadPerTurn: { median: number };
  toolCallsPerTurn: { median: number };
  sideRequestsPerTask: { mean: number };
  modelSharePct: Record<string, number>;
};

export function summarizeTasks(tasks: Task[]): Summary {
  const turns = tasks.map((t) => t.turns);
  // Per response, not per task: averaging task means would let a three-turn ask weigh as much
  // as a forty-turn run.
  const perResponse = tasks.flatMap((t) => t.responses);
  const outTurn = perResponse.map((r) => r.output);
  const outTask = tasks.map((t) => t.output);
  const models = new Map<string, number>();
  for (const t of tasks) {
    models.set(t.model, (models.get(t.model) ?? 0) + 1);
  }
  const modelSharePct: Record<string, number> = {};
  for (const [m, n] of [...models.entries()].sort((a, b) => b[1] - a[1])) {
    modelSharePct[m] = Math.round((1000 * n) / Math.max(tasks.length, 1)) / 10;
  }
  return {
    tasks: tasks.length,
    turnsPerTask: {
      mean: mean(turns),
      median: median(turns),
      p75: quantile(turns, 0.75),
      p90: quantile(turns, 0.9),
    },
    outputPerTurn: { mean: mean(outTurn), median: median(outTurn) },
    outputPerTask: { mean: mean(outTask), median: median(outTask), p95: quantile(outTask, 0.95) },
    cacheReadPerTurn: { median: median(perResponse.map((r) => r.cacheRead)) },
    toolCallsPerTurn: { median: median(perResponse.map((r) => r.tools)) },
    sideRequestsPerTask: { mean: mean(tasks.map((t) => t.sideRequests)) },
    modelSharePct,
  };
}

function printSummary(label: string, s: Summary) {
  const n = (v: number) => Math.round(v).toLocaleString("en-US");
  console.log(
    `${label.padEnd(12)} tasks ${String(s.tasks).padStart(6)}  turns/task ${s.turnsPerTask.median.toFixed(1)} med ${s.turnsPerTask.mean.toFixed(1)} mean p90 ${s.turnsPerTask.p90.toFixed(0)}` +
      `  out/turn ${n(s.outputPerTurn.median)} med ${n(s.outputPerTurn.mean)} mean` +
      `  out/task ${n(s.outputPerTask.median)} med ${n(s.outputPerTask.mean)} mean p95 ${n(s.outputPerTask.p95)}` +
      `  cacheRead/turn ${n(s.cacheReadPerTurn.median / 1000)}k  tools/turn ${s.toolCallsPerTurn.median.toFixed(2)}`,
  );
  const top = Object.entries(s.modelSharePct)
    .slice(0, 3)
    .map(([m, p]) => `${m.replace("claude-", "")} ${p}%`);
  if (top.length) {
    console.log(`${"".padEnd(12)} model mix: ${top.join(", ")}`);
  }
}

function arg(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(args: string[]) {
  const since = arg(args, "--since")
    ? Date.parse(arg(args, "--since")!)
    : Date.now() - Number(arg(args, "--days") ?? 7) * 86_400_000;
  if (!Number.isFinite(since)) {
    throw new Error("--since needs an ISO time; --days a number");
  }
  const compare = arg(args, "--compare");
  const cut = compare ? Date.parse(compare) : NaN;
  if (compare !== undefined && !Number.isFinite(cut)) {
    throw new Error("--compare needs an ISO time");
  }
  const byArg = arg(args, "--by");
  if (byArg !== undefined && byArg !== "model" && byArg !== "origin") {
    throw new Error("--by takes model or origin");
  }
  const by = byArg as "model" | "origin" | undefined;
  const rootsFromArgs = arg(args, "--claude-projects")?.split(",");
  const roots = rootsFromArgs ?? claudeProjectRoots(homedir());
  for (const r of roots) {
    if (!existsSync(r)) {
      throw new Error(`no transcript root at ${r}; --claude-projects takes existing directories`);
    }
  }

  const tasks = claudeTasks(roots, since);
  const unattributed = unattributedPrompts(roots, since);
  const subagents = subagentTranscripts(roots, since);
  const split = Number.isFinite(cut) ? splitAt(tasks, cut) : null;
  const groups = by
    ? [...new Set(tasks.map((t) => t[by]))]
        .map((key) => {
          const group = tasks.filter((t) => t[by] === key);
          const cutGroup = Number.isFinite(cut) ? splitAt(group, cut) : null;
          return {
            key,
            overall: summarizeTasks(group),
            before: cutGroup ? summarizeTasks(cutGroup.before) : undefined,
            after: cutGroup ? summarizeTasks(cutGroup.after) : undefined,
          };
        })
        .sort((a, b) => b.overall.tasks - a.overall.tasks)
    : null;
  const days = [...new Set(tasks.map((t) => t.day))].sort();
  const report = {
    since: new Date(since).toISOString(),
    compareAt: Number.isFinite(cut) ? new Date(cut).toISOString() : null,
    unattributedPrompts: unattributed,
    subagentTranscripts: subagents,
    overall: summarizeTasks(tasks),
    byDay: days.map((d) => ({ day: d, ...summarizeTasks(tasks.filter((t) => t.day === d)) })),
    groups,
    windows: split
      ? { before: summarizeTasks(split.before), after: summarizeTasks(split.after) }
      : null,
  };
  if (args.includes("--json")) {
    console.log(JSON.stringify(report, null, 1));
    return;
  }
  console.log(`since ${report.since}; ${tasks.length} tasks from ${roots.length} transcript roots`);
  if (report.compareAt) {
    console.log(`compared at ${report.compareAt}`);
  }
  if (subagents.files > 0) {
    console.log(
      `${subagents.files} subagent transcript files (${subagents.responses} responses) are excluded: each has its own prompt, so its turns are that agent's task, not the parent task's`,
    );
  }
  if (unattributed > 0) {
    console.log(
      `${unattributed} prompt-shaped entries had no prompt id and are not counted; name the client version that wrote them before comparing windows across it`,
    );
  }
  if (report.windows) {
    printSummary("before", report.windows.before);
    printSummary("after", report.windows.after);
    console.log("");
  }
  for (const g of groups ?? []) {
    if (g.before && g.after) {
      printSummary(`${g.key} before`, g.before);
      printSummary(`${g.key} after`, g.after);
    } else {
      printSummary(g.key, g.overall);
    }
  }
  if (groups?.length) {
    console.log("");
  }
  for (const d of report.byDay) {
    const { day, ...s } = d;
    printSummary(day, s);
  }
  console.log("");
  printSummary("overall", report.overall);
}

if (import.meta.main) {
  await main(process.argv.slice(2));
}
