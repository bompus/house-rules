# Third-party notices

Some files in this repository copy or adapt work published under the MIT
License. Each source's copyright notice and the licence text follow.
`CODE_OF_CONDUCT.md` is the Contributor Covenant, under CC BY 4.0, noted at
the end.

## Compact work updates

Sources: https://x.com/davekiss/status/2115103988299264450 and
https://x.com/nateberkopec/status/2114819619513135180.

- `rules/modifiers/compact-status.md`: independently written guidance informed by
  the four status fields and direct result links described in these posts.
  No post text or screenshot is reproduced. The posts state no reuse licence;
  this repository's MIT licence applies to its newly written guidance.

## Session history in comments

Sources: https://github.com/astral-sh/uv/blob/main/AGENTS.md (compared at
revision `c5fed68440e161dfd18b2c2b2dd5a8744ef824a5`, licensed under Apache-2.0 or MIT)
and https://x.com/davekiss/status/2118094079879794894.

- `skills/hr-plain-prose/SKILL.md`: independently written guidance informed by
  uv's rules against leaking conversation or iteration history into comments and
  pull request text and against past-facing wording. It quotes one phrase from
  uv's file, "preserve the existing behavior", as an example of that wording.
  No other uv text is reproduced, and the post's script and screenshots are not
  reproduced.

This repository's MIT licence applies to the newly written guidance, not to uv's
file or the post.

## Untangle-codebase skill

Source: https://github.com/caldoai/skills, `skills/untangle-codebase/SKILL.md`
(compared at revision `f3cf477`, MIT licence).

- `skills/hr-maintainability-review/SKILL.md`: the special-cases wording and the
  "Pieces that change together without showing it" check are independently
  written guidance informed by that skill's "should these pieces change
  together?" framing and its reading of special cases as missing requirements.
  No text from the skill is reproduced.

This repository's MIT licence applies to the newly written guidance, not to the
source skill.

## Cursor workflow ideas

Source: https://cursor.com/docs/skills

- `skills/hr-writing-pr/references/splitting.md`: independently written workflow informed by the
  purpose of Cursor's built-in `split-to-prs` skill.
- `skills/hr-pr-followup/`: independently written workflow informed by the
  purpose of Cursor's built-in `autopilot` skill.

These files distribute no Cursor instruction text. Their MIT licence applies
to newly written house-rules material, not to the Cursor skills.

## Xu and Wu, stale instruction files

Source: Xiaonan Xu and Wenjing Wu, "Stale Instruction Files Override the Code in Coding Agents: A One-Sentence Fix", arXiv:2610.30571 (22 October 2026).

- `rules/modifiers/code-over-stale-docs.md`: its one sentence adapts the paper's user-level instruction. It keeps the paper's rule to follow the existing code's conventions and to report each mismatch in the final reply, and adds an exception for documentation that says the code is legacy or being migrated. No other text is copied.

The paper's licence is the arXiv non-exclusive distribution licence, which does not grant others a licence to reuse the text, and its data repository (`WenJing95/stale-docs-data`) states none. The authors' abstract invites users to add the sentence to their own instruction file. This notice records the source and that no reuse licence was found; it does not claim one. The MIT licence of this repository applies to the wording of the adaptation and the exception, not to the paper.

## mattpocock/skills

Source: https://github.com/mattpocock/skills (compared at revision `d81f3a1`)

- `skills/hr-writing-for-agents/`: adapted from `skills/productivity/writing-for-agents/`.
- `skills/hr-code-review/`: adapted from `skills/engineering/code-review/`.
- `skills/hr-handoff/`: adapted from `skills/productivity/handoff/`.
- `skills/hr-diagnosing-bugs/`: written for this repository after
  `skills/engineering/diagnosing-bugs/`, which it shares a purpose with.

- `skills/hr-tdd/`: adapted from `skills/engineering/tdd/` at revision
  `f3fc5632f401156837ee3872f14fe33ccf1024ea`. The bundle carries its MIT notice.
- `skills/hr-codebase-design/`: adapted from `skills/engineering/codebase-design/`
  at revision `a496f5513d4a4cf889bc48e189e579f4b0bdf6aa`.
- `skills/hr-domain-modeling/`: adapted from `skills/engineering/domain-modeling/`
  at revision `24fe0ef7737efae15c87225755e9f6f5965e4888`.
- `skills/hr-grilling/`: adapted from `skills/productivity/grilling/` at revision
  `a496f5513d4a4cf889bc48e189e579f4b0bdf6aa`.

  These three bundles carry their MIT notice.

Copyright (c) 2026 Matt Pocock

## obra/superpowers

Source: https://github.com/obra/superpowers (compared at revision `8ca22db`)

- `skills/hr-writing-for-agents/SKILL.md`: the instruction-form table is adapted
  from `writing-skills`. Its wording tests found that a recipe beat a prohibition
  for shape failures.
- `skills/hr-test-audit/SKILL.md`: cites `writing-good-tests.md`.

Copyright (c) 2025 Jesse Vincent

## addyosmani/agent-skills

Source: https://github.com/addyosmani/agent-skills (compared at revision `9d0c60d`)

- `skills/hr-test-audit/scripts/floor-guard.ts`: adapted from
  constraint-driven-development.

Copyright (c) 2025 Addy Osmani

## openclaw/openclaw

Source: https://github.com/openclaw/openclaw (linked at revision `65f1e4d`, compared at `1fda703`)

- `skills/hr-test-audit/SKILL.md`: the authoring gate, junk patterns, retention
  bar and evidence fields are adapted from `.agents/skills/test-audit/`.

Copyright (c) 2026 OpenClaw Foundation

## no-human-ai/no_human

Source: https://github.com/no-human-ai/no_human (compared at revision `9b50bf6`)

- `skills/hr-test-audit/SKILL.md`: the rule that weakening a test counts as
  removing it is adapted from its tamper guard.
- `skills/hr-code-review/references/evidence.md`: test-weakening assessment and
  refuting completion claims are informed by its verification approach.

Copyright (c) 2026 Eyal Golan

## omkamal/pypict-claude-skill

Source: https://github.com/omkamal/pypict-claude-skill (compared at revision `fbda212`)

- `skills/hr-test-audit/SKILL.md`: the pairwise-coverage guidance is adapted from
  this skill.

Copyright (c) 2025 pypict-claude-skill contributors

## sickn33/antigravity-awesome-skills

Source: https://github.com/sickn33/antigravity-awesome-skills (compared at revision `7bb0ab4`)

- `skills/hr-writing-pr/SKILL.md`: selected ideas from
  `skills/git-pr-workflows-pr-enhance/`. Selected ideas also come from
  [Luke Parker's writing-pr post](https://x.com/LukeParkerDev/status/2096769160021979571).

Copyright (c) 2026 Antigravity User

## cursor/plugins (pstack)

Source: https://github.com/cursor/plugins (compared at revision `e43c7ee`)

- `rules/core.md`: the § Implementation economy bullet on scripting changes
  that span more than three places is adapted from
  `pstack/skills/principle-build-the-lever/`.
- `skills/hr-diagnosing-bugs/SKILL.md`: § Question the premise is adapted from
  `pstack/skills/principle-attack-the-premise/`.
- `skills/hr-benchmarking/SKILL.md`: the validity checks are adapted from
  `pstack/skills/benchmark-checklist/`.

Copyright (c) 2026 Lauren Tan

## jakubkrehel/skills

Source: https://github.com/jakubkrehel/skills (compared at revision `267330e1adfc66a718fb65fa6918c1f06d0a689e`)

- `skills/hr-better-accessibility/`, `skills/hr-better-colors/`, `skills/hr-better-layout/`,
  `skills/hr-better-typography/` and `skills/hr-better-writing/`: adapted skill bundles,
  including their supporting references and discovery metadata.
- `skills/hr-better-interface/` and `skills/hr-break/` (revision
  `592aedc44d7d5b3e29740984252902f3e5402a1c`) and `skills/hr-explain-interface/`
  (revision `d574cc8a576dc24256ad38268b8d03d86724a1b3`): adapted skill bundles that
  carry their MIT notice.

Copyright (c) 2026 Jakub Krehel

## emilkowalski/skills

Source: https://github.com/emilkowalski/skills (compared at revision `e8a175de22ae1e49370fc144c1f3bb9aeedf988d`)

- `skills/hr-better-accessibility/` and `skills/hr-better-layout/`: mobile behavior and
  viewport guidance adapted from `skills/mobile-native/SKILL.md`.
- `skills/hr-better-layout/`, `skills/hr-better-typography/` and `skills/hr-better-writing/`:
  clipping, truncation and plural-form guidance adapted from `skills/break-ui/SKILL.md`.

Copyright (c) 2026 Emil Kowalski

## humanlayer/skills

Source: https://github.com/humanlayer/skills (compared at revision `bba9d13ab34f0a87f1cc33df4dd196372393ddfc`)

- `skills/hr-explain-code/SKILL.md` and `skills/hr-writing-pr/SKILL.md`: compact
  visual explanation and focused structural-diff guidance adapted from
  `plugins/show-me/skills/show-me/SKILL.md`.

Copyright (c) 2026 HumanLayer

## Jeanno/jeanno-skills (ideas)

Source: https://github.com/Jeanno/jeanno-skills (compared at revision `db4e8fd66197ece38d622ca8b527dbe821843df2`)

- `skills/hr-manual-qa/SKILL.md`: independently written instructions informed by
  the reproducible-checklist idea in `skills/qa-checklist/SKILL.md`.
- `rules/core.md`: independently written correction handling informed by the
  dependent-work sweep in `skills/realign/SKILL.md`.

No source text from this repository is copied here.

## ayghri/i-have-adhd (ideas)

Source: https://github.com/ayghri/i-have-adhd (compared at revision `723af7d9afaf43eb871dbcce6129e2bf80de90d5`)

- `rules/core.md`: independently written guidance informed by the small visible
  list idea in `skills/i-have-adhd/SKILL.md`.
- `skills/hr-plain-prose/SKILL.md`: independently written reply check informed
  by the first-and-last-line check in that skill.

No source text from this repository is copied here.

## dzhng/jevgrep

Source: https://github.com/dzhng/jevgrep (compared at revision `81a724f9e9376f060361295b10e539df2477e32f`)

- `skills/hr-audit-choices/`: adapted from `.agents/skills/audit-choices/`. The
  same skill is now maintained in https://github.com/dzhng/skills under
  `skills/engineering/audit-choices/`.

Copyright (c) 2026 David Zhang

## pingdotgg/t3code

Source: https://github.com/pingdotgg/t3code (revision `3b2f958603a51d8c42c4ede02eee7b8cb310b2d9`)

- `skills/hr-test-audit/SKILL.md`: representative test-data isolation and the
  rendering-only limit of directly seeded view state, adapted from `AGENTS.md`
  and `.agents/skills/test-t3-app/references/sqlite-fixtures.md`.

Copyright (c) 2026 T3 Tools Inc.

## t3dotgg/tstack

Source: https://github.com/t3dotgg/tstack (revision `1085050f3baed1ac724caa4a8166145fb2ac88af`)

- `skills/hr-code-review/references/evidence.md`: independently written guidance
  informed by the final-diff proof coverage requirement in
  `skills/full-send/SKILL.md`.

Copyright (c) 2026 Theo Browne

## DietrichGebert/ponytail

Source: https://github.com/DietrichGebert/ponytail

- `skills/hr-ponytail/`: adapted from `skills/ponytail/SKILL.md` at revision
  `6f1c2bfff0c837d268929a7c4e490918eb4fab29`.
- `skills/hr-ponytail-review/`: adapted from `skills/ponytail-review/SKILL.md` at
  revision `2961b52fc1fe6a5a87c7a959a79512e5c2f3ffe5`.

Both bundles carry the MIT notice.

Copyright (c) 2026 DietrichGebert

## A Philosophy of Software Design (ideas)

Source: John Ousterhout, _A Philosophy of Software Design_ (Yaknyam Press, 2018), chapter 10, "Define Errors Out Of Existence"

- `rules/references/implementation-economy.md`: independently written guidance
  on making an edge case valid at the interface, informed by that chapter.

No source text from this book is copied here.

## MIT License text

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Contributor Covenant

Source: https://www.contributor-covenant.org/version/2/1/code_of_conduct.html

- `CODE_OF_CONDUCT.md`: version 2.1, with this repository's reporting method
  filled in. Licensed under
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); its own
  Attribution section credits the source.
