// Deterministic grading of one reply against a scenario's `expect`.
import { replyFacts } from "../../scripts/continuity-boundary.mjs";
import { optionsMatch, parseOffer } from "./offer.mjs";
export const EXPECTS = ["continue", "offer", "offer-or-continue", "blocked", "complete", "paused"];

// `coded` requires the coded-offers shape. A scenario may declare `options` (`a | b`, labels each
// option starts with), `minOptions`, `forbiddenInOffer` (a pattern the offer's questions and options
// must not match) and `forbiddenCall` (a pattern for the command an offer must not run; it is
// tested on each shell segment of a call, anchored to the segment's start). Without `forbiddenCall`,
// any command except keeping the ledger, plan or notes (a record word within the first words after
// the verb) counts as acting.
const RECORDING =
  /^(?:write|edit|append|update|record)\s+(?:(?:the|a|session|session's|project's)\s+){0,2}\S*(?:ledger|plans?|notes?|handoff|task list)/i;
const SHELL = "bash|sh|shell|run|exec|command|terminal";

export function grade(
  reply,
  expect,
  {
    coded = false,
    requiredCall = "",
    requiredText = "",
    requiredPattern = "",
    forbiddenPattern = "",
    options: expectedOptions = "",
    minOptions = "",
    forbiddenInOffer = "",
    forbiddenCall = "",
  } = {},
) {
  if (!EXPECTS.includes(expect))
    throw new Error(`unknown expect "${expect}" (use ${EXPECTS.join(", ")})`);
  // A tool call is a line of its own, so "I cannot make a TOOL_CALL" does not count.
  const facts = replyFacts(reply, coded);
  const { tool, asks, done } = facts;
  const lines = reply.split("\n").map((line) => line.trim());
  const calls = lines.filter((line) => /^TOOL_CALL\b/.test(line));
  // A recommendation without a list of options is not an offer.
  const parsed = parseOffer(reply);
  const offer = facts.offer && parsed.options.length > 0;
  const forbidden = forbiddenCall && new RegExp(forbiddenCall, "i");
  // A ledger write is prose, so only `&&`, `||` and a `;` before a shell command split it.
  const segments = (call) => {
    const text = call.replace(/^TOOL_CALL:?\s*/i, "");
    const split = RECORDING.test(text)
      ? new RegExp(`&&|\\|\\||;(?=\\s*(?:${SHELL})\\b)`, "i")
      : /&&|\|\||[;|]/;
    return text.split(split).map((part) => part.trim());
  };
  const acted = calls.some((call) =>
    segments(call).some((part) => (forbidden ? forbidden.test(part) : !RECORDING.test(part))),
  );
  // The scenario's own declared checks, apart from whether the reply took the right turn.
  const declared =
    (!requiredCall || (calls.length === 1 && calls[0] === requiredCall)) &&
    (!requiredText || reply.includes(requiredText)) &&
    (!requiredPattern || new RegExp(requiredPattern, "i").test(reply)) &&
    (!forbiddenPattern || !new RegExp(forbiddenPattern, "i").test(reply)) &&
    (!expectedOptions ||
      optionsMatch(
        parsed.options,
        expectedOptions.split("|").map((label) => label.trim()),
      )) &&
    (!minOptions || parsed.options.length >= Number(minOptions)) &&
    (!forbiddenInOffer ||
      !new RegExp(forbiddenInOffer, "i").test([...parsed.questions, ...parsed.options].join("\n")));
  const behavior =
    expect === "continue"
      ? tool && !asks && !done
      : // Asking for approval means acting first fails, and so does claiming nothing is left.
        expect === "offer"
        ? offer && !acted && !done
        : expect === "blocked" || expect === "paused"
          ? !offer &&
            !tool &&
            !asks &&
            !done &&
            /blocked|waiting|pending|paused|deferred/i.test(reply)
          : expect === "complete"
            ? done && !offer && !tool && !asks
            : (offer || tool) && !done;
  return { pass: behavior && declared, behavior, declared, tool, asks, done, offer };
}
