// Reads the questions and options an offer presents, whatever their rendering: coded (`1A`, bare
// or as a list item), numbered or bulleted, with or without bold, a "(Recommended)" marker or a
// trailing explanation.
// A question is a line ending in "?" (or a coded "Question N" label) that a list item follows
// before any line that says how to reply. Its options are the list items up to that line or the
// first unindented line of prose after them, so prose and status bullets around the offer do not
// count.
const ITEM = /^(?:(?:[-*•]|\d+[.)])\s+)?[*_]*`\d+[A-Z]`:?[*_]*:?\s+|^(?:\d+[.)]|[-*•])\s+/;
const CODED = /^[*_]*Question\s+\d+\b/i;
const QUESTION = new RegExp(`\\?[*_]*$|${CODED.source}`, "i");
const ACCEPT = /^[*_]*(?:Recommended(?: combination)?:|To accept\b|Reply\b)/i;

/** @param {string} text */
const label = (text) =>
  text
    .replace(/[*_]{2}/g, "")
    .replace(/\((?:Not )?Recommended[^)]*\)/gi, "")
    .replace(/\s+/g, " ")
    .replace(/^[:\-–]\s*/, "")
    .trim();

/** @param {string} reply */
export function parseOffer(reply) {
  const raws = reply.split("\n");
  const lines = raws.map((raw) => raw.trim());
  /** @type {string[]} */
  const questions = [];
  /** @type {string[]} */
  const options = [];
  /** @type {Set<number>} */
  const optionLines = new Set();
  let open = false;
  let chosen = 0;
  lines.forEach((line, i) => {
    // A coded "Question N" may have explanation before its options; any other question may not.
    const ahead = CODED.test(line)
      ? (lines.slice(i + 1).find((l) => ITEM.test(l) || ACCEPT.test(l)) ?? "")
      : (lines.slice(i + 1).find(Boolean) ?? "");
    if (QUESTION.test(line) && (ITEM.test(line) || ITEM.test(ahead))) {
      questions.push(label(line.replace(ITEM, "")));
      open = true;
      chosen = 0;
    } else if (open && ITEM.test(line)) {
      options.push(label(line.replace(ITEM, "")));
      optionLines.add(i);
      chosen++;
    } else if (
      open &&
      (ACCEPT.test(line) || (chosen && line && raws[i] === raws[i]?.trimStart()))
    ) {
      open = false;
    }
  });
  return { questions, options, optionLines };
}

// The layout the coded-offers rule asks for, read from the raw reply. A reply with no acceptance line
// is not an offer and has no layout problems. Markdown joins consecutive lines of a paragraph, so two
// or more bare coded lines in one paragraph render as one run-on paragraph; a list item or a table
// row opens with a marker, not the code, so it does not count. Nothing may follow the acceptance
// line, on its own line or after its reply codes.
const BARE_OPTION = /^ {0,3}[*_]*`\d+[A-Z]`/;
const ACCEPTANCE = /^[*_]*Recommended(?: combination)?:\s*reply\b/i;
// "Recommended: reply `1A` or `go`", "… `1A, 2A` or `go`" and "… `1A`, `2A` or `go`": code spans
// joined by commas, "or" and "and", and no other words.
const ACCEPTANCE_ONLY =
  /^[*_]*Recommended(?: combination)?:\s*reply\s+(?:`[^`]+`[\s,.;]*|(?:or|and)\s+)+[*_]*$/i;
// A GFM table has a delimiter row, so its rows may omit the outer pipes and still open with a code.
const TABLE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

/** @param {string} reply */
export function layoutProblems(reply) {
  const lines = reply.split(/\r?\n/);
  const accepted = lines.findIndex((line) => ACCEPTANCE.test(line.trim()));
  if (accepted < 0) {
    return [];
  }
  const acceptance = (lines[accepted] ?? "").trim();
  /** @type {string[]} */
  const problems = [];
  for (const paragraph of reply.split(/\r?\n[ \t]*\r?\n/)) {
    const rows = paragraph.split(/\r?\n/);
    // Rows from a table's header row to the end of the paragraph are table rows, not options.
    const delimiter = rows.findIndex((row) => row.includes("|") && TABLE_DELIMITER.test(row));
    const bare = (delimiter < 0 ? rows : rows.slice(0, Math.max(delimiter - 1, 0))).filter((row) =>
      BARE_OPTION.test(row),
    );
    if (bare.length > 1) {
      problems.push(
        `${bare.length} options share one paragraph: ${bare.map((row) => row.trim().slice(0, 4)).join(" ")}`,
      );
    }
  }
  if (!ACCEPTANCE_ONLY.test(acceptance)) {
    problems.push(
      `the acceptance line has text besides its reply codes: "${acceptance.slice(0, 60)}"`,
    );
  }
  const after = lines.slice(accepted + 1).find((line) => line.trim());
  if (after !== undefined) {
    problems.push(`text follows the acceptance line: "${after.trim().slice(0, 40)}"`);
  }
  return problems;
}

// The close-out question a finished session ends with (rules/core.md § Finishing work): one question
// about closing the session, exactly the options `All done` (recommended) and `Pause`, then the line
// saying to reply `All done`. The options may be list items or plain lines. Returns the reply without
// that block, so the rest can be graded as a plain completion, or null when the block is missing, has
// anything else in it (a second question, a tool call, another option) or leaves a question behind.
const CLOSING = String.raw`(?:clos\w*|finish\w*|wrap\w*|end\w*)`;
const CLOSING_QUESTION = new RegExp(
  String.raw`\b${CLOSING}\b[^?]*\bsession\b|\bsession\b[^?]*\b${CLOSING}\b|\b(?:finish|wrap(?: it)? up|close(?: it)?(?: out)?|end)\W*$`,
  "i",
);
/** @param {string} reply */
export function closeOutOffer(reply) {
  const lines = reply.split("\n");
  /** @param {string} line */
  const unmarked = (line) => line.trim().replace(ITEM, "");
  const q = lines.findIndex((line) => QUESTION.test(line.trim()));
  if (q < 0 || !CLOSING_QUESTION.test(unmarked(lines[q] ?? ""))) {
    return null;
  }
  const accept = lines.findIndex((line, i) => i > q && ACCEPT.test(line.trim()));
  if (accept < 0) {
    return null;
  }
  const block = lines.slice(q, accept + 1);
  if (block.some((line, i) => /^TOOL_CALL\b/i.test(unmarked(line)) || (i && line.includes("?")))) {
    return null;
  }
  const acceptance = lines[accept] ?? "";
  if (!/\ball done\b/i.test(acceptance) || /\bpause\b/i.test(acceptance)) {
    return null;
  }
  const options = lines.slice(q + 1, accept).filter((line) => line.trim());
  const labels = options.map((line) => label(unmarked(line)));
  if (!optionsMatch(labels, ["All done", "Pause"]) || !/\(Recommended/i.test(options[0] ?? "")) {
    return null;
  }
  const rest = [...lines.slice(0, q), ...lines.slice(accept + 1)].join("\n");
  // Any other question is about something besides closing.
  return rest.includes("?") ? null : rest;
}

// `expected` lists the label each option must start with, in order. A label ending in a letter or
// digit must end there, so "Defer" does not accept "Deferentially publish".
const WORD = /[\p{L}\p{N}]/u;
/**
 * @param {string} option
 * @param {string} want
 */
const startsWithLabel = (option, want) =>
  option.startsWith(want) &&
  !(WORD.test(want.at(-1) ?? "") && WORD.test(option[want.length] ?? ""));

/**
 * @param {string[]} options
 * @param {string[]} expected
 */
export function optionsMatch(options, expected) {
  return (
    options.length === expected.length &&
    expected.every((want, i) => startsWithLabel(options[i] ?? "", want))
  );
}
