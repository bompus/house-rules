#!/usr/bin/env node
// Runs each scenario against any model CLI and grades the replies.
//   node evals/end-of-reply/run.mjs --rules <composed.md> --cmd "<command>" [--slice 80] [--coded] [--runs 1] [--baseline]
// <command> receives the prompt on stdin and must print only the reply, for
// example a CLI's non-interactive print mode with tools disabled.
// --baseline also runs every scenario with only CONTROL as the rules and with
// no rules, so a result shows what the rules add over asking in one sentence.
// --allow-read (or a scenario's `allowRead: true`) grades the reply after any leading read-only
// tool calls, for agents that look before they answer.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { parseFragment } from "../../compose.mjs";
import { EXPECTS, grade } from "./grade.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const usage =
  'usage: node run.mjs --rules <composed.md> --cmd "<command>" [--slice 80] [--coded] [--runs 1] [--baseline] [--scenarios <dir>] [--screen] [--allow-read]';
// One sentence asking for the same behavior: the control the rules must beat.
const CONTROL =
  "When work you are allowed to do remains, keep doing it. When the user must decide something, end by asking them, with your recommendation and what to reply.";
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
      baseline: { type: "boolean" },
      scenarios: { type: "string" },
      screen: { type: "boolean" },
      "allow-read": { type: "boolean" },
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
const dir = values.scenarios ? resolve(values.scenarios) : join(here, "scenarios");
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
    for (const key of [
      "requiredPattern",
      "forbiddenPattern",
      "forbiddenInOffer",
      "forbiddenCall",
    ]) {
      try {
        new RegExp(meta[key] ?? "", "i");
      } catch (e) {
        fail(`${file}: ${key}: ${e.message}`);
      }
    }
    if (!["true", "false", undefined].includes(meta.allowRead))
      fail(`${file}: allowRead: must be true or false`);
    if (!["true", "false", undefined].includes(meta.closeOut))
      fail(`${file}: closeOut: must be true or false`);
    if (values.screen) removeRule(file, meta.without);
    return {
      file,
      expect: meta.expect,
      body,
      allowRead: values["allow-read"] || meta.allowRead === "true",
      closeOut: meta.closeOut === "true",
      requiredCall: meta.requiredCall,
      requiredText: meta.requiredText,
      requiredPattern: meta.requiredPattern,
      forbiddenPattern: meta.forbiddenPattern,
      options: meta.options,
      minOptions: meta.minOptions,
      forbiddenInOffer: meta.forbiddenInOffer,
      forbiddenCall: meta.forbiddenCall,
      without: meta.without,
    };
  });

// Control arms are graded without --coded: one sentence does not ask for codes.
const arms = [{ name: "rules", text: rules, coded: values.coded, sliced: slice }];
if (values.baseline)
  arms.push(
    { name: "one-line", text: CONTROL, coded: false, sliced: 0 },
    { name: "no-rules", text: "(none)", coded: false, sliced: 0 },
  );
if (values.screen) arms.push({ name: "without", text: "", coded: values.coded, sliced: slice });
const passes = new Map(arms.map((a) => [a.name, new Map()]));
const behaviors = new Map(arms.map((a) => [a.name, 0]));
const indent = (text) =>
  text
    .trim()
    .split("\n")
    .map((l) => `    ${l}`)
    .join("\n");

// A screening arm is the rules with the one rule a scenario names taken out.
function removeRule(file, pattern) {
  if (!pattern) fail(`${file}: --screen needs a without: pattern naming the rule to remove`);
  const found = [...rules.matchAll(new RegExp(pattern, "gis"))];
  if (found.length !== 1)
    fail(`${file}: without: must match the rules exactly once, matched ${found.length}`);
  return rules.replace(found[0][0], "");
}

let failed = 0;
for (const {
  file,
  expect,
  body,
  requiredCall,
  requiredText,
  requiredPattern,
  forbiddenPattern,
  options,
  minOptions,
  forbiddenInOffer,
  forbiddenCall,
  allowRead,
  closeOut,
  without,
} of scenarios) {
  if (values.screen) arms.find((a) => a.name === "without").text = removeRule(file, without);
  for (const arm of arms) {
    const label = values.baseline ? `[${arm.name}] ${file}` : file;
    const prompt = [
      "This is a writing exercise about an AI coding agent. Do not use any tools, do not read or write files, and do not run commands. Answer with text only.",
      "For this exercise, the RULES below are the agent's always-on user rules. They replace any other instructions you have about how replies end or how options are formatted.",
      "Read the RULES, the project AGENTS.md and the transcript, then write the agent's next reply exactly as the user would see it. Where the agent would make a tool call, write a line `TOOL_CALL: <tool> <what>` at that point. Output only that reply.",
      "",
      `## RULES${arm.sliced ? ` (first ${arm.sliced} lines, as the agent read them)` : ""}`,
      arm.text,
      "",
      body,
    ].join("\n");
    let passed = 0;
    for (let i = 0; i < runs; i++) {
      const r = spawnSync(values.cmd, {
        shell: true,
        input: prompt,
        encoding: "utf8",
        maxBuffer: 1 << 24,
      });
      // A failed command counts against its arm, like a failing reply.
      if (r.error || r.status !== 0) {
        if (arm.name === "rules") failed++;
        console.log(
          `FAIL ${label} run ${i + 1}: command ${r.error ? `error ${r.error.message}` : `exited ${r.status ?? r.signal}`}`,
        );
        if (r.stderr) console.log(indent(r.stderr));
        continue;
      }
      const g = grade(r.stdout ?? "", expect, {
        coded: arm.coded,
        requiredCall,
        requiredText,
        requiredPattern,
        forbiddenPattern,
        options,
        minOptions,
        forbiddenInOffer,
        forbiddenCall,
        allowRead,
        closeOut,
      });
      if (g.behavior) behaviors.set(arm.name, behaviors.get(arm.name) + 1);
      if (g.pass) passed++;
      else if (arm.name === "rules") failed++;
      console.log(`${g.pass ? "PASS" : "FAIL"} ${label} run ${i + 1}: ${JSON.stringify(g)}`);
      if (!g.pass && arm.name === "rules") console.log(indent(r.stdout ?? ""));
    }
    passes.get(arm.name).set(file, passed);
  }
}
if (values.screen) {
  console.log("screen (passes of " + runs + " runs per arm):");
  for (const { file } of scenarios) {
    const full = passes.get("rules").get(file);
    const minus = passes.get("without").get(file);
    const verdict =
      full === minus
        ? full === runs
          ? "no difference: candidate for removal"
          : "no difference, and the scenario fails with the rule: fix the scenario"
        : full > minus
          ? "rule helps"
          : "rule hurts";
    console.log(`  ${file}: with ${full}, without ${minus} -> ${verdict}`);
  }
}
if (values.baseline) {
  const total = scenarios.length * runs;
  const sum = (name) => [...passes.get(name).values()].reduce((a, b) => a + b, 0);
  console.log(arms.map((a) => `${a.name} ${sum(a.name)}/${total}`).join(", "));
  // Whether the reply took the right turn, apart from the scenario's declared labels, calls and patterns.
  console.log(
    `behavior only: ${arms.map((a) => `${a.name} ${behaviors.get(a.name)}/${total}`).join(", ")}`,
  );
  for (const { file } of scenarios)
    if (arms.every((a) => passes.get(a.name).get(file) === runs))
      console.log(
        `WARN ${file} passes every run in every arm, so it cannot show what the rules add`,
      );
}
// Only the rules arm decides the exit status; the control arms are expected to fail.
process.exit(failed ? 1 : 0);
