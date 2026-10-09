// Checks an explicit handback record. It does not establish permission or inspect a backlog.
export const DISPOSITIONS = ["continue", "offer", "blocked", "complete", "paused"];

export function replyFacts(reply, coded = false) {
  return {
    tool: /^\s*TOOL_CALL\b/m.test(reply),
    asks: /\b(shall I|should I|can I|may I|could I|want me to|would you like|let me know)\b/i.test(
      reply,
    ),
    done: /nothing (else )?(remains|is left|left)(?![\s\S]*\b(?:remains|is left|left)\b)|\bnothing (?:else )?(?:needs|requires|is waiting on|waits on) (?:you|your)\b(?![^.!?\n]*\b(?:except|besides|beyond|other than|apart from)\b)|(?<!(?:\bnot|\bnever|n't)\b[^.!?\n]{0,40}\b(?:say|claim|assert|state)\w*\b[^.!?\n]{0,40})(?<!["'“‘])(?:this session is complete|session can be closed)/i.test(
      reply,
    ),
    offer: coded
      ? [...reply.matchAll(/Question\s*(\d+)/gi)].some(([, n]) => reply.includes(`\`${n}A\``)) &&
        /\(Recommended/.test(reply) &&
        /reply\s+`/i.test(reply)
      : /\?/.test(reply) &&
        /\(Recommended/i.test(reply) &&
        /\b(reply|say|answer|respond|type)\b/i.test(reply),
  };
}

export function checkBoundary(reply, state) {
  const issues = [];
  if (
    !state ||
    typeof state !== "object" ||
    Array.isArray(state) ||
    state.version !== 1 ||
    !DISPOSITIONS.includes(state.disposition)
  ) {
    return { pass: false, issues: ["Missing or invalid turn disposition."] };
  }
  const fields = ["goal", "result", "remaining"];
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
  if (facts.tool) issues.push("A final handback cannot declare a tool call.");
  if (state.disposition === "continue") {
    issues.push(
      "Authorized ready work remains. Reconcile the record and continue only within existing authorization.",
    );
  } else if (state.disposition === "offer") {
    if (!facts.offer || facts.done) issues.push("Present the ready decision as a coded offer.");
  } else {
    if (facts.asks) issues.push("Remove the unnecessary approval question.");
    if (facts.offer)
      issues.push("This disposition has no ready decision; remove the unnecessary offer.");
    if (state.disposition === "complete") {
      if (!facts.done) issues.push("State that nothing remains.");
    } else {
      if (facts.done) issues.push("Blocked or paused work is not complete.");
      if (!reply.includes(state.remaining)) issues.push("State the blocker or resumption trigger.");
    }
  }
  if (state.phaseBoundary) {
    for (const key of fields) {
      if (!reply.includes(state[key]))
        issues.push("Include the recorded " + key + " at this phase boundary.");
    }
  }
  return { pass: issues.length === 0, issues };
}
