// Reads the options an offer presents, whatever their rendering: coded (`1A`), numbered or bulleted,
// with or without bold, a "(Recommended)" marker or a trailing explanation. Options are the list
// items after the first question line, so a status summary's bullets before it do not count.
const ITEM = /^(?:`\d+[A-Z]`:?|\d+[.)]|[-*•])\s+/;
const QUESTION = /\?[*_]*$/;

const label = (text) =>
  text
    .replace(/[*_]{2}/g, "")
    .replace(/\((?:Not )?Recommended[^)]*\)/gi, "")
    .replace(/\s+/g, " ")
    .replace(/^[:\-–]\s*/, "")
    .trim();

export function offerOptions(reply) {
  const options = [];
  let asked = false;
  for (const raw of reply.split("\n")) {
    const line = raw.trim();
    if (QUESTION.test(line)) asked = true;
    else if (asked && ITEM.test(line)) options.push(label(line.replace(ITEM, "")));
  }
  return options;
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
