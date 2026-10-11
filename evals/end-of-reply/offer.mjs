// Reads the questions and options an offer presents, whatever their rendering: coded (`1A`),
// numbered or bulleted, with or without bold, a "(Recommended)" marker or a trailing explanation.
// A question is a line ending in "?" that a list item follows. Its options are the list items up to
// the line that says how to reply, so prose and status bullets around the offer do not count.
const ITEM = /^(?:`\d+[A-Z]`:?|\d+[.)]|[-*•])\s+/;
const QUESTION = /\?[*_]*$/;
const ACCEPT = /^[*_]*(?:Recommended(?: combination)?:|To accept\b|Reply\b)/i;

const label = (text) =>
  text
    .replace(/[*_]{2}/g, "")
    .replace(/\((?:Not )?Recommended[^)]*\)/gi, "")
    .replace(/\s+/g, " ")
    .replace(/^[:\-–]\s*/, "")
    .trim();

export function parseOffer(reply) {
  const lines = reply.split("\n").map((raw) => raw.trim());
  const questions = [];
  const options = [];
  let open = false;
  lines.forEach((line, i) => {
    const next = lines.slice(i + 1).find(Boolean) ?? "";
    if (QUESTION.test(line) && (ITEM.test(line) || ITEM.test(next))) {
      questions.push(label(line.replace(ITEM, "")));
      open = true;
    } else if (open && ITEM.test(line)) options.push(label(line.replace(ITEM, "")));
    else if (open && ACCEPT.test(line)) open = false;
  });
  return { questions, options };
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
