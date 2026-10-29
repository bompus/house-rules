#!/usr/bin/env bun
// Claude Code Stop hook: holds back a final reply that stops with work still open. It blocks once when the plan
// the session used has open `[ ]` ledger items, none of those items carries a wait, and the reply has no coded
// offer, no stated blocker or trigger and no handback claim. It needs no per-turn record: it reads the hook
// input on stdin, the session transcript the input names, and the plan file the session itself used, found the
// way stop-claim-check.mjs finds it.
//
// A wait on an open item is a `trigger:` or `recheck:` field, `blocked-by:`, `owner:`, or the words "waiting
// on/for", "waits on", "awaiting" or "blocked on/by" in the item. Deferred `[~]` items do not count: they were
// parked on purpose and carry their own trigger. A plan whose `Status:` is not `active` (paused,
// blocked-on-user, completed) is skipped, because the user or the record already stopped it.
//
// The reply passes when it holds any of: a coded offer (`Question 1` with options such as `1a`, a
// "(Recommended" and a "reply `" line, read as written); a stated blocker or trigger ("blocked on", "Blocker:", "trigger",
// "reopens when", "recheck", "cannot proceed", "needs your"); or a handback claim (nothing left, session
// complete, "handed back"). A bare "waiting" or a status line is none of these. Text the reply only quotes
// (code spans, fenced blocks, double-quoted spans) is ignored first, so a reply that merely mentions a phrase
// does not satisfy or trip the check. stop-claim-check.mjs separately holds back a false completion claim.
//
// A block is sent once: the hook input's `stop_hook_active` is true on the continuation, which always passes,
// so a stuck check cannot loop. Any read or parse failure also passes and says so on stderr. A session that
// never touched a plan file has nothing to check, and its reply passes.
//
// Register it in Claude Code settings (adjust the path to this checkout):
//   { "hooks": { "Stop": [ { "hooks": [ { "type": "command", "command": "bun <checkout>/scripts/stop-ready-work-check.mjs" } ] } ] } }
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parsePlan, RECHECK } from "../skills/hr-what-next/scripts/plan-ledger.mjs";
import { replyFacts } from "./continuity-boundary.mjs";
import { entries, finalReply, planPaths, unquoted } from "./stop-claim-check.mjs";

const WAIT =
  /\b(?:trigger|blocked-by|owner):|\b(?:waiting (?:on|for)|waits? on|awaiting|blocked (?:on|by))\b/i;
const BLOCKER =
  /\b(?:blocked (?:on|by)|blockers?\s*:|triggers?\b|reopens? (?:when|on|if)|re-?check|(?:cannot|can't|can not) (?:proceed|continue)|needs? (?:your|the user)|only (?:the user|you) can)\b/i;
const HANDBACK = /\bhand(?:ed|ing)? (?:this |it |the work )?(?:back|off|over)\b|\bhandback\b/i;

/**
 * An open `[ ]` item carries a wait when it names a trigger, a re-check date, another owner or something it
 * waits on.
 * @param {string} text
 */
const waits = (text) => WAIT.test(text) || RECHECK.test(text);

/**
 * @param {{ reply: string, planPath: string | undefined, planText: string | undefined }} state
 * @returns {{ block: boolean, reason?: string, note?: string }}
 */
export function decide({ reply, planPath, planText }) {
  if (planPath === undefined || planText === undefined) {
    return { block: false };
  }
  if (reply.trim() === "") {
    return { block: false };
  }
  const plan = parsePlan(planText);
  if (plan.errors.length) {
    return { block: false, note: `${planPath} does not parse: ${plan.errors[0]}` };
  }
  if ((plan.status ?? "").trim().toLowerCase() !== "active") {
    return { block: false };
  }
  const open = plan.items.filter((item) => item.mark === " ");
  if (open.length === 0 || open.some((item) => waits(item.text))) {
    return { block: false };
  }
  // The offer test reads the reply as written: an offer's codes are inline code spans.
  const said = unquoted(reply);
  if (
    replyFacts(reply, true).offer ||
    replyFacts(said).done ||
    BLOCKER.test(said) ||
    HANDBACK.test(said)
  ) {
    return { block: false };
  }
  const first = open
    .slice(0, 3)
    .map((item) => `L${item.line} ${item.text.replace(/\s+/g, " ").slice(0, 80)}`)
    .join("; ");
  return {
    block: true,
    reason:
      `Your reply stops, but the plan ${planPath} still has ${open.length} open item(s) and none of them ` +
      `waits on anyone or anything (${first}). If authorized work remains, do the next step now in this reply. ` +
      "Otherwise end with a coded offer for the decision you need, or name the blocker or trigger that stops " +
      'the work. A bare status or "waiting" line is not one of these.',
  };
}

/**
 * @param {{ stop_hook_active?: boolean, transcript_path?: string, last_assistant_message?: string, cwd?: string }} input
 * @param {{ read: (path: string) => string | undefined }} files
 */
export function evaluate(input, files) {
  if (input.stop_hook_active) {
    return { block: false };
  }
  const transcript = input.transcript_path ? files.read(input.transcript_path) : undefined;
  const list = transcript === undefined ? [] : entries(transcript);
  const reply =
    typeof input.last_assistant_message === "string" && input.last_assistant_message.trim()
      ? input.last_assistant_message
      : finalReply(list);
  for (const planPath of planPaths(list, input.cwd ?? process.cwd()).toReversed()) {
    const planText = files.read(planPath);
    if (planText !== undefined) {
      return decide({ reply, planPath, planText });
    }
  }
  return { block: false };
}

if (
  process.argv[1] &&
  existsSync(process.argv[1]) &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  try {
    const input = JSON.parse(readFileSync(0, "utf8"));
    const result = evaluate(input, {
      read: (path) => (existsSync(path) ? readFileSync(path, "utf8") : undefined),
    });
    if (result.block) {
      process.stdout.write(JSON.stringify({ decision: "block", reason: result.reason }) + "\n");
    } else if (result.note) {
      process.stderr.write(`stop-ready-work-check: passed without checking (${result.note})\n`);
    }
  } catch (error) {
    process.stderr.write(
      `stop-ready-work-check: passed without checking (${error instanceof Error ? error.message : String(error)})\n`,
    );
  }
}
