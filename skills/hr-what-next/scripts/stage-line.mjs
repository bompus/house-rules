// Reading an "Approved, not built:" ledger line: its `trigger:` clause says what the stage waits on, and each
// offer the rest of the line names is judged by its own clause.

// The real `trigger:` field (the last one outside a Markdown code span) and its clause, which ends at ";", `recheck:`
// or `done-when:` outside code. Offers written after the clause stay part of the rest of the line.
/** @param {string} text @returns {{ trigger: string, rest: string }} */
export function splitStage(text) {
  // Code spans are blanked, same length, so a field name or ";" quoted in code is not read as syntax.
  const plain = text.replace(/`[^`]*`/g, (span) => " ".repeat(span.length));
  const start = [...plain.matchAll(/\btrigger:/gi)].at(-1)?.index;
  if (start === undefined) {
    return { trigger: "", rest: text };
  }
  const from = start + "trigger:".length;
  const end = plain.slice(from).search(/;|\b(?:recheck|done-when):/i);
  const cut = end < 0 ? text.length : from + end;
  return { trigger: text.slice(from, cut), rest: text.slice(0, start) + text.slice(cut) };
}

// What the line says about an offer's reply: asked, sent or relayed, or a reply, answer or selection awaited.
const OPEN = new RegExp(
  [
    String.raw`\b(?:asked|sent|relayed|unanswered)\b`,
    String.raw`\b(?:reply|answer|response|selection)\s+(?:is\s+)?pending\b`,
    String.raw`\bpending\s+(?:a\s+|the\s+)?(?:user(?:'s)?\s+)?(?:reply|answer|response|selection)\b`,
    String.raw`\b(?:await\w*|waiting\s+(?:on|for))\s+(?:a\s+|the\s+)?(?:user(?:'s)?\s+)?(?:reply|answer|response|go|selection)\b`,
  ].join("|"),
  "i",
);
const CLOSED =
  /\b(?:approved|selected|chose|chosen|picked|answered)\b|\bnot\s+(?:yet\s+)?(?:sent|asked)\b/i;

// The offer IDs of a stage line whose own clauses say the offer was asked and awaits a reply. Clauses split at ";", ","
// and "and"; a clause naming no offer ("awaiting user reply") belongs to the offer named before it.
/** @param {string} text @param {(clause: string) => string[]} offersNamed */
export function openStageOffers(text, offersNamed) {
  /** @type {Map<string, string>} */
  const said = new Map();
  /** @type {string[]} */
  let last = [];
  for (const clause of splitStage(text).rest.split(/[;,]|\band\b/i)) {
    last = offersNamed(clause).length > 0 ? offersNamed(clause) : last;
    for (const id of last) {
      said.set(id, `${said.get(id) ?? ""} ${clause}`);
    }
  }
  return [...said].filter(([, all]) => OPEN.test(all) && !CLOSED.test(all)).map(([id]) => id);
}
