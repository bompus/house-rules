#!/usr/bin/env bun
// Where did model usage go? Totals local transcript usage per provider, model and
// role (main session, subagent, advisor) over a window, priced at models.dev list
// rates, and reports context size per request and at session start.
//
//   bun usage-by-model.ts [--days N | --since ISO] [--providers claude,codex,opencode]
//                         [--prices models-dev.json] [--json]
//
// List price stands in for subscription quota; providers do not publish the
// conversion. Read the shares beside the provider's live quota readings, not as an
// invoice. Method and report shape: ../SKILL.md.
import { Database } from "bun:sqlite";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type Tokens = { fresh: number; output: number; cacheRead: number; cacheWrite: number };
export type Request = Tokens & {
  provider: string;
  priceProvider?: string;
  model: string;
  role: string;
  session: string;
  t: number;
};
type Rate = { input: number; output: number; cache_read?: number; cache_write?: number };
type PriceEntry = Rate & { tiers?: (Rate & { tier: { type: string; size: number } })[] };
export type Prices = Record<string, { models?: Record<string, { cost?: PriceEntry }> }>;

const PRICE_ORDER = ["anthropic", "openai", "google", "xai", "opencode", "opencode-go"];

/** models.dev entry for a model id, trying the recorded provider first, then known vendors. */
export function priceFor(prices: Prices, model: string, provider?: string): PriceEntry | undefined {
  const id = model.replace(/\[.*\]$/, "").replace(/-\d{8}$/, "");
  for (const p of [provider, ...PRICE_ORDER]) {
    const cost = p ? prices[p]?.models?.[id]?.cost : undefined;
    if (cost) {
      return cost;
    }
  }
  return undefined;
}

/** List cost of one request; long-context tiers apply when the request's context exceeds their size. */
export function requestCost(price: PriceEntry, r: Tokens): number {
  const ctx = r.fresh + r.cacheRead + r.cacheWrite;
  let rate: Rate = price;
  // The largest exceeded tier applies, whatever order the price list gives.
  let size = -1;
  for (const tier of price.tiers ?? []) {
    if (tier.tier.type === "context" && ctx > tier.tier.size && tier.tier.size > size) {
      rate = tier;
      size = tier.tier.size;
    }
  }
  const cr = rate.cache_read ?? rate.input * 0.1;
  const cw = rate.cache_write ?? rate.input * 1.25;
  return (
    (r.fresh * rate.input + r.output * rate.output + r.cacheRead * cr + r.cacheWrite * cw) / 1e6
  );
}

function* jsonlFiles(dir: string, since: number): Generator<string> {
  if (!existsSync(dir)) {
    return;
  }
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) {
      yield* jsonlFiles(path, since);
    } else if (name.endsWith(".jsonl") && st.mtimeMs >= since) {
      yield path;
    }
  }
}

function lines(path: string): unknown[] {
  const out: unknown[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.includes("usage")) {
      continue;
    }
    try {
      out.push(JSON.parse(line));
    } catch {
      // A partially written last line is skipped.
    }
  }
  return out;
}

type ClaudeUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  iterations?: (ClaudeUsage & { type?: string; model?: string })[];
};
type ClaudeEntry = {
  timestamp?: string;
  requestId?: string;
  isSidechain?: boolean;
  sessionId?: string;
  message?: { id?: string; model?: string; usage?: ClaudeUsage };
};

const claudeTokens = (u: ClaudeUsage): Tokens => ({
  fresh: u.input_tokens ?? 0,
  output: u.output_tokens ?? 0,
  cacheRead: u.cache_read_input_tokens ?? 0,
  cacheWrite: u.cache_creation_input_tokens ?? 0,
});

/** Claude Code transcripts: one row per API response, streamed duplicates removed, advisor calls split out. */
export function claudeRequests(root: string, since: number): Request[] {
  const out: Request[] = [];
  const seen = new Set<string>();
  for (const file of jsonlFiles(root, since)) {
    const fileRole = file.includes("/subagents/") ? "subagent" : "main";
    for (const raw of lines(file)) {
      const e = raw as ClaudeEntry;
      const m = e.message;
      const t = Date.parse(e.timestamp ?? "");
      // `<synthetic>` marks Claude Code's locally generated replies; they carry no usage.
      if (!m?.id || !m.usage || !m.model || m.model === "<synthetic>" || !(t >= since)) {
        continue;
      }
      const key = `${m.id}|${e.requestId ?? ""}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const role = e.isSidechain ? "subagent" : fileRole;
      const session = e.sessionId ?? file;
      out.push({
        provider: "claude",
        priceProvider: "anthropic",
        model: m.model,
        role,
        session,
        t,
        ...claudeTokens(m.usage),
      });
      for (const it of m.usage.iterations ?? []) {
        if (it.type !== "advisor_message" || !it.model) {
          continue;
        }
        out.push({
          provider: "claude",
          priceProvider: "anthropic",
          model: it.model,
          role: "advisor",
          session,
          t,
          ...claudeTokens(it),
        });
      }
    }
  }
  return out;
}

type CodexUsage = {
  input_tokens?: number;
  cached_input_tokens?: number;
  cache_write_input_tokens?: number;
  output_tokens?: number;
};
type CodexLine = {
  type?: string;
  timestamp?: string;
  payload?: { model?: string; usage?: CodexUsage; source?: unknown; id?: string };
};

/** Codex rollouts: one row per response record; input tokens include the cached ones. */
export function codexRequests(root: string, since: number): Request[] {
  const out: Request[] = [];
  for (const file of jsonlFiles(root, since)) {
    let model = "unknown";
    let role = "main";
    let session = file;
    for (const raw of readFileSync(file, "utf8").split("\n")) {
      if (!raw) {
        continue;
      }
      let e: CodexLine;
      try {
        e = JSON.parse(raw);
      } catch {
        continue;
      }
      const p = e.payload ?? {};
      if (e.type === "session_meta") {
        session = p.id ?? file;
        if (p.source && typeof p.source === "object" && "subagent" in p.source) {
          role = "subagent";
        }
      } else if (e.type === "turn_context" && p.model) {
        model = p.model;
      } else if (e.type === "token_usage_record" && p.usage) {
        const t = Date.parse(e.timestamp ?? "");
        if (!(t >= since)) {
          continue;
        }
        const u = p.usage;
        const cached = u.cached_input_tokens ?? 0;
        out.push({
          provider: "codex",
          priceProvider: "openai",
          model,
          role,
          session,
          t,
          fresh: Math.max(0, (u.input_tokens ?? 0) - cached),
          cacheRead: cached,
          cacheWrite: u.cache_write_input_tokens ?? 0,
          output: u.output_tokens ?? 0,
        });
      }
    }
  }
  return out;
}

type OpenCodeData = {
  role?: string;
  modelID?: string;
  providerID?: string;
  tokens?: {
    input?: number;
    output?: number;
    reasoning?: number;
    cache?: { read?: number; write?: number };
  };
};

/** OpenCode's database: assistant messages; a session with a parent is a subagent. */
export function opencodeRequests(dbPath: string, since: number): Request[] {
  if (!existsSync(dbPath)) {
    return [];
  }
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db
      .query(
        "select m.session_id as s, m.time_created as t, m.data as d, s.parent_id as parent from message m join session s on s.id = m.session_id where m.time_created >= ?",
      )
      .all(since) as { s: string; t: number; d: string; parent: string | null }[];
    const out: Request[] = [];
    for (const row of rows) {
      const d = JSON.parse(row.d) as OpenCodeData;
      if (d.role !== "assistant" || !d.modelID || !d.tokens) {
        continue;
      }
      out.push({
        provider: "opencode",
        priceProvider: d.providerID,
        model: d.modelID,
        role: row.parent ? "subagent" : "main",
        session: row.s,
        t: row.t,
        fresh: d.tokens.input ?? 0,
        output: (d.tokens.output ?? 0) + (d.tokens.reasoning ?? 0),
        cacheRead: d.tokens.cache?.read ?? 0,
        cacheWrite: d.tokens.cache?.write ?? 0,
      });
    }
    return out;
  } finally {
    db.close();
  }
}

const quantile = (xs: number[], q: number) =>
  xs.length ? (xs[Math.min(xs.length - 1, Math.floor(q * xs.length))] ?? 0) : 0;

export function summarize(reqs: Request[], prices: Prices) {
  const groups = new Map<
    string,
    Tokens & {
      provider: string;
      model: string;
      role: string;
      requests: number;
      cost: number | null;
    }
  >();
  const unpriced = new Set<string>();
  for (const r of reqs) {
    const key = `${r.provider}|${r.model}|${r.role}`;
    const g = groups.get(key) ?? {
      provider: r.provider,
      model: r.model,
      role: r.role,
      requests: 0,
      fresh: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
    };
    g.requests += 1;
    g.fresh += r.fresh;
    g.output += r.output;
    g.cacheRead += r.cacheRead;
    g.cacheWrite += r.cacheWrite;
    const price = priceFor(prices, r.model, r.priceProvider);
    if (price && g.cost !== null) {
      g.cost += requestCost(price, r);
    } else if (!price) {
      g.cost = null;
      unpriced.add(r.model);
    }
    groups.set(key, g);
  }
  const total = [...groups.values()].reduce((s, g) => s + (g.cost ?? 0), 0);
  const rows = [...groups.values()]
    .map((g) => ({
      ...g,
      cost: g.cost === null ? null : Math.round(g.cost * 100) / 100,
      sharePct: g.cost === null || !total ? null : Math.round((1000 * g.cost) / total) / 10,
    }))
    .sort((a, b) => (b.cost ?? -1) - (a.cost ?? -1));
  const context: Record<
    string,
    { requestP50: number; requestP90: number; sessionStartP50: number; sessions: number }
  > = {};
  for (const provider of new Set(reqs.map((r) => r.provider))) {
    const main = reqs
      .filter((r) => r.provider === provider && r.role === "main")
      .sort((a, b) => a.t - b.t);
    const ctx = main.map((r) => r.fresh + r.cacheRead + r.cacheWrite).sort((a, b) => a - b);
    const first = new Map<string, number>();
    for (const r of main) {
      if (!first.has(r.session)) {
        first.set(r.session, r.fresh + r.cacheRead + r.cacheWrite);
      }
    }
    const starts = [...first.values()].sort((a, b) => a - b);
    context[provider] = {
      requestP50: quantile(ctx, 0.5),
      requestP90: quantile(ctx, 0.9),
      sessionStartP50: quantile(starts, 0.5),
      sessions: starts.length,
    };
  }
  return { listCostTotal: Math.round(total * 100) / 100, rows, context, unpriced: [...unpriced] };
}

function arg(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function fetchPrices(): Promise<unknown> {
  const res = await fetch("https://models.dev/api.json");
  if (!res.ok) {
    throw new Error(`models.dev price list returned ${res.status}; pass --prices <file>`);
  }
  return res.json();
}

async function main(args: string[]) {
  const since = arg(args, "--since")
    ? Date.parse(arg(args, "--since")!)
    : Date.now() - Number(arg(args, "--days") ?? 7) * 86_400_000;
  if (!Number.isFinite(since)) {
    throw new Error("--since needs an ISO time; --days a number");
  }
  const providers = (arg(args, "--providers") ?? "claude,codex,opencode").split(",");
  const pricePath = arg(args, "--prices");
  const prices = (
    pricePath ? JSON.parse(readFileSync(pricePath, "utf8")) : await fetchPrices()
  ) as Prices;
  const home = homedir();
  const reqs = [
    ...(providers.includes("claude")
      ? claudeRequests(join(home, ".claude", "projects"), since)
      : []),
    ...(providers.includes("codex") ? codexRequests(join(home, ".codex", "sessions"), since) : []),
    ...(providers.includes("opencode")
      ? opencodeRequests(join(home, ".local", "share", "opencode", "opencode.db"), since)
      : []),
  ];
  const report = {
    since: new Date(since).toISOString(),
    providers,
    requests: reqs.length,
    ...summarize(reqs, prices),
  };
  if (args.includes("--json")) {
    console.log(JSON.stringify(report, null, 1));
    return;
  }
  const M = (n: number) => (n / 1e6).toFixed(2);
  console.log(
    `since ${report.since}; ${report.requests} requests; list total $${report.listCostTotal}`,
  );
  console.log(
    "provider  model                          role      reqs   fresh(M) out(M) cacheR(M) cacheW(M)   list$  share",
  );
  for (const r of report.rows) {
    console.log(
      `${r.provider.padEnd(9)} ${r.model.slice(0, 30).padEnd(30)} ${r.role.padEnd(9)} ${String(r.requests).padStart(6)} ${M(r.fresh).padStart(9)} ${M(r.output).padStart(6)} ${M(r.cacheRead).padStart(9)} ${M(r.cacheWrite).padStart(9)} ${String(r.cost ?? "n/a").padStart(8)} ${r.sharePct === null ? "  n/a" : `${r.sharePct}%`.padStart(6)}`,
    );
  }
  for (const [p, c] of Object.entries(report.context)) {
    console.log(
      `${p}: main-request context p50 ${c.requestP50}, p90 ${c.requestP90}; session start p50 ${c.sessionStartP50} over ${c.sessions} sessions`,
    );
  }
  if (report.unpriced.length) {
    console.log(`no models.dev price: ${report.unpriced.join(", ")}`);
  }
}

if (import.meta.main) {
  await main(process.argv.slice(2));
}
