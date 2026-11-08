import { expect, test } from "bun:test";
import { condense } from "./condense-turns";

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
  expect(turns).toBe(1);
  expect(text).toContain("<button> still has no accessible name");
  expect(text).not.toContain("/clear");
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
