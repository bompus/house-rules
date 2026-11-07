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
