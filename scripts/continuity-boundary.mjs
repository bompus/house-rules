// Validates current coverage and producer attestations, not semantic readiness or permission.
import { isDeepStrictEqual } from "node:util";
import { uppercaseCodes } from "../evals/end-of-reply/offer.mjs";
import { planSnapshot } from "../skills/hr-what-next/scripts/plan-ledger.mjs";
export const DISPOSITIONS = ["continue", "offer", "blocked", "complete", "paused"];

// The shapes below are what a valid adapter input looks like. The checks still test every field, because
// the input is JSON from another process.
/**
 * @typedef {object} BoundaryContext
 * @property {string} [stopReason]
 * @property {string} [sessionId]
 * @property {string} [turnId]
 * @property {string} [planText]
 * @property {string} [today]
 */
/**
 * @typedef {object} ClassifiedItem
 * @property {string} id
 * @property {string} kind
 * @property {string} next
 * @property {string} [reference]
 * @property {string} [owner]
 * @property {string} [trigger]
 * @property {string} [recheck]
 */
/**
 * @typedef {object} TurnState
 * @property {number} version
 * @property {string} disposition
 * @property {string} goal
 * @property {string} result
 * @property {string} remaining
 * @property {boolean} phaseBoundary
 * @property {Record<string, unknown> & { version?: number, openItems?: unknown, errors?: unknown, findings?: unknown, exit?: number }} [reconciliation]
 * @property {(ClassifiedItem | null)[]} items
 * @property {({ id: string, text: string } | null)[]} decisions
 */

/**
 * @param {string} reply
 * @param {boolean} [coded]
 */
export function replyFacts(reply, coded = false) {
  return {
    tool: /^\s*TOOL_CALL\b/m.test(reply),
    asks: /\b(shall I|should I|can I|may I|could I|want me to|would you like|let me know)\b/i.test(
      reply,
    ),
    done: /nothing (else )?(remains|is left|left)(?! for (?:a )?later| (?:over|locally|unpushed|uncommitted|unmerged)\b)(?![\s\S]*\b(?:remains|is left|left)\b)|\bnothing (?:else )?(?:needs|requires|is waiting on|waits on) (?:you|your)\b(?![^.!?\n]*\b(?:except|besides|beyond|other than|apart from)\b)|(?<!(?:\bnot|\bnever|n't)\b[^.!?\n]{0,40}\b(?:say|claim|assert|state)\w*\b[^.!?\n]{0,40})(?<!["'“‘])(?:this session is complete|session can be closed)/i.test(
      reply,
    ),
    // An offer is recognized in either letter case; uppercaseCodes() reports the casing separately.
    offer: coded
      ? [...reply.matchAll(/Question\s*(\d+)/gi)].some(([, n]) =>
          new RegExp(`\`${n}[a-z]\``, "i").test(reply),
        ) &&
        reply.includes("(Recommended") &&
        /reply\s+`/i.test(reply)
      : reply.includes("?") &&
        /\(Recommended/i.test(reply) &&
        /\b(reply|say|answer|respond|type)\b/i.test(reply),
  };
}

/**
 * @param {string} reply
 * @param {TurnState | null | undefined} state
 * @param {BoundaryContext | null} [context]
 */
export function checkBoundary(reply, state, context) {
  // Only the adapter supplies interruption signals. A producer disposition is not a stop signal.
  if (["stop", "hold", "pause", "low-quota"].includes(context?.stopReason ?? "")) {
    return { pass: true, issues: [] };
  }
  const issues = [];
  if (
    !state ||
    typeof state !== "object" ||
    Array.isArray(state) ||
    state.version !== 2 ||
    !DISPOSITIONS.includes(state.disposition)
  ) {
    return { pass: false, issues: ["Missing or invalid turn disposition."] };
  }
  issues.push(...reconciliationIssues(reply, state, context));
  const fields = /** @type {const} */ (["goal", "result", "remaining"]);
  if (
    fields.some(
      (key) => typeof state[key] !== "string" || !state[key].trim() || state[key].length > 1000,
    ) ||
    typeof state.phaseBoundary !== "boolean"
  ) {
    return { pass: false, issues: ["Goal, result, remaining and phaseBoundary must be recorded."] };
  }
  if (typeof reply !== "string" || !reply.trim()) {
    return { pass: false, issues: ["The handback is empty."] };
  }
  const facts = replyFacts(reply, true);
  if (facts.tool) {
    issues.push("A final handback cannot declare a tool call.");
  }
  if (state.disposition === "continue") {
    issues.push(
      "Authorized ready work remains. Reconcile the record and continue only within existing authorization.",
    );
  } else if (state.disposition === "offer") {
    if (!facts.offer || facts.done) {
      issues.push("Present the ready decision as a coded offer.");
    } else if (uppercaseCodes(reply).length > 0) {
      issues.push("Print the offer codes in lowercase.");
    }
  } else {
    if (facts.asks) {
      issues.push("Remove the unnecessary approval question.");
    }
    if (facts.offer) {
      issues.push("This disposition has no ready decision; remove the unnecessary offer.");
    }
    if (state.disposition === "complete") {
      if (!facts.done) {
        issues.push("State that nothing remains.");
      }
    } else {
      if (facts.done) {
        issues.push("Blocked or paused work is not complete.");
      }
      if (!reply.includes(state.remaining)) {
        issues.push("State the blocker or resumption trigger.");
      }
    }
  }
  if (state.phaseBoundary) {
    for (const key of fields) {
      if (!reply.includes(state[key])) {
        issues.push("Include the recorded " + key + " at this phase boundary.");
      }
    }
  }
  return { pass: issues.length === 0, issues };
}

/**
 * @param {unknown} value
 * @returns {value is string}
 */
const nonempty = (value) => typeof value === "string" && value.trim().length > 0;
/**
 * @param {unknown} value
 * @returns {value is string}
 */
const calendarDate = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value + "T00:00:00Z")) &&
  new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;

/**
 * @param {string} reply
 * @param {TurnState} state
 * @param {BoundaryContext | null | undefined} context
 */
function reconciliationIssues(reply, state, context) {
  if (
    !context ||
    !nonempty(context.sessionId) ||
    !nonempty(context.turnId) ||
    typeof context.planText !== "string"
  ) {
    return ["The adapter must supply current planText, sessionId and turnId."];
  }
  const today = context.today ?? new Date().toLocaleDateString("sv");
  if (!calendarDate(today)) {
    return ["The adapter date is invalid."];
  }
  const snapshot = planSnapshot(context.planText);
  const receipt = state.reconciliation;
  if (
    snapshot.errors.length ||
    receipt?.version !== 1 ||
    receipt.sessionId !== context.sessionId ||
    receipt.turnId !== context.turnId ||
    receipt.planSHA256 !== snapshot.planSHA256 ||
    ![0, 2].includes(receipt.exit ?? -1) ||
    !Array.isArray(receipt.errors) ||
    receipt.errors.length ||
    !Array.isArray(receipt.findings) ||
    receipt.findings.length ||
    !isDeepStrictEqual(receipt.openItems, snapshot.openItems) ||
    receipt.exit !== (snapshot.openItems.length ? 2 : 0)
  ) {
    return ["Missing, invalid or stale reconciliation; rerun the floor for this plan and turn."];
  }
  if (!Array.isArray(state.items) || !Array.isArray(state.decisions)) {
    return ["Record explicit item classifications and presented decisions."];
  }
  const issues = [];
  const current = new Map(snapshot.openItems.map((item) => [item.id, item]));
  const seen = new Set();
  const readyDecisions = new Set();
  for (const item of state.items) {
    if (!item || !current.has(item.id) || seen.has(item.id)) {
      issues.push("Unknown or duplicate classified item identity.");
      continue;
    }
    seen.add(item.id);
    if (!nonempty(item.next)) {
      issues.push("Each item needs its concrete next action or blocker.");
    }
    if (["authorized-ready-action", "unsent-result"].includes(item.kind)) {
      issues.push(
        "Authorized ready action or required result remains; continue within existing authority.",
      );
    } else if (item.kind === "ready-user-decision") {
      readyDecisions.add(item.id);
    } else if (["live-owner-wait", "external-trigger-wait"].includes(item.kind)) {
      if (
        !nonempty(item.reference) ||
        (item.kind === "live-owner-wait" && !nonempty(item.owner)) ||
        (item.kind === "external-trigger-wait" && !nonempty(item.trigger))
      ) {
        issues.push("A wait needs its live owner or unmet trigger and evidence reference.");
      }
      const planRecheck = current.get(item.id)?.recheck ?? null;
      if (
        !calendarDate(item.recheck) ||
        item.recheck <= today ||
        (planRecheck !== null && (!calendarDate(planRecheck) || planRecheck <= today))
      ) {
        issues.push("A wait is due for recheck; reconcile it before handing back.");
      }
    } else {
      issues.push("Unclassified open item.");
    }
  }
  if (seen.size !== current.size) {
    issues.push("Classify every current open item exactly once.");
  }
  const presented = new Set();
  for (const decision of state.decisions) {
    if (
      !decision ||
      !readyDecisions.has(decision.id) ||
      presented.has(decision.id) ||
      !nonempty(decision.text) ||
      decision.text !== state.items.find((item) => item?.id === decision.id)?.next ||
      typeof reply !== "string" ||
      !reply
        .split(/\r?\n/)
        .some((line) => /^\s*(?:[-*]\s+)?`\d+[a-z]`/.test(line) && line.includes(decision.text))
    ) {
      issues.push("Each ready decision needs its concrete text on a presented offer option.");
    } else {
      presented.add(decision.id);
    }
  }
  if (presented.size !== readyDecisions.size) {
    issues.push("Present every ready user decision.");
  }
  if (readyDecisions.size && state.disposition !== "offer") {
    issues.push("Ready user decisions require an offer disposition.");
  }
  if (!readyDecisions.size && state.disposition === "offer") {
    issues.push("An offer requires a ready user decision.");
  }
  if (current.size && state.disposition === "complete") {
    issues.push("Open items remain; completion is not established.");
  }
  if (state.disposition === "paused") {
    issues.push("The adapter must confirm a stop, hold, pause or low-quota signal.");
  }
  return issues;
}
