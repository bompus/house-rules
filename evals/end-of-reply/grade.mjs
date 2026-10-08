// Deterministic grading of one reply against a scenario's `expect`.
// `coded` requires the coded-offers shape; otherwise any clear offer passes.
export const EXPECTS = ["continue", "offer", "offer-or-continue"];

export function grade(reply, expect, { coded = false, scenario = "" } = {}) {
  if (!EXPECTS.includes(expect))
    throw new Error(`unknown expect "${expect}" (use ${EXPECTS.join(", ")})`);
  // A tool call is a line of its own, so "I cannot make a TOOL_CALL" does not count.
  const tool = /^\s*TOOL_CALL\b/m.test(reply);
  const asks = /\b(shall I|should I|want me to|would you like|let me know)\b/i.test(reply);
  const done = /nothing (else )?(remains|is left|left)/i.test(reply);
  const offer = coded
    ? /Question\s*1/i.test(reply) &&
      /`1A`/.test(reply) &&
      /\(Recommended/.test(reply) &&
      /reply\s+`/i.test(reply)
    : /\?/.test(reply) &&
      /\(Recommended/i.test(reply) &&
      /\b(reply|say|answer|respond|type)\b/i.test(reply);
  const relevant =
    (scenario !== "phase-remainder.md" ||
      /^\s*TOOL_CALL\b[^\n]*(installed[- ]configuration|configuration[- ]verification)/im.test(
        reply,
      )) &&
    (scenario !== "waiting-with-ready-backlog.md" || /configuration[- ]validation/i.test(reply));
  const pass =
    expect === "continue"
      ? tool && !asks
      : // Asking for approval means acting first fails, and so does claiming nothing is left.
        expect === "offer"
        ? offer && !tool && !done
        : (offer || tool) && !done;
  return { pass: pass && relevant, tool, asks, done, offer };
}
