import { expect, test } from "bun:test";
import { join } from "node:path";
import { offersPullRequest } from "../scripts/check-pr-offer.mjs";

const form = (fix) =>
  `### What happened\n\nIt is slow.\n\n### Fix applied or workaround\n\n${fix}\n\n### Related issues\n\nNone.`;

test("an offer to open a pull request passes", () => {
  expect(
    offersPullRequest(form("None applied. I can open a pull request once triage agrees.")),
  ).toBe(true);
});

test("a link to an existing pull request passes", () => {
  expect(offersPullRequest(form("Fixed in https://github.com/acme/app/pull/12."))).toBe(true);
});

test("a field that only says nothing was applied fails", () => {
  expect(offersPullRequest(form("None applied."))).toBe(false);
});

test("the offer must sit in the field, not elsewhere in the draft", () => {
  const draft = form("None applied.").replace("It is slow.", "A pull request would help.");
  expect(offersPullRequest(draft)).toBe(false);
});

test("a free-form draft is judged by its closing lines", () => {
  expect(offersPullRequest("Slow.\n\nRepro below.\n\nI can open a pull request for this.")).toBe(
    true,
  );
  expect(offersPullRequest("A pull request exists.\n" + "line\n".repeat(10) + "Thanks.")).toBe(
    false,
  );
});

test("the command exits 1 on a missing offer and 0 on an offer", () => {
  const script = join(import.meta.dir, "../scripts/check-pr-offer.mjs");
  const run = (text) =>
    Bun.spawnSync(["node", script], { stdin: new TextEncoder().encode(text), stderr: "pipe" });
  expect(run(form("None applied.")).exitCode).toBe(1);
  expect(run(form("None applied. I can open a pull request.")).exitCode).toBe(0);
});
