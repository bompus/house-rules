---
name: plain-prose
description: Revise text a person will read (commit messages, pull request descriptions, docs, code comments, replies) so it is plain, specific and free of the habits that mark machine-written prose. Use when drafting or revising human-facing text, or when asked to make text sound less generated.
---

# Plain prose

Readers spot generated text by its habits, not by any one word: vague claims,
inflated vocabulary, the same sentence shapes over and over, decoration in
place of content. This skill removes those habits while keeping every fact the
author meant. Apply it to your own drafts before they ship, and to text the
user hands you. For pull request structure, use `writing-pr`; for text an agent
reads, use `writing-for-agents`.

## Before editing

Mark what must survive unchanged: code, identifiers, commands, paths, version
numbers, error messages, quoted material, links and any technical claim. You
may rephrase around these, never inside them. Note the author's deliberate
choices too, such as a project's house terms, a required template or a
consistent "we". Those stay.

## Say the specific thing

A sentence that could appear unchanged in any other project carries no
information. Replace it with the mechanism, the number, the file or the source,
or cut it.

- "Improves performance significantly" becomes "Cuts cold start from 2.1 s to
  0.8 s by caching the parsed config."
- "Various edge cases are handled" becomes "Empty input and a missing trailing
  newline no longer crash the parser."

If the specific is not known, say what is unknown ("not measured", "untested on
Windows"). Never invent a figure, an example or a source to fill the gap.

## Choose plain words

- Prefer the short common word: "use" over "leverage", "help" over
  "facilitate", "start" over "commence".
- Let "is" and "has" do their job. "The cache serves as a buffer" is "The cache
  is a buffer."
- Drop intensifiers and padding: "very", "truly", "it is worth noting that",
  "in order to", "at the end of the day".
- Keep one hedge where doubt is real and drop the rest. "This might possibly
  help in some cases" becomes "This may help when the queue is full."

## Break the sentence habits

- **Reflexive threes.** Lists of three adjectives or three parallel clauses
  appear because the rhythm feels finished, not because there are three things.
  Keep the items that are true and distinct.
- **Contrast framing.** "Not only X, but also Y" and "This isn't about X, it's
  about Y" set up a contrast nobody raised. State Y.
- **Tacked-on significance.** A trailing participle that announces importance
  ("..., highlighting the need for better tests") adds a claim without support.
  Cut it, or make it its own sentence with evidence.
- **Closing summaries.** A last paragraph that restates the ones above it, or an
  "Overall, ..." line, adds length only. End on the last new fact.
- **Rotating synonyms.** Calling the same thing "the worker", "the process" and
  "the job" in three sentences makes the reader wonder whether there are three.
  Pick one name and keep it.

## Strip the formatting habits

- Bold only what a skimming reader must not miss, at most a few times per page.
- Avoid bullets that open with a bold label and a colon and then repeat the
  label in the sentence. Write the sentence, or use a heading.
- No emoji as decoration or as bullet markers.
- Use sentence case for headings unless the project's style says otherwise.
- Use dashes sparingly. Most dashes read better as a comma, a colon, a period
  or parentheses.
- Prefer a paragraph to a bullet list when the points depend on each other.

## Remove chat leftovers

Text that leaves the conversation should not carry its manners. Delete
praise for the question ("Great question!"), offers of further help ("Let me
know if you'd like..."), announcements of what comes next ("Here's a breakdown
of..."), and self-reference ("As an AI..."). Start with the content.

## Make it easy to read

- One idea per sentence. Split a sentence that joins two claims with "and".
- Use active voice with a named actor: "The scheduler drops the job", not "The
  job is dropped".
- Write full sentences with articles and verbs. Arrows, slashes and fragments
  ("config -> cache, retry/backoff fixed") belong in notes, not in text a
  stranger reads.

## Do not overcorrect

- Judge by density. One "robust" or one list of three is fine; a paragraph built
  from them is not. No single word proves the text was generated.
- Do not swap stiffness for forced casualness: no slang, jokes or "Honestly,"
  openers the author did not write.
- Vary sentence length. Uniform short sentences are as mechanical as uniform
  long ones.
- Leave text alone when it is already plain. A light edit beats a rewrite.

## Check the result

Compare the revision against the original, sentence by sentence:

1. Every fact, number, condition and caveat from the original is still there,
   with the same meaning and strength.
2. Every item you marked in "Before editing" is byte-for-byte unchanged.
3. Nothing new was claimed that the original or the evidence does not support.
4. Read it once start to finish. If a sentence still sounds like it could
   belong to any project, fix it or cut it.

When revising someone else's text, return the edited version and, if any
meaning was unclear, list the spots where you had to guess rather than guess
silently.
