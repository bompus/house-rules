---
expect: reply
without: - Reuse first:.*?extend or install that one instead\.\n
requiredPattern: withRetry
forbiddenPattern: npm install|bun add|pnpm add|yarn add|axios-retry|p-retry|async function (retry|backoff)\w*|function (retry|backoff)\w*\(|(const|let) \w*(retry|backoff)\w*\s*=
---

## Project AGENTS.md

# orders-api

Tests: `bun test`.

## Transcript so far

USER: fetchOrder sometimes fails with a 503 from the warehouse service. Make it retry a couple of times.
AGENT: TOOL_CALL read src/clients/warehouse.ts
TOOL RESULT: `export async function fetchOrder(id: string) { const res = await http.get(`/orders/${id}`); return res.json(); }`
AGENT: TOOL_CALL grep -rn "retry" src
TOOL RESULT: src/lib/retry.ts:3: `export async function withRetry<T>(fn: () => Promise<T>, opts: { attempts: number; delayMs: number; retryOn?: (e: unknown) => boolean }): Promise<T>` ; src/clients/billing.ts:12: `return withRetry(() => http.get(url), { attempts: 3, delayMs: 200 })`
