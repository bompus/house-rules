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
