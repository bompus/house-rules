#!/usr/bin/env bun
// Condense a Claude Code transcript (.jsonl) into one block per user-typed turn:
// the assistant text just before it, the user's words, and the start of the reply.
// Tool results, meta lines, sidechains and system-reminder text are skipped.
// Usage: bun condense-turns.ts <transcript.jsonl> [out.txt]   (stdout when no out file)
import { readFileSync, writeFileSync } from "node:fs";

type Block = { type?: string; text?: string };
type Line = {
  type?: string;
  isMeta?: boolean;
  isSidechain?: boolean;
  message?: { content?: string | Block[] };
};

// Elements Claude Code wraps around text it adds to a user line (slash commands, local command
// output, notices, hook text). They are removed; the user's own text around them is kept.
const HOST_TAGS =
  "command-name|command-message|command-args|local-command-stdout|local-command-stderr|local-command-caveat|system-reminder|task-notification|bash-input|bash-stdout|bash-stderr|user-prompt-submit-hook";
const HOST_WRAPPER = new RegExp(`<(${HOST_TAGS})>[\\s\\S]*?</\\1>`, "g");

function userText(content: string | Block[] | undefined): string {
  return textOf(content).replace(HOST_WRAPPER, "").trim();
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

const BEFORE_TAIL = 700;
const USER_HEAD = 900;
const AFTER_HEAD = 400;

function textOf(content: string | Block[] | undefined): string {
  if (typeof content === "string") {
    return content;
  }
  return (content ?? []).map((b) => (b.type === "text" ? (b.text ?? "") : "")).join("\n");
}

function hasToolResult(content: string | Block[] | undefined): boolean {
  return Array.isArray(content) && content.some((b) => b.type === "tool_result");
}

export function condense(jsonl: string): { turns: number; text: string } {
  const events: { role: "U" | "A"; text: string }[] = [];
  for (const raw of jsonl.split("\n")) {
    if (!raw.trim()) {
      continue;
    }
    const line = JSON.parse(raw) as Line;
    const content = line.message?.content;
    if (line.isSidechain) {
      continue;
    }
    if (line.type === "assistant") {
      const text = textOf(content).trim();
      if (text) {
        events.push({ role: "A", text });
      }
    } else if (line.type === "user") {
      if (hasToolResult(content) || line.isMeta) {
        continue;
      }
      const text = userText(content);
      if (text) {
        events.push({ role: "U", text });
      }
    }
  }
  const blocks: string[] = [];
  events.forEach((e, i) => {
    if (e.role !== "U") {
      return;
    }
    const before = events.slice(0, i).findLast((x) => x.role === "A")?.text ?? "";
    const after = events.slice(i + 1).find((x) => x.role === "A")?.text ?? "";
    blocks.push(
      `### TURN ${blocks.length + 1}\n[assistant before, tail]\n${before.slice(-BEFORE_TAIL)}\n` +
        `[USER]\n${head(e.text, USER_HEAD)}\n[assistant after, head]\n${after.slice(0, AFTER_HEAD)}\n`,
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
  const { turns, text } = condense(readFileSync(input, "utf8"));
  if (output) {
    writeFileSync(output, text);
    console.log(`${turns} turns, ${text.length} chars`);
  } else {
    process.stdout.write(text);
  }
}
