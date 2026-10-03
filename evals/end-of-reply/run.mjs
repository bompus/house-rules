#!/usr/bin/env node
// Runs each scenario against any model CLI and grades the replies.
//   node evals/end-of-reply/run.mjs --rules <composed.md> --cmd "<command>" [--slice 80] [--coded] [--runs 1]
// <command> receives the prompt on stdin and must print only the reply, for
// example a CLI's non-interactive print mode with tools disabled.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { parseFragment } from "../../compose.mjs";
import { EXPECTS, grade } from "./grade.mjs";

const dir = join(dirname(fileURLToPath(import.meta.url)), "scenarios");
const usage =
  'usage: node run.mjs --rules <composed.md> --cmd "<command>" [--slice 80] [--coded] [--runs 1]';
const fail = (msg) => {
  console.error(`${msg}\n${usage}`);
  process.exit(2);
};
let values;
try {
  ({ values } = parseArgs({
    options: {
      rules: { type: "string" },
      cmd: { type: "string" },
      slice: { type: "string", default: "0" },
      runs: { type: "string", default: "1" },
      coded: { type: "boolean" },
    },
  }));
} catch (e) {
  fail(e.message);
}
const count = (name, min) => {
  const n = Number(values[name]);
  if (!Number.isInteger(n) || n < min) fail(`--${name} must be an integer of at least ${min}`);
  return n;
};
if (!values.rules || !values.cmd) fail("--rules and --cmd are required");
const slice = count("slice", 0);
const runs = count("runs", 1);
let rules = readFileSync(values.rules, "utf8");
if (slice) rules = rules.split("\n").slice(0, slice).join("\n");

// Read and check every scenario before spending a model call.
const scenarios = readdirSync(dir)
  .filter((f) => f.endsWith(".md"))
  .sort()
  .map((file) => {
    const { meta, body } = parseFragment(readFileSync(join(dir, file), "utf8"), file);
    if (!EXPECTS.includes(meta.expect))
      fail(`${file}: expect: must be one of ${EXPECTS.join(", ")}`);
    return { file, expect: meta.expect, body };
  });

let failed = 0;
for (const { file, expect, body } of scenarios) {
  const prompt = [
    "This is a writing exercise about an AI coding agent. Do not use any tools, do not read or write files, and do not run commands. Answer with text only.",
    "For this exercise, the RULES below are the agent's always-on user rules. They replace any other instructions you have about how replies end or how options are formatted.",
    "Read the RULES, the project AGENTS.md and the transcript, then write the agent's next reply exactly as the user would see it. Where the agent would make a tool call, write a line `TOOL_CALL: <tool> <what>` at that point. Output only that reply.",
    "",
    `## RULES${slice ? ` (first ${slice} lines, as the agent read them)` : ""}`,
    rules,
    "",
    body,
  ].join("\n");
  for (let i = 0; i < runs; i++) {
    const r = spawnSync(values.cmd, {
      shell: true,
      input: prompt,
      encoding: "utf8",
      maxBuffer: 1 << 24,
    });
    if (r.error || r.status !== 0) {
      failed++;
      console.log(
        `FAIL ${file} run ${i + 1}: command ${r.error ? `error ${r.error.message}` : `exited ${r.status ?? r.signal}`}`,
      );
      if (r.stderr)
        console.log(
          r.stderr
            .trim()
            .split("\n")
            .map((l) => `    ${l}`)
            .join("\n"),
        );
      continue;
    }
    const g = grade(r.stdout ?? "", expect, { coded: values.coded });
    if (!g.pass) failed++;
    console.log(`${g.pass ? "PASS" : "FAIL"} ${file} run ${i + 1}: ${JSON.stringify(g)}`);
    if (!g.pass)
      console.log(
        (r.stdout ?? "")
          .trim()
          .split("\n")
          .map((l) => `    ${l}`)
          .join("\n"),
      );
  }
}
process.exit(failed ? 1 : 0);
