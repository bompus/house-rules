---
name: plain-prose
description: Revise text a person will read (commit messages, PR descriptions, docs, code comments, replies) so it is plain, specific and free of AI tells, the habits that mark machine-written prose. Use when drafting or revising human-facing text, or when asked to "unslop" text or make it sound less generated.
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

A passage the author has flagged to keep, by telling you so or with a
comment such as `plain-prose: keep`, stays exactly as written, whatever the
checks below say about it.

## Say the specific thing

A sentence that could appear unchanged in any other project carries no
information. Replace it with the mechanism, the number, the file or the source,
or cut it.

- "Improves performance significantly" becomes "Cuts cold start from 2.1 s to
  0.8 s by caching the parsed config."
- "Various edge cases are handled" becomes "Empty input and a missing trailing
  newline no longer crash the parser."

If the specific is not known, say what is unknown ("not measured", "untested on
Windows"). Never invent a figure, an example or a source to fill the gap. The
same goes for thresholds and norms. A judgment word such as "normal", "on
target", "reasonable" or "on track" needs the baseline it is measured against
("RSS of 1.4 GB, under the 2 GB container limit"). If nothing defines the
expected value, write that it is undefined rather than passing judgment.

- **Unnamed authorities.** "Research suggests", "it is widely accepted" and
  "most developers prefer" with no source behind them present an opinion as
  consensus. Name the study, the survey or the person, or delete the
  sentence.
- **Fake ranges.** "Handles everything from SQLite files to billing disputes"
  joins two ends that sit on no shared scale, so nothing lies between them.
  List the things it handles.

## Choose plain words

- Prefer the short common word: "use" over "leverage", "help" over
  "facilitate", "start" over "commence".
- Let "is" and "has" do their job. "The cache serves as a buffer" is "The cache
  is a buffer."
- Drop intensifiers and padding: "very", "truly", "it is worth noting that",
  "in order to", "at the end of the day".
- Keep one hedge where doubt is real and drop the rest. "This might possibly
  help in some cases" becomes "This may help when the queue is full."
- An adverb attached to a weak verb signals that a stronger verb or a
  measurement belongs there. "Loads really fast" becomes "Loads in 180 ms";
  "sharply reduces errors" becomes "Cuts failed uploads from 4% to 0.3%".

The words below are cues to reread a sentence, not proof of anything. When
one turns up, check whether it says more than its plain replacement would, and
look harder where several cluster in one paragraph.

| Word | Write instead |
|---|---|
| delve into | look at, read, test |
| pivotal, crucial | say what breaks without it |
| robust | name the failure it survives |
| seamless | name the step that no longer fails, or cut |
| comprehensive | name what is covered |
| streamline | name the step removed |
| showcase | show |
| underscore | show, or cut |
| foster | help, build |
| elevate | improve, raise |
| tapestry | cut |
| realm | area, or cut |
| testament to | evidence of, or cut |
| moreover, furthermore | also, or cut |
| notably | cut |

## Name the actual thing

Some nouns sound technical but describe a problem as terrain or a physical
force when an ordinary word for it is available. Name the actual thing.

| Stand-in | Plain word |
|---|---|
| landscape | the tools or vendors, listed |
| ecosystem | the packages, plugins or companies meant |
| friction | the extra step, prompt or wait |
| traction | users, downloads or revenue, with the number |
| momentum | what shipped, and when |
| headwinds | the specific problems |
| fault line | the boundary where the two designs disagree |
| center of gravity | the module or team that decides |
| bandwidth | time |
| lens | the criterion |
| pillars | parts, goals |
| erosion | the drop, with before and after figures |

Write figurative language literally too. That covers metaphors, figurative
verbs, code or documents described as if they had wishes, and slogan-like
one-liners.

- "The parser chokes on tabs" becomes "The parser rejects tab characters."
- "The README wants you to start with the setup section" becomes "Read the
  setup section first."

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

## Fix the punctuation

- **Em dashes.** Leave them out of any prose a person reads. At the spot
  where one would sit, end the sentence and start another, or use a comma. No
  other mark may take its role, which rules out en dashes, spaced hyphens,
  ellipses, colons inside a sentence and parenthetical asides. Do not contort
  the sentence to avoid the missing dash either. Hyphenated words keep their
  hyphens, and code, quotations and numeric ranges such as 10-20 keep their
  dashes.
- **Colons.** Colons introduce a list, a sample or a block quotation. A
  colon between two clauses in running prose usually sets up a reveal ("The
  cause was simple: a stale cache."). Write the point directly ("A stale cache
  caused the failure.").
- **Quotes.** Anything headed for source files, commit messages, a shell or a
  Markdown file gets straight quotes and apostrophes. Typographic (curly)
  quotes break shell commands and exact-match searches.

## Strip the formatting habits

- Bold only what a skimming reader must not miss, at most a few times per page.
- Avoid bullets that open with a bold label and a colon and then repeat the
  label in the sentence. Write the sentence, or use a heading. Opening a bullet
  with a bolded name and a period, then giving information the name does not
  already say, is fine.
- No emoji as decoration or as bullet markers.
- Use sentence case for headings unless the project's style says otherwise.
- Prefer a paragraph to a bullet list when the points depend on each other.

## Remove chat leftovers

Text that leaves the conversation should not carry its manners. Delete
praise for the question ("Great question!"), offers of further help ("Let me
know if you'd like..."), announcements of what comes next ("Here's a breakdown
of..."), self-congratulation on a discovery ("Bingo!", "That did it!") and
self-reference ("As an AI..."). Start with the content.

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
- Let emphasis be uneven. A piece can hold one or two quiet, ordinary
  sentences that make no point of their own. Do not fake this with misspellings,
  padding or put-on informality.
- Editing out old habits can breed new, equally regular ones. Look for a short
  moral at the close of each paragraph ("Small fixes add up."), a denial
  followed at once by its correction ("The bug was not in the parser. It was
  in the cache."), and openers that tease an answer ("So why did it fail?").
  Once in a whole piece reads as voice; once per paragraph reads as a
  template.
- When a stock phrase goes, delete it rather than swapping in another. A
  replacement that keeps appearing across edits becomes a habit of its own.
- Leave text alone when it is already plain. A light edit beats a rewrite.

## Check the result

Compare the revision against the original, sentence by sentence:

1. Every fact, number, condition and caveat from the original is still there,
   with the same meaning and strength.
2. Every item you marked in "Before editing" is byte-for-byte unchanged.
3. Nothing new was claimed that the original or the evidence does not support.
4. Read it once start to finish. If a sentence still sounds like it could
   belong to any project, fix it or cut it.
5. Read the opening sentence of every paragraph and nothing else, top to
   bottom. When that sequence reads like a neat abstract of the whole text,
   the paragraphs follow a template. Combine some, change their order or begin
   a section with something other than its summary, without changing what it
   says. Specs, runbooks and reference pages are meant to be skimmed this way,
   so skip the step for them.

When revising someone else's text, return the edited version and, if any
meaning was unclear, list the spots where you had to guess rather than guess
silently.
