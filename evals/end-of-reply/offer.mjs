// Reads the questions and options an offer presents, whatever their rendering: coded (`1A`),
// numbered or bulleted, with or without bold, a "(Recommended)" marker or a trailing explanation.
// A question is a line ending in "?" (or a coded "Question N" label) that a list item follows
// before any line that says how to reply. Its options are the list items up to that line or the
// first unindented line of prose after them, so prose and status bullets around the offer do not
// count.
const ITEM = /^(?:`\d+[A-Z]`:?|\d+[.)]|[-*•])\s+/;
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
