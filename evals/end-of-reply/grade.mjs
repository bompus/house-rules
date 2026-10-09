// Deterministic grading of one reply against a scenario's `expect`.
// `coded` requires the coded-offers shape; the replay cases also check their declared labels.
import { replyFacts } from "../../scripts/continuity-boundary.mjs";
export const EXPECTS = ["continue", "offer", "offer-or-continue", "blocked", "complete", "paused"];

export function grade(
  reply,
  expect,
  { coded = false, scenario = "", requiredCall = "", requiredText = "" } = {},
) {
  if (!EXPECTS.includes(expect))
    throw new Error(`unknown expect "${expect}" (use ${EXPECTS.join(", ")})`);
  // A tool call is a line of its own, so "I cannot make a TOOL_CALL" does not count.
  const { tool, asks, done, offer } = replyFacts(reply, coded);
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
    (!requiredCall || (calls.length === 1 && calls[0] === requiredCall)) &&
    (!requiredText || reply.includes(requiredText)) &&
    (scenario !== "exact-source-changed.md" ||
      (!!requiredText && options.some((line) => line.includes(requiredText)))) &&
    (scenario !== "phase-remainder.md" ||
      (calls.length === 1 && calls[0] === "TOOL_CALL: verify installed configuration")) &&
    (scenario !== "waiting-with-ready-backlog.md" ||
      options.join("\n") === expectedOptions.join("\n"));
  const pass =
    expect === "continue"
      ? tool && !asks && !done
      : // Asking for approval means acting first fails, and so does claiming nothing is left.
        expect === "offer"
        ? offer && !tool && !done
        : expect === "blocked" || expect === "paused"
          ? !offer &&
            !tool &&
            !asks &&
            !done &&
            /blocked|waiting|pending|paused|deferred/i.test(reply)
          : expect === "complete"
            ? done && !offer && !tool && !asks
            : (offer || tool) && !done;
  return { pass: pass && relevant, tool, asks, done, offer };
}
