// Deterministic grading of one reply against a scenario's `expect`.
import { replyFacts } from "../../scripts/continuity-boundary.mjs";
import { closeOutOffer, layoutProblems, optionsMatch, parseOffer } from "./offer.mjs";
export const EXPECTS = [
  "continue",
  "offer",
  "offer-or-continue",
  "blocked",
  "complete",
  "paused",
  "reply",
];

// `coded` requires the coded-offers shape. A scenario may declare `options` (`a | b`, labels each
// option starts with), `minOptions` and `forbiddenInOffer` (a pattern the offer's questions and
// options must not match) and `forbiddenCall` (a pattern for the command an offer must not run; it is
// tested on each shell segment of a call, anchored to the segment's start). Without `forbiddenCall`,
// any command except reading, or keeping the ledger, plan or notes (a record word within the first
// words after the verb), counts as acting.
const RECORDING =
  /^(?:(?:ledger|plans?|notes?|handoff)\b|(?:write|edit|append|update|record)_(?:ledger|plans?|notes?|handoff)\b|(?:write|edit|append|update|record)\s+(?:(?:the|a|durable|session|session's|project's)\s+){0,2}\S*(?:ledger|plans?|notes?|handoff|task list)|record\b[^;&|]*\b(?:in|to|into|on)\s+(?:(?:the|a|durable|session)\s+){0,2}(?:ledger|plans?|notes?|handoff|task list))/i;
// Deleting records is acting, but a read command may name a file or pattern containing the word;
// redirecting output or substituting a command is acting however it starts.
const DELETING = /\b(?:delete|wipe|purge|truncate|clear|rm)\b/i;
const REDIRECTING = /(?<![-=])>|\$\(/;
const WRAPPER = "(?:(?:bash|sh|shell|run|exec(?:_command)?|command|terminal)\\s+)*\\W*";
const READING = new RegExp(
  `^${WRAPPER}(?:read|cat|ls|grep|rg|find|head|tail|stat|wc|date|df|du|pwd|git\\s+(?:status|log|diff|show|fetch|worktree\\s+list|rev-parse)|git\\s+branch(?=\\s*$|\\s+(?:-[avr]+|--(?:list|show-current|contains|merged|no-merged|all|remotes|verbose|sort))\\b)|git\\s+remote(?=\\s*$|\\s+(?:-v|--verbose|show|get-url)\\b)|gh\\s+(?:pr|issue)\\s+(?:view|list|checks))\\b`,
  "i",
);
// A ledger write is prose, so a `;` or `|` splits it only before something that starts a command
// or another action. `then` splits a call only before such an action.
const COMMAND =
  "bash|sh|shell|run|exec|command|terminal|sudo|rm|mv|cp|git|gh|npm|pnpm|yarn|bun|node|python3?|curl|crontab|kill|chmod|chown|make|docker|systemctl";
const ACTION = `edit|write|create|modify|delete|remove|commit|push|merge|apply|install|deploy|release|${COMMAND}`;
const THEN = `\\bthen\\s+(?=(?:${ACTION})\\b)`;

// A call that only looks: a read command, or a tool word (`read_file`, `functions.exec`,
// `skill`, `grep`) that names a lookup, however the agent's harness spells it.
const LOOKUP = new RegExp(
  `^${WRAPPER}(?:(?:functions|collaboration)\\.(?:\\w+\\s+)?)?(?:read(?:_\\w+)?|view(?:_\\w+)?|list(?:_\\w+)?|glob|skill|search|grep(?:_\\w+)?|look\\s+up|inspect|cat|ls|rg|find|head|tail|stat|wc|date|df|du|pwd|git\\s+branch(?=\\s*$|\\s+(?:-[avr]+|--(?:list|show-current|contains|merged|no-merged|all|remotes|verbose|sort))\\b)|git\\s+remote(?=\\s*$|\\s+(?:-v|--verbose)\\s*$|\\s+(?:show|get-url)\\b)|git\\s+(?:status|log|diff|show|fetch|worktree\\s+list|rev-parse)|gh\\s+(?:pr|issue)\\s+(?:view|list|checks))\\b`,
  "i",
);

// A call that starts with a lookup but also says it writes, sends or runs something is not
// dropped as a read. The leading wrapper (`shell run ...`) and file-path words (`save-lessons.md`)
// are not actions.
const WRAPPER_LEAD = new RegExp(`^${WRAPPER}`, "i");
// Backticks run even inside double quotes, so their contents are checked on their own.
/** @param {string} text */
const withoutPaths = (text) =>
  text
    .split(/\s+/)
    .filter((word) => !/[/\\]|\.\w{1,5}$/.test(word))
    .join(" ");
/** @param {string} call */
const actsAlso = (call) => {
  const body = call.replace(/^TOOL_CALL:?\s*/i, "").replace(WRAPPER_LEAD, "");
  const unquoted = body.replace(/"[^"]*"|(?<!\w)'[^']*'(?!\w)/g, "");
  return [unquoted, ...(body.match(/`[^`]*`/g) ?? [])].some((text) =>
    ALSO_ACTS.test(withoutPaths(text)),
  );
};
const ALSO_ACTS =
  /\b(?:send|write|edit|create|record|update|append|save|commit|push|delete|remove|install|notify|relay|merge|publish|post|comment|replace|fix|run|deploy|release|apply|reset|checkout|open|rm|mv|sed|pull request)\b/i;

// With `allowRead`, a reply may open with read-only tool calls (the agent looks before it
// answers). The reply is then the text after the last call in that leading run, which ends at
// the first call that acts or the first prose line after a call; text before the first call is
// narration and goes with the reads. A reply made only of reads is graded whole, and so is one whose
// only prose comes before the first call (a status line, then a read, then an acting call).
/** @param {string} reply */
export function afterLeadingReads(reply) {
  const lines = reply.split("\n");
  let last = -1;
  for (const [i, line] of lines.entries()) {
    const text = line.trim();
    if (!/^TOOL_CALL\b/.test(text)) {
      if (text && last >= 0) {
        break;
      }
      continue;
    }
    const parts = text.replace(/^TOOL_CALL:?\s*/i, "").split(/&&|\|\||[;|]|\bthen\b/);
    if (actsAlso(text) || parts.some((p) => REDIRECTING.test(p) || !LOOKUP.test(p.trim()))) {
      break;
    }
    last = i;
  }
  const rest = lines
    .slice(last + 1)
    .join("\n")
    .trim();
  /** @param {string} line */
  const isCall = (line) => /^TOOL_CALL\b/.test(line.trim());
  /** @param {string[]} list */
  const hasProse = (list) => list.some((line) => line.trim() && !isCall(line));
  const proseOnlyBefore =
    hasProse(lines.slice(0, lines.findIndex(isCall))) && !hasProse(lines.slice(last + 1));
  return last >= 0 && rest && !proseOnlyBefore ? rest : reply;
}

/**
 * @typedef {object} GradeOptions
 * @property {boolean} [coded]
 * @property {string} [requiredCall]
 * @property {string} [requiredText]
 * @property {string} [requiredPattern]
 * @property {string} [forbiddenPattern]
 * @property {string} [options]
 * @property {string} [minOptions]
 * @property {string} [forbiddenInOffer]
 * @property {string} [forbiddenCall]
 * @property {boolean} [allowRead]
 * @property {boolean} [closeOut]
 */
/**
 * @param {string} reply
 * @param {string} expect
 * @param {GradeOptions} [options]
 */
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
    allowRead = false,
    closeOut = false,
  } = {},
) {
  if (!EXPECTS.includes(expect)) {
    throw new Error(`unknown expect "${expect}" (use ${EXPECTS.join(", ")})`);
  }
  if (allowRead) {
    reply = afterLeadingReads(reply);
  }
  // `closeOut` lets a complete reply end with the close-out question; everything around it is graded as
  // usual, and any other question mark fails it.
  // The layout is read from the whole reply, including the close-out block graded as part of it.
  const printed = reply;
  if (closeOut && expect === "complete") {
    reply = closeOutOffer(reply) ?? reply;
  }
  // A tool call is a line of its own, so "I cannot make a TOOL_CALL" does not count.
  const facts = replyFacts(reply, coded);
  const { tool, asks } = facts;
  const lines = reply.split("\n").map((line) => line.trim());
  const calls = lines.filter((line) => /^TOOL_CALL\b/.test(line));
  // A recommendation without a list of options is not an offer.
  const parsed = parseOffer(reply);
  const offer = facts.offer && parsed.options.length > 0;
  // Option text may describe closing ("All done … the session can be closed"); that is not a claim.
  const done = offer
    ? replyFacts(
        reply
          .split("\n")
          .filter((_, i) => !parsed.optionLines.has(i))
          .join("\n"),
        coded,
      ).done
    : facts.done;
  const offerText = parsed.options.length
    ? [...parsed.questions, ...parsed.options].join("\n")
    : "";
  const forbidden = forbiddenCall && new RegExp(forbiddenCall, "i");
  // A ledger write is prose, so only `&&`, `||` and a `;` or `|` before a command split it.
  /** @param {string} call */
  const segments = (call) => {
    const text = call.replace(/^TOOL_CALL:?\s*/i, "");
    const split = RECORDING.test(text)
      ? new RegExp(`&&|\\|\\||[;|](?=\\s*(?:${ACTION})\\b)|${THEN}`, "i")
      : new RegExp(`&&|\\|\\||[;|]|${THEN}`, "i");
    return text.split(split).map((part) => part.trim());
  };
  const acted = calls.some((call) =>
    segments(call).some((part) =>
      forbidden
        ? forbidden.test(part)
        : REDIRECTING.test(part) ||
          !(READING.test(part) || (RECORDING.test(part) && !DELETING.test(part))),
    ),
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
    (!forbiddenInOffer || !new RegExp(forbiddenInOffer, "i").test(offerText));
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
            ? done && !offer && !tool && !asks && !(closeOut && reply.includes("?"))
            : // "reply" screens a rule outside the end-of-reply shape, so only the declared checks grade it.
              expect === "reply"
              ? true
              : (offer || tool) && !done;
  // The offer's layout is part of the shape the rules ask for, so a bad layout fails the behavior.
  const layout = layoutProblems(printed, coded);
  const right = behavior && (expect === "reply" || layout.length === 0);
  return { pass: right && declared, behavior: right, declared, tool, asks, done, offer, layout };
}
