import { expect, test } from "bun:test";
import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { condense, sameFile } from "./condense-turns";

const line = (o: object) => JSON.stringify(o);

test("keeps typed user turns with surrounding assistant text and skips tool results and meta", () => {
  const jsonl = [
    line({
      type: "assistant",
      message: { content: [{ type: "text", text: "I will use option 1B." }] },
    }),
    line({ type: "user", message: { content: [{ type: "tool_result", content: "ok" }] } }),
    line({ type: "user", isMeta: true, message: { content: "meta note" } }),
    line({ type: "user", message: { content: "<system-reminder>x</system-reminder>" } }),
    line({ type: "user", message: { content: "what is 1B and where did it come from?" } }),
    line({
      type: "assistant",
      message: { content: [{ type: "text", text: "It came from the audit." }] },
    }),
  ].join("\n");
  const { turns, text } = condense(jsonl);
  expect(turns).toBe(1);
  expect(text).toContain("I will use option 1B.");
  expect(text).toContain("what is 1B and where did it come from?");
  expect(text).toContain("It came from the audit.");
  expect(text).not.toContain("meta note");
});

test("keeps a typed turn that starts with an angle bracket and skips host wrappers", () => {
  const jsonl = [
    line({ type: "assistant", message: { content: [{ type: "text", text: "Done." }] } }),
    line({ type: "user", message: { content: "<command-name>/clear</command-name>" } }),
    line({ type: "user", message: { content: "<local-command-stdout>ok</local-command-stdout>" } }),
    line({ type: "user", message: { content: "<task-notification>done</task-notification>" } }),
    line({ type: "user", message: { content: "<button> still has no accessible name; fix it" } }),
  ].join("\n");
  const { turns, text } = condense(jsonl);
  expect(turns).toBe(2);
  expect(text).toContain("<button> still has no accessible name");
  expect(text).toContain("/clear");
  expect(text).not.toContain("local-command-stdout");
  expect(text).not.toContain("task-notification");
});

test("strips host wrappers but keeps the user's own text, including a plain mention of a tag name", () => {
  const jsonl = [
    line({ type: "assistant", message: { content: [{ type: "text", text: "Fixed." }] } }),
    line({
      type: "user",
      message: { content: "<system-reminder>hidden</system-reminder>\nno, you skipped the test" },
    }),
    line({ type: "user", message: { content: "The system-reminder tag is leaking; remove it" } }),
  ].join("\n");
  const { turns, text } = condense(jsonl);
  expect(turns).toBe(2);
  expect(text).toContain("no, you skipped the test");
  expect(text).not.toContain("hidden");
  expect(text).toContain("The system-reminder tag is leaking");
});

test("ignores sidechain assistant text and marks a truncated user turn", () => {
  const long = "x".repeat(2000) + " you missed the failing test";
  const jsonl = [
    line({ type: "assistant", message: { content: [{ type: "text", text: "Main reply." }] } }),
    line({
      type: "assistant",
      isSidechain: true,
      message: { content: [{ type: "text", text: "Subagent reply." }] },
    }),
    line({ type: "user", message: { content: long } }),
  ].join("\n");
  const { text } = condense(jsonl);
  expect(text).toContain("Main reply.");
  expect(text).not.toContain("Subagent reply.");
  expect(text).toContain("you missed the failing test");
  expect(text).toMatch(/characters omitted/);
});

test("keeps a skill invocation as the slash command and its arguments", () => {
  const jsonl = [
    line({
      type: "user",
      message: {
        content:
          "<command-message>grilling</command-message><command-name>/grilling</command-name><command-args>Choose storage</command-args>",
      },
    }),
    line({ type: "assistant", message: { content: [{ type: "text", text: "First question." }] } }),
    line({ type: "user", message: { content: "no, ask about cost first" } }),
  ].join("\n");
  const { turns, text } = condense(jsonl);
  expect(turns).toBe(2);
  expect(text).toContain("/grilling Choose storage");
  expect(text).not.toContain("command-message");
});

test("takes assistant context only from between neighboring user turns, and names the line", () => {
  const jsonl = [
    line({ type: "user", message: { content: "start task one" } }),
    line({ type: "assistant", message: { content: [{ type: "text", text: "Task one reply." }] } }),
    line({ type: "user", message: { content: "now task two" } }),
    line({ type: "user", message: { content: "and steer it this way" } }),
    line({ type: "assistant", message: { content: [{ type: "text", text: "Task two reply." }] } }),
  ].join("\n");
  const { text } = condense(jsonl);
  const third = text.split("### TURN 3")[1] ?? "";
  expect(third).toContain("(transcript line 4)");
  expect(third).toContain("[assistant before, tail]\n(none)");
  expect(third).toContain("Task two reply.");
  const second = (text.split("### TURN 2")[1] ?? "").split("### TURN 3")[0];
  expect(second).toContain("[assistant after, head]\n(none)");
});

test("treats a symlink to the transcript as the same file", () => {
  const dir = mkdtempSync(join(tmpdir(), "condense-"));
  const input = join(dir, "t.jsonl");
  writeFileSync(input, "");
  symlinkSync(input, join(dir, "link.txt"));
  expect(sameFile(input, join(dir, "link.txt"))).toBe(true);
  expect(sameFile(input, input)).toBe(true);
  expect(sameFile(input, join(dir, "out.txt"))).toBe(false);
});
