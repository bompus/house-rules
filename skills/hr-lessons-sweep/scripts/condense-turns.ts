#!/usr/bin/env bun
// Condense a Claude Code transcript (.jsonl) into one block per user-typed turn: the assistant
// text between the previous user turn and this one, the user's words, and the start of the reply
// before the next user turn. Each block names its transcript line so omitted text can be read.
// Tool results, meta lines, sidechains and host-added wrapper text are skipped; slash commands
// are kept as "/name arguments".
// Usage: bun condense-turns.ts <transcript.jsonl> [out.txt]   (stdout when no out file)
import { readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";

type Block = { type?: string; text?: string };
type Line = {
  type?: string;
  isMeta?: boolean;
  isSidechain?: boolean;
  message?: { content?: string | Block[] };
};

const BEFORE_TAIL = 700;
const USER_HEAD = 900;
const AFTER_HEAD = 400;

// Elements Claude Code wraps around text it adds to a user line (local command output, notices,
// hook text). They are removed; the user's own text around them is kept.
const HOST_TAGS =
  "command-message|local-command-stdout|local-command-stderr|local-command-caveat|system-reminder|task-notification|bash-input|bash-stdout|bash-stderr|user-prompt-submit-hook";
const HOST_WRAPPER = new RegExp(`<(${HOST_TAGS})>[\\s\\S]*?</\\1>`, "g");
const COMMAND =
  /<command-name>([\s\S]*?)<\/command-name>\s*(?:<command-args>([\s\S]*?)<\/command-args>)?/g;

function textOf(content: string | Block[] | undefined): string {
  if (typeof content === "string") {
    return content;
  }
  return (content ?? []).map((b) => (b.type === "text" ? (b.text ?? "") : "")).join("\n");
}

function hasToolResult(content: string | Block[] | undefined): boolean {
  return Array.isArray(content) && content.some((b) => b.type === "tool_result");
}

function userText(content: string | Block[] | undefined): string {
  return textOf(content)
    .replace(HOST_WRAPPER, "")
    .replace(COMMAND, (_, name: string, args?: string) =>
      [name.trim(), (args ?? "").trim()].filter(Boolean).join(" "),
    )
    .trim();
}

function head(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }
  // Keep both ends: a correction often follows a pasted log or excerpt.
  const tail = Math.floor(limit / 3);
  const omitted = text.length - limit;
  return `${text.slice(0, limit - tail)}\n[... ${omitted} characters omitted ...]\n${text.slice(-tail)}`;
}

/** Whether two paths name the same file, following links. A missing path is never the same. */
export function sameFile(a: string, b: string): boolean {
  try {
    const sa = statSync(a);
    const sb = statSync(b);
    return (sa.dev === sb.dev && sa.ino === sb.ino) || realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
}

export function condense(jsonl: string): { turns: number; text: string } {
  const events: { role: "U" | "A"; text: string; line: number }[] = [];
  jsonl.split("\n").forEach((raw, index) => {
    if (!raw.trim()) {
      return;
    }
    const line = JSON.parse(raw) as Line;
    if (line.isSidechain) {
      return;
    }
    const content = line.message?.content;
    if (line.type === "assistant") {
      const text = textOf(content).trim();
      if (text) {
        events.push({ role: "A", text, line: index + 1 });
      }
    } else if (line.type === "user" && !hasToolResult(content) && !line.isMeta) {
      const text = userText(content);
      if (text) {
        events.push({ role: "U", text, line: index + 1 });
      }
    }
  });
  const blocks: string[] = [];
  events.forEach((e, i) => {
    if (e.role !== "U") {
      return;
    }
    const before = events[i - 1]?.role === "A" ? events[i - 1]?.text : undefined;
    const after = events[i + 1]?.role === "A" ? events[i + 1]?.text : undefined;
    blocks.push(
      `### TURN ${blocks.length + 1} (transcript line ${e.line})\n` +
        `[assistant before, tail]\n${before === undefined ? "(none)" : before.slice(-BEFORE_TAIL)}\n` +
        `[USER]\n${head(e.text, USER_HEAD)}\n` +
        `[assistant after, head]\n${after === undefined ? "(none)" : after.slice(0, AFTER_HEAD)}\n`,
    );
  });
  return { turns: blocks.length, text: blocks.join("\n") };
}

if (import.meta.main) {
  const [input, output] = process.argv.slice(2);
  if (!input) {
    console.error("usage: bun condense-turns.ts <transcript.jsonl> [out.txt]");
    process.exit(2);
  }
  if (output && sameFile(input, output)) {
    console.error("refusing to write the output over the input transcript");
    process.exit(2);
  }
  const { turns, text } = condense(readFileSync(input, "utf8"));
  if (output) {
    writeFileSync(output, text);
    console.log(`${turns} turns, ${text.length} chars`);
  } else {
    process.stdout.write(text);
  }
}
