import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check, render, type ReportData } from "../scripts/render-report.ts";
import {
  claudeRequests,
  codexRequests,
  priceFor,
  requestCost,
  summarize,
  type Prices,
} from "../scripts/usage-by-model.ts";

const prices: Prices = {
  anthropic: {
    models: {
      "claude-haiku-5-5": {
        cost: {
          input: 0.1,
          output: 0.5,
          cache_read: 0.01,
          cache_write: 0.125,
          tiers: [
            {
              input: 0.5,
              output: 2.5,
              cache_read: 0.05,
              cache_write: 0.625,
              tier: { type: "context", size: 100000 },
            },
          ],
        },
      },
      "claude-fable-5-1": { cost: { input: 10, output: 50, cache_read: 1, cache_write: 12.5 } },
    },
  },
  openai: {
    models: {
      "gpt-6.1-sol": { cost: { input: 2, output: 10, cache_read: 0.1, cache_write: 2.5 } },
    },
  },
};

describe("usage-by-model", () => {
  test("a request past the context tier is priced at the tier's rates", () => {
    const price = priceFor(prices, "claude-haiku-5-5")!;
    expect(
      requestCost(price, { fresh: 0, output: 1_000_000, cacheRead: 50_000, cacheWrite: 0 }),
    ).toBeCloseTo(0.5005, 6);
    expect(
      requestCost(price, { fresh: 0, output: 1_000_000, cacheRead: 150_000, cacheWrite: 0 }),
    ).toBeCloseTo(2.5075, 6);
  });

  test("the largest exceeded context tier applies whatever the list order", () => {
    const price = {
      input: 1,
      output: 1,
      tiers: [
        { input: 3, output: 3, cache_read: 3, tier: { type: "context", size: 200_000 } },
        { input: 2, output: 2, cache_read: 2, tier: { type: "context", size: 100_000 } },
      ],
    };
    expect(
      requestCost(price, { fresh: 0, output: 0, cacheRead: 1_000_000, cacheWrite: 0 }),
    ).toBeCloseTo(3, 6);
  });

  test("Claude streamed duplicates count once, advisor calls split out, synthetic replies skipped", () => {
    const dir = mkdtempSync(join(tmpdir(), "usage-claude-"));
    mkdirSync(join(dir, "p"));
    const usage = {
      input_tokens: 10,
      output_tokens: 100,
      cache_read_input_tokens: 1000,
      cache_creation_input_tokens: 0,
      iterations: [
        {
          type: "advisor_message",
          model: "claude-fable-5-1",
          input_tokens: 5000,
          output_tokens: 500,
        },
      ],
    };
    const entry = {
      timestamp: "2026-10-09T12:00:00Z",
      requestId: "r1",
      sessionId: "s1",
      message: { id: "m1", model: "claude-haiku-5-5", usage },
    };
    const synthetic = {
      timestamp: "2026-10-09T12:01:00Z",
      sessionId: "s1",
      message: { id: "m2", model: "<synthetic>", usage: { input_tokens: 0 } },
    };
    writeFileSync(
      join(dir, "p", "s1.jsonl"),
      [entry, entry, synthetic].map((e) => JSON.stringify(e)).join("\n"),
    );
    const reqs = claudeRequests(dir, 0);
    expect(reqs.map((r) => `${r.model}/${r.role}`)).toEqual([
      "claude-haiku-5-5/main",
      "claude-fable-5-1/advisor",
    ]);
    const s = summarize(reqs, prices);
    expect(s.rows[0]?.model).toBe("claude-fable-5-1");
    expect(s.unpriced).toEqual([]);
  });

  test("Codex cached input is not counted again as fresh input; model comes from the turn context", () => {
    const dir = mkdtempSync(join(tmpdir(), "usage-codex-"));
    const lines = [
      { type: "session_meta", payload: { id: "c1" } },
      { type: "turn_context", payload: { model: "gpt-6.1-sol" } },
      {
        type: "token_usage_record",
        timestamp: "2026-10-09T12:00:00Z",
        payload: { usage: { input_tokens: 1000, cached_input_tokens: 800, output_tokens: 50 } },
      },
    ];
    writeFileSync(join(dir, "rollout-1.jsonl"), lines.map((e) => JSON.stringify(e)).join("\n"));
    const [r] = codexRequests(dir, 0);
    expect(r).toMatchObject({
      model: "gpt-6.1-sol",
      fresh: 200,
      cacheRead: 800,
      output: 50,
      session: "c1",
    });
  });

  test("Codex token_count events count once each when a rollout has no usage records", () => {
    const dir = mkdtempSync(join(tmpdir(), "usage-codex-events-"));
    const usage = { input_tokens: 1000, cached_input_tokens: 800, output_tokens: 50 };
    const event = (total: number) => ({
      type: "event_msg",
      timestamp: "2026-10-09T12:00:00Z",
      payload: {
        type: "token_count",
        info: { last_token_usage: usage, total_token_usage: { total_tokens: total } },
      },
    });
    const lines = [
      { type: "turn_context", payload: { model: "gpt-6.1-sol" } },
      event(1050),
      event(1050), // repeated for a rate-limit update only
      event(2100),
    ];
    writeFileSync(join(dir, "rollout-2.jsonl"), lines.map((e) => JSON.stringify(e)).join("\n"));
    expect(codexRequests(dir, 0).map((r) => r.fresh)).toEqual([200, 200]);

    const record = {
      type: "token_usage_record",
      timestamp: "2026-10-09T12:00:00Z",
      payload: { usage },
    };
    writeFileSync(
      join(dir, "rollout-2.jsonl"),
      [...lines, record].map((e) => JSON.stringify(e)).join("\n"),
    );
    expect(codexRequests(dir, 0)).toHaveLength(1);
  });
});

describe("render-report", () => {
  const example = JSON.parse(
    readFileSync(join(import.meta.dir, "..", "assets", "example-report.json"), "utf8"),
  ) as ReportData;

  test("the bundled example passes its own checks", () => {
    expect(check(example)).toEqual([]);
  });

  test("a fourth colored series is rejected", () => {
    const bad = {
      ...example,
      series: { ...example.series, extra: { name: "Model X", slot: 2 } },
    };
    expect(check(bad).join("\n")).toContain("at most 3 colored series");
  });

  test("an undeclared series key is reported", () => {
    const bad = { ...example, sections: [{ type: "bars", rows: [{ key: "gemini" }] }] };
    expect(check(bad).join("\n")).toContain("series key gemini is not declared");
  });

  test("text that would close the data script is escaped", () => {
    const html = render({ ...example, title: "</script><b>x" }, "<script>__REPORT_DATA__</script>");
    expect(html).not.toContain("</script><b>");
  });
});
