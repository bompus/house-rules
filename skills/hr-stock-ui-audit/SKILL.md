---
name: hr-stock-ui-audit
description: Find template-default styling in frontend code that nobody chose for this product (stock violet accents, purple-to-blue gradients, one stock font, emoji icons, glow and blur effects), triage each hit in context, and report or fix the real ones as the request asks. Use when asked to audit or remove generic or AI-looking styling in existing UI. It does not set a visual direction.
---

# Stock UI audit

Generated and starter-kit interfaces share a recognizable look: an indigo or
violet accent, a purple-to-blue hero gradient, Inter everywhere, frosted cards,
emoji in the nav. None of these is wrong on its own. The problem is a choice
that came with the template instead of from the product. This skill finds those
choices with a static scanner, then sorts them by judgment. The scanner
produces candidates; only triage produces findings.

This skill removes unchosen defaults. It does not invent a brand. If the
product has no visual direction yet, say so and ask for one rather than
replacing one default with another.

## Before you scan

1. Read the brief, the design tokens and the theme or component-library config.
   Note every color, font and component the product asked for. Those stay,
   even when the scanner flags them.
2. Settle the mode from the request:
   - **Review**: report findings only. Edit nothing.
   - **Cleanup**: fix confirmed findings, and only inside the area the user
     named (a page, a component folder, the whole app). Report anything you
     notice outside it instead of fixing it.
3. Pick the scan scope: the source folders that render UI, not the whole
   repository.

## Run the scanner

```sh
bun <this skill's directory>/scripts/scan.mjs [--json] [--fail-on high|medium|low] <paths>...
```

Node 22 or later works too. It walks directories, skips dependency, build and
coverage output and minified files, and reads `.html .css .scss .js .ts .jsx
.tsx .vue .svelte .astro`. It prints the number of files scanned. Exit 0 means
nothing reached the failing severity (high by default), 1 means something did,
2 means bad usage or zero files scanned. A 2 is never a clean result. Pass
`--fail-on medium` when violet accents, a single stock font or emoji icons
should fail the run. Do not add the scanner as a CI gate unless asked.

| Rule                    | Severity | Catches                                                                                                                                      |
| ----------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `purple-blue-gradient`  | high     | gradients whose stops are all cool hues with at least one violet, in CSS or Tailwind `from-`/`to-` classes                                   |
| `violet-accent`         | medium   | any hex, rgb, hsl, oklch or bare HSL token whose computed hue lands in the indigo-to-purple band, plus Tailwind indigo/violet/purple classes |
| `gradient-text`         | medium   | `background-clip: text` and `bg-clip-text`                                                                                                   |
| `single-stock-font`     | medium   | one stock sans (Inter, Roboto, Poppins and similar) as the only named face across two or more declarations in the scanned set                |
| `emoji-icon`            | medium   | emoji inside headings, buttons, links, nav items or `icon`/`label`/`title` fields                                                            |
| `neon-glow`             | medium   | zero-offset, wide-blur shadows in a saturated color, and Tailwind colored shadows                                                            |
| `frosted-glass`         | low      | `backdrop-filter: blur()` and `backdrop-blur`                                                                                                |
| `library-default-token` | low      | untouched default primaries from Bootstrap, Material, MUI, Ant Design, Chakra, shadcn/ui and the Vite starter                                |
| `tracked-caps`          | low      | uppercase text with wide letter spacing                                                                                                      |

The font rule looks across every file in one run, so scan the whole UI scope
together; scanning one file at a time hides it.

## Triage every match

Open each flagged line and read enough around it to see what the element is for.
Give every match exactly one verdict:

- **Unchosen default**: nothing in the brief, tokens or history asks for it,
  and it reads like a starter template. This is a finding.
- **Deliberate choice**: the brief, a token file, a brand guide or a commit
  message shows someone picked it. Keep it and name the evidence.
- **False positive**: the match is not doing what the rule assumes, such as a
  violet hue in a syntax-highlighting theme, a blur on a modal backdrop over
  busy content, or an emoji inside user-generated sample data. Leave it and say
  why.
- **Unresolved**: you cannot tell whether someone chose it. It is not a
  finding and you change nothing. Report what is missing and the question
  that would settle it.

## Fixing what is real

- Fix the cause, not the line. Five violet hexes usually mean one missing
  accent token; define the product's palette and type once and point the
  components at it.
- Choose replacements that serve the content: contrast that holds, an accent
  that marks the one action that matters, type that suits the reading load.
- Never nudge a value just to leave the scanner's range, such as shifting a hue
  a few degrees or swapping a hex for an equivalent `oklch()`. If the color is
  wrong, change it; if it is right, keep it and record why.
- Never change a brand color, a status color (success, warning, error) or a
  focus indicator to make the scan pass. Those carry meaning; record them as
  deliberate.
- Replace emoji icons with the project's existing icon set. Add a new icon
  dependency only if the user agrees.

## What the scanner cannot see

Check these by reading the rendered page, since no pattern match finds them:

- every section built from the same centered headline, subtitle and two buttons
- a three-card feature grid with an icon, title and line of text in each card
- a small badge or pill sitting above the main heading
- cards marked by a thick colored left border
- a stat banner of large numbers ("10k+ users", "99.9% uptime")
- numbered "1, 2, 3" step sections
- a dark theme forced on with no light option the brief asked for
- the same large corner radius and soft shadow on every surface
- spacing and type sizes that ignore the project's scale
- copy that could describe any product

## Verify

1. Rerun the scanner on the same scope and confirm each remaining match has a
   recorded verdict.
2. Look at the rendered UI at the sizes that matter (a narrow phone width and
   a desktop width at least), in every theme the product ships.
3. A clean scan says nothing about accessibility, layout or overall quality.
   Check contrast and focus states on anything you changed.

If you could not render the UI, say the review was static only.

## Report

Write the report in this order:

1. Scope scanned, files scanned, mode, and the scanner's exit code.
2. Findings fixed (or, in review mode, proposed), each with `file:line`, the
   rule, and what replaced it.
3. Matches kept as deliberate, each with its evidence.
4. Unresolved matches, each with what is missing and the question that
   settles it.
5. False positives, each with one line on why.
6. Issues the scanner cannot see, if you found any.
7. How you verified: rerun result, sizes and themes viewed, or "static only".
