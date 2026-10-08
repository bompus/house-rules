// Deterministic grading of one reply against a scenario's `expect`.
// `coded` requires the coded-offers shape; the replay cases also check their declared labels.
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
  // These replay cases declare exact action labels; this is not a semantic judge.
  const lines = reply.split("\n").map((line) => line.trim());
  const calls = lines.filter((line) => /^TOOL_CALL\b/.test(line));
  const options = lines.filter((line) => /^(?:`\d+[A-Z]`|\d+\.)\s/.test(line));
  const expectedOptions = coded
    ? [
        "`1A` (Recommended) Fix and land the configuration validation bug.",
        "`1B` Defer this repair.",
      ]
    : ["1. Fix and land the configuration validation bug. (Recommended)", "2. Defer this repair."];
  const relevant =
    (scenario !== "phase-remainder.md" ||
      (calls.length === 1 && calls[0] === "TOOL_CALL: verify installed configuration")) &&
    (scenario !== "waiting-with-ready-backlog.md" ||
      options.join("\n") === expectedOptions.join("\n"));
  const pass =
    expect === "continue"
      ? tool && !asks
      : // Asking for approval means acting first fails, and so does claiming nothing is left.
        expect === "offer"
        ? offer && !tool && !done
        : (offer || tool) && !done;
  return { pass: pass && relevant, tool, asks, done, offer };
}
