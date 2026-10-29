#!/usr/bin/env bun
// Claude Code Stop hook: holds back a final reply that stops with work still open. It blocks once when the plan
// the session used has open `[ ]` ledger items, none of those items carries a wait, and the reply has no coded
// offer, no stated blocker or trigger and no handback claim. It needs no per-turn record: it reads the hook
// input on stdin, the session transcript the input names, and the plan file the session itself used, found the
// way stop-claim-check.mjs finds it.
//
// A wait on an open item is a `trigger:` or `recheck:` field, `blocked-by:`, `owner:`, or the words "waiting
// on/for", "waits on", "awaiting" or "blocked on/by" in the item. A `recheck:` date counts while it is still ahead,
// and `owner:` only when it names someone other than the plan's own owner. Deferred `[~]` items do not count: they were
// parked on purpose and carry their own trigger. A plan whose `Status:` is not `active` (paused,
// blocked-on-user, completed) is skipped, because the user or the record already stopped it.
//
// The reply passes when it holds any of: a coded offer (`Question 1` with options such as `1a`, a
// "(Recommended" and a "reply `" line, outside any quoted example); a stated blocker or trigger ("blocked on",
// "Blocker:", "Trigger:", "reopens when", "recheck on <date>", "cannot proceed", "needs your", "awaiting your");
// or a handback claim (nothing left, session
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
import { entries, finalReply, planPaths, unquoted, unquotedProse } from "./stop-claim-check.mjs";

const WAIT =
  /\b(?:trigger|blocked-by):|\b(?:waiting (?:on|for)|waits? on|awaiting|blocked (?:on|by))\b/i;
const BLOCKER = new RegExp(
  [
    String.raw`\b(?:blocked (?:on|by)|(?:cannot|can't|can not) (?:proceed|continue)|reopens? (?:when|on|if)|needs? (?:your|the user)|only (?:the user|you) can)\b`,
    String.raw`(?<!\bno )\b(?:blockers?|triggers?|re-?checks?)\s*:(?!\s*(?:none|n/a|no)\b)`,
    String.raw`\bre-?checks? (?:on|at|after)\b`,
    String.raw`\b(?:awaiting|waiting (?:on|for)) (?:your|you)\b`,
  ].join("|"),
  "i",
);
const localDate = () => new Date().toLocaleDateString("en-CA");
const HANDBACK = /\bhand(?:ed|ing)? (?:this |it |the work )?(?:back|off|over)\b|\bhandback\b/i;

/**
 * An open `[ ]` item carries a wait when it names a trigger, a `recheck:` date that is still ahead, an owner other
 * than the plan's own, or something it waits on. A due re-check date is work to do, not a wait.
 * @param {string} text
 * @param {string | undefined} planOwner
 * @param {string} today
 */
function waits(text, planOwner, today) {
  if (WAIT.test(text)) {
    return true;
  }
  const recheck = text.match(RECHECK)?.[1];
  if (recheck !== undefined && recheck > today) {
    return true;
  }
  const owner = text
    .match(/\bowner:\s*([^;.,)]+)/i)?.[1]
    ?.trim()
    .toLowerCase();
  // "SageGlen (Orchestrator thread mcp:…)" names one identity, SageGlen; split on the separators around it.
  const own = (planOwner ?? "").toLowerCase();
  const identities = [own, ...own.split(/[,;()]/)].map((part) => part.trim());
  return owner !== undefined && owner !== "" && !identities.includes(owner);
}

/**
 * @param {{ reply: string, planPath: string | undefined, planText: string | undefined, today?: string }} state
 * @returns {{ block: boolean, reason?: string, note?: string }}
 */
export function decide({ reply, planPath, planText, today = localDate() }) {
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
  if (open.length === 0 || open.some((item) => waits(item.text, plan.owner, today))) {
    return { block: false };
  }
  // The offer test keeps inline code spans (an offer prints its codes in them) and drops fenced and double-quoted examples.
  const said = unquoted(reply);
  if (
    replyFacts(unquotedProse(reply), true).offer ||
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
  // A message the hook input carries is the reply, even when empty: an empty one passes.
  const reply =
    typeof input.last_assistant_message === "string"
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
