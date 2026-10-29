import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  claudeTasks,
  humanPrompt,
  isMetadataEntry,
  isSubagentTranscript,
  looksLikePrompt,
  splitAt,
  subagentTranscripts,
  summarizeTasks,
  unattributedPrompts,
  type Task,
} from "../scripts/turns-per-task.ts";

const line = (e: unknown) => JSON.stringify(e);

/** One session: two prompts, a streamed response, a tool result, a sidechain, and a stray prompt. */
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "turns-"));
  mkdirSync(join(root, "project"), { recursive: true });
  const rows = [
    {
      type: "user",
      promptId: "p1",
      timestamp: "2026-10-15T10:00:00Z",
      turnOrigin: "user",
      message: { content: "do a thing" },
    },
    {
      type: "assistant",
      requestId: "r1",
      timestamp: "2026-10-15T10:00:01Z",
      message: {
        id: "m1",
        model: "claude-sonnet-5-5",
        usage: { output_tokens: 2, cache_read_input_tokens: 10 },
        content: [{ type: "thinking" }],
      },
    },
    {
      type: "assistant",
      requestId: "r1",
      timestamp: "2026-10-15T10:00:02Z",
      message: {
        id: "m1",
        model: "claude-sonnet-5-5",
        usage: {
          output_tokens: 100,
          cache_read_input_tokens: 500,
          cache_creation_input_tokens: 40,
        },
        content: [{ type: "tool_use", id: "t1" }],
      },
    },
    {
      type: "assistant",
      requestId: "r1",
      timestamp: "2026-10-15T10:00:03Z",
      message: {
        id: "m1",
        model: "claude-sonnet-5-5",
        usage: {
          output_tokens: 100,
          cache_read_input_tokens: 500,
          cache_creation_input_tokens: 40,
        },
        content: [{ type: "tool_use", id: "t2" }],
      },
    },
    {
      type: "user",
      promptId: "p1",
      timestamp: "2026-10-15T10:00:04Z",
      message: { content: [{ type: "tool_result", content: "ok" }] },
    },
    {
      type: "user",
      promptId: "p1",
      isMeta: true,
      timestamp: "2026-10-15T10:00:04Z",
      message: { content: "Status update for the ledger" },
    },
    {
      type: "user",
      promptId: "p1",
      timestamp: "2026-10-15T10:00:04Z",
      message: { content: "<command-name>/compact</command-name>\n  " },
    },
    {
      type: "assistant",
      requestId: "r2",
      timestamp: "2026-10-15T10:00:05Z",
      message: {
        id: "m2",
        model: "claude-sonnet-5-5",
        usage: { output_tokens: 20, cache_read_input_tokens: 50 },
        content: [{ type: "text", text: "done" }],
      },
    },
    {
      type: "assistant",
      isSidechain: true,
      requestId: "r3",
      timestamp: "2026-10-15T10:00:06Z",
      message: {
        id: "m3",
        model: "claude-fable-5-1",
        usage: { output_tokens: 70 },
        content: [{ type: "text", text: "reviewed" }],
      },
    },
    {
      type: "assistant",
      requestId: "r4",
      timestamp: "2026-10-15T10:00:07Z",
      message: { id: "m4", model: "<synthetic>", usage: {}, content: [] },
    },
    {
      type: "user",
      promptId: "p2",
      timestamp: "2026-10-16T09:00:00Z",
      turnOrigin: "sdk",
      message: { content: "second task" },
    },
    {
      type: "assistant",
      requestId: "r5",
      timestamp: "2026-10-16T09:00:01Z",
      message: {
        id: "m5",
        model: "claude-opus-5-5",
        usage: { output_tokens: 30 },
        content: [{ type: "text", text: "ok" }],
      },
    },
    {
      type: "user",
      requestId: "r6",
      timestamp: "2026-10-16T09:00:02Z",
      message: { content: "no prompt id here" },
    },
    {
      type: "assistant",
      requestId: "r7",
      timestamp: "2026-10-16T09:00:03Z",
      message: {
        id: "m7",
        model: "claude-opus-5-5",
        usage: { output_tokens: 999 },
        content: [{ type: "text", text: "stray" }],
      },
    },
  ];
  writeFileSync(join(root, "project", "s.jsonl"), rows.map(line).join("\n") + "\n");
  const sub = join(root, "project", "session-1", "subagents");
  mkdirSync(sub, { recursive: true });
  const agentRows = [
    {
      type: "user",
      isSidechain: true,
      promptId: "a1",
      timestamp: "2026-10-15T11:00:00Z",
      message: { content: "review this" },
    },
    {
      type: "assistant",
      isSidechain: true,
      requestId: "x1",
      timestamp: "2026-10-15T11:00:01Z",
      message: {
        id: "x1",
        model: "claude-fable-5-1",
        usage: { output_tokens: 5 },
        content: [{ type: "text", text: "one" }],
      },
    },
    {
      type: "assistant",
      isSidechain: true,
      requestId: "x2",
      timestamp: "2026-10-15T11:00:02Z",
      message: {
        id: "x2",
        model: "claude-fable-5-1",
        usage: { output_tokens: 6 },
        content: [{ type: "text", text: "two" }],
      },
    },
  ];
  writeFileSync(join(sub, "agent-x.jsonl"), agentRows.map(line).join("\n") + "\n");
  // A resumed session replays its prompts into a new file; the same prompt id must stay one task.
  mkdirSync(join(root, "resumed"), { recursive: true });
  const replayed = [
    {
      type: "user",
      promptId: "p1",
      timestamp: "2026-10-15T10:00:00Z",
      turnOrigin: "user",
      message: { content: "do a thing" },
    },
    {
      type: "assistant",
      requestId: "r1",
      timestamp: "2026-10-15T10:00:02Z",
      message: {
        id: "m1",
        model: "claude-sonnet-5-5",
        usage: { output_tokens: 3, cache_read_input_tokens: 1 },
        content: [{ type: "tool_use", id: "t1" }],
      },
    },
    {
      type: "assistant",
      requestId: "r2",
      timestamp: "2026-10-15T10:00:05Z",
      message: {
        id: "m2",
        model: "claude-sonnet-5-5",
        usage: { output_tokens: 2 },
        content: [{ type: "text", text: "partial" }],
      },
    },
  ];
  writeFileSync(join(root, "resumed", "s.jsonl"), replayed.map(line).join("\n") + "\n");
  return root;
}

describe("humanPrompt", () => {
  test("counts a plain prompt and skips a tool result", () => {
    expect(humanPrompt({ promptId: "p", message: { content: "hi" } })).toBe(true);
    expect(
      humanPrompt({
        promptId: "p",
        message: { content: [{ type: "tool_result" }, { type: "text" }] },
      }),
    ).toBe(false);
  });

  test("separates metadata entries from asks", () => {
    expect(isMetadataEntry({ isMeta: true, message: { content: "status" } })).toBe(true);
    expect(
      isMetadataEntry({ message: { content: "<local-command-stdout>x</local-command-stdout>" } }),
    ).toBe(true);
    expect(
      isMetadataEntry({
        message: { content: [{ type: "text", text: "<system-reminder>x</system-reminder>" }] },
      }),
    ).toBe(true);
    expect(isMetadataEntry({ message: { content: "fix the bug" } })).toBe(false);
    // A skill the person invoked is an ask; session housekeeping is not.
    expect(
      isMetadataEntry({ message: { content: "<command-name>/grilling</command-name>\n" } }),
    ).toBe(false);
    expect(
      isMetadataEntry({ message: { content: "<command-name>/hr-what-next</command-name>" } }),
    ).toBe(false);
    expect(
      humanPrompt({ promptId: "p", message: { content: "<command-name>/compact</command-name>" } }),
    ).toBe(false);
    expect(
      isMetadataEntry({
        message: {
          content: [{ type: "text", text: "<command-name>/x</command-name>" }, { type: "image" }],
        },
      }),
    ).toBe(false);
    expect(
      isMetadataEntry({
        message: { content: "<local-command-caveat>c</local-command-caveat>\n\nNow fix the bug" },
      }),
    ).toBe(false);
    expect(
      isMetadataEntry({
        message: {
          content: [
            { type: "text", text: "<system-reminder>be brief</system-reminder>" },
            { type: "text", text: "then fix the bug" },
          ],
        },
      }),
    ).toBe(false);
    expect(
      humanPrompt({
        promptId: "p",
        message: { content: "<command-name>/x</command-name>\n do it" },
      }),
    ).toBe(true);
    expect(isMetadataEntry({ message: { content: [{ type: "text", text: "fix the bug" }] } })).toBe(
      false,
    );
  });

  test("skips entries without a prompt id but still sees them as prompts", () => {
    expect(humanPrompt({ message: { content: "hi" } })).toBe(false);
    expect(looksLikePrompt({ message: { content: "hi" } })).toBe(true);
  });
});

describe("claudeTasks", () => {
  const tasks = claudeTasks([fixture()], 0);
  const find = (origin: string) => tasks.find((t) => t.origin === origin) as Task;

  test("counts a prompt replayed into a second file once, keeping the fuller copy", () => {
    const copies = tasks.filter((t) => t.promptId === "p1");
    expect(copies).toHaveLength(1);
    expect(copies[0]?.output).toBe(120);
  });

  test("ignores injected entries without ending the task they arrive in", () => {
    const t = find("user");
    expect(t.turns).toBe(2);
    expect(t.output).toBe(120);
    expect(tasks).toHaveLength(2);
  });

  test("makes one task per human prompt", () => {
    expect(tasks).toHaveLength(2);
    expect(tasks.map((t) => t.origin).sort()).toEqual(["sdk", "user"]);
  });

  test("collapses a streamed response to one turn and keeps its final usage", () => {
    const t = find("user");
    expect(t.turns).toBe(2);
    expect(t.output).toBe(120);
    expect(t.cacheRead).toBe(550);
    expect(t.cacheWrite).toBe(40);
    expect(t.toolCalls).toBe(2);
    expect(t.responses.map((r) => r.output)).toEqual([100, 20]);
  });

  test("keeps sidechain work off the main turn count", () => {
    const t = find("user");
    expect(t.sideRequests).toBe(1);
    expect(t.sideOutput).toBe(70);
    expect(t.model).toBe("claude-sonnet-5-5");
  });

  test("skips synthetic responses and takes the day from the prompt", () => {
    const t = find("sdk");
    expect(t.turns).toBe(1);
    expect(t.day).toBe("2026-10-16");
    expect(t.model).toBe("claude-opus-5-5");
  });

  test("ends a task at a prompt without a prompt id but does not start one", () => {
    expect(find("sdk").turns).toBe(1);
    expect(find("sdk").output).toBe(30);
    expect(tasks).toHaveLength(2);
  });

  test("reads no tasks from separate subagent transcripts", () => {
    expect(tasks.every((t) => !t.model.includes("fable"))).toBe(true);
  });

  test("counts prompt-shaped entries that carry no prompt id", () => {
    expect(unattributedPrompts([fixture()], 0)).toBe(1);
    expect(unattributedPrompts([fixture()], Date.parse("2026-10-16T09:00:03Z"))).toBe(0);
  });

  test("reports separate subagent transcripts instead of merging them", () => {
    // Three assistant lines, two distinct responses: a streamed response counts once.
    expect(subagentTranscripts([fixture()], 0)).toEqual({ files: 1, responses: 2 });
  });

  test("drops prompts before the window", () => {
    expect(claudeTasks([fixture()], Date.parse("2026-10-16T00:00:00Z"))).toHaveLength(1);
  });
});

describe("isSubagentTranscript", () => {
  test("recognizes both path separators", () => {
    expect(isSubagentTranscript("/home/x/projects/p/s/subagents/agent-a.jsonl")).toBe(true);
    expect(isSubagentTranscript("C:\\Users\\x\\projects\\p\\s\\subagents\\agent-a.jsonl")).toBe(
      true,
    );
    expect(isSubagentTranscript("/home/x/projects/p/subagents-old/s.jsonl")).toBe(false);
    expect(isSubagentTranscript("/home/x/projects/p/s.jsonl")).toBe(false);
  });
});

describe("splitAt", () => {
  test("splits on the given instant, not the date", () => {
    const tasks = claudeTasks([fixture()], 0);
    const cut = Date.parse("2026-10-16T08:00:00Z");
    const { before, after } = splitAt(tasks, cut);
    expect(before).toHaveLength(1);
    expect(after).toHaveLength(1);
    expect(before[0]?.day).toBe("2026-10-15");
  });
});

describe("summarizeTasks", () => {
  test("averages output per turn over responses, not task means", () => {
    const s = summarizeTasks(claudeTasks([fixture()], 0));
    expect(s.tasks).toBe(2);
    expect(s.turnsPerTask.mean).toBe(1.5);
    expect(s.turnsPerTask.median).toBe(2);
    // Responses carry 100, 20 and 30 output tokens; task means would read 60 and 30.
    expect(s.outputPerTurn.mean).toBe(50);
    expect(s.outputPerTurn.median).toBe(30);
    expect(s.outputPerTask.mean).toBe(75);
    expect(s.outputPerTask.p95).toBe(120);
    expect(s.modelSharePct).toEqual({ "claude-opus-5-5": 50, "claude-sonnet-5-5": 50 });
  });

  test("reports nothing for an empty set", () => {
    const s = summarizeTasks([]);
    expect(s.tasks).toBe(0);
    expect(s.turnsPerTask.median).toBe(0);
    expect(s.outputPerTurn.median).toBe(0);
    expect(s.outputPerTask.p95).toBe(0);
  });
});
