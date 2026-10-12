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

const label = (text) =>
  text
    .replace(/[*_]{2}/g, "")
    .replace(/\((?:Not )?Recommended[^)]*\)/gi, "")
    .replace(/\s+/g, " ")
    .replace(/^[:\-–]\s*/, "")
    .trim();

export function parseOffer(reply) {
  const raws = reply.split("\n");
  const lines = raws.map((raw) => raw.trim());
  const questions = [];
  const options = [];
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
    } else if (open && (ACCEPT.test(line) || (chosen && line && raws[i] === raws[i].trimStart())))
      open = false;
  });
  return { questions, options, optionLines };
}

// The layout the coded-offers rule asks for, read from the raw reply. A reply with no acceptance line
// is not an offer and has no layout problems. Markdown joins consecutive lines of a paragraph, so two
// or more bare coded lines in one paragraph render as one run-on paragraph; a list item or a table
// row opens with a marker, not the code, so it does not count. Nothing may follow the acceptance line.
const BARE_OPTION = /^ {0,3}[*_]*`\d+[A-Z]`/;
const ACCEPTANCE = /^[*_]*Recommended(?: combination)?:\s*reply\b/i;

export function layoutProblems(reply) {
  const lines = reply.split(/\r?\n/);
  if (!lines.some((line) => ACCEPTANCE.test(line.trim()))) return [];
  const problems = [];
  for (const paragraph of reply.split(/\r?\n[ \t]*\r?\n/)) {
    const bare = paragraph.split(/\r?\n/).filter((line) => BARE_OPTION.test(line));
    if (bare.length > 1)
      problems.push(
        `${bare.length} options share one paragraph: ${bare.map((line) => line.trim().slice(0, 4)).join(" ")}`,
      );
  }
  const last = lines.map((line) => line.trim()).findLast(Boolean);
  if (!ACCEPTANCE.test(last))
    problems.push(`the acceptance line is not last; the reply ends "${last.slice(0, 40)}"`);
  return problems;
}

// `expected` lists the label each option must start with, in order. A label ending in a letter or
// digit must end there, so "Defer" does not accept "Deferentially publish".
const WORD = /[\p{L}\p{N}]/u;
const startsWithLabel = (option, want) =>
  option.startsWith(want) && !(WORD.test(want.at(-1)) && WORD.test(option[want.length] ?? ""));

export function optionsMatch(options, expected) {
  return (
    options.length === expected.length &&
    expected.every((want, i) => startsWithLabel(options[i], want))
  );
}
