#!/usr/bin/env node
// Fails when an issue draft neither offers a pull request nor links one.
// usage: check-pr-offer.mjs <draft.md>   (or the draft on stdin)
// The text checked is the "Fix applied or workaround" field when the draft has one, else the
// draft's last lines. Run it before showing a draft to the user and again on the filed body.
import { readFileSync } from "node:fs";

const TAIL_LINES = 8;
const FIELD = /^(?:#{1,6}\s*|\*\*)?fix applied or workaround\b/i;
const HEADING = /^#{1,6}\s/;
const OFFER = /pull request|github\.com\/[^\s/]+\/[^\s/]+\/(?:pull\/\d+|tree\/\S+)/i;
// A sentence that denies the offer ("I cannot open a pull request") does not count.
const DENIAL = /\b(?:cannot|can't|can not|won't|will not|unable|never|no|not)\b[^.]*pull request/i;

// The field's text: from its heading or label to the next heading, or null when the draft has none.
export function offerText(draft) {
  const lines = draft.split("\n");
  const start = lines.findIndex((l) => FIELD.test(l.trim()));
  if (start >= 0) {
    const end = lines.findIndex((l, i) => i > start && HEADING.test(l));
    return lines.slice(start, end < 0 ? undefined : end).join("\n");
  }
  return lines
    .filter((l) => l.trim())
    .slice(-TAIL_LINES)
    .join("\n");
}

export const offersPullRequest = (draft) =>
  OFFER.test(
    offerText(draft)
      .split(/(?<=[.!?])\s+|\n/)
      .filter((sentence) => !DENIAL.test(sentence))
      .join("\n"),
  );

if (import.meta.main ?? import.meta.url === `file://${process.argv[1]}`) {
  const draft = readFileSync(process.argv[2] ?? 0, "utf8");
  if (offersPullRequest(draft)) process.exit(0);
  console.error(
    'FAIL: the "Fix applied or workaround" text (or the draft\'s closing lines) neither says "pull request" nor links one.\n' +
      'Add the offer: "None applied. I can open a pull request for this once triage confirms the direction. <branch exists / not written yet>; <the approach I would measure>." or link the existing branch or pull request.',
  );
  process.exit(1);
}
