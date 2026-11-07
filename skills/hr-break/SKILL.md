---
name: hr-break
description: "Render one existing component with relevant production states and worst-case content on a temporary page; report visible breaks when browser observation is available. Use when explicitly asked to stress test or break a component. Code reviews belong to hr-code-review or better-interface."
disable-model-invocation: true
license: MIT
metadata:
  upstream: https://github.com/jakubkrehel/skills
  upstream_ref: 592aedc44d7d5b3e29740984252902f3e5402a1c
  upstream_path: skills/break/
  local_patches: "Manual/hr-domain routing; conditional Next server-client boundary, viewport versus containers, owned-server stop; schema/plural/missing-data axes; upstream skipped-observation/fixture/explicit-cleanup refinements; no state-machine install"
  house_rules_patches: "Portable provenance; hr- skill names"
---

# Break

This skill takes one component and renders it on a harness page under every scenario that can actually reach it. That page is the deliverable: a visual report the user scrolls through, every state side by side, with the breaks marked. A component built against one happy path looks finished right up until real content arrives.

It observes rather than judges. A finding here is something that visibly broke on the page, named in the vocabulary of the domain skill that owns the fix. Reviewing code against a standard is `hr-code-review` and `hr-better-interface`; exploring design alternatives is `hr-design-exploration`.

Where `hr-design-exploration` compares component variants in the real page, this skill isolates on purpose. You are not judging how the component looks in context. You are checking whether it defends itself when the content is worst-case.

The whole run is build, look once, report: minutes, not a session. The work is rendering an existing component with different props, and nothing in it justifies instrumentation, browser debugging or a second pass.

## 1. Scope one component

One component per run. "The settings page" is not a component; the profile form's text input is. Where the request spans several, list the candidates and ask which one to test, rather than picking on the user's behalf.

Restate what the component is in one sentence: what it accepts, what it renders and where it will live.

## 2. Infer the scenarios from the component

Stress only what varies. A scenario earns a slot when the component accepts something that can take that shape in production. So read the component first: its props, its slots, its states and the data it renders.

[scenarios.md](scenarios.md) holds the axes, the values on each and the cue that says whether an axis applies. Walk it against the component and keep only the axes whose cue matches. A text input gets content length and states, never item quantity. A static icon button with a fixed label gets container and environment, never long text.

Write the kept scenarios down before building, one line each, so the harness renders a planned set rather than whatever came to mind. Then say which axes you dropped and why, in one line, so a wrong inference is cheap to catch.

## 3. Build the harness page

The harness page, holding the real component imported from the project, rendered once per scenario in a single column with a short text label above each instance.

The component ships untouched, in its real environment. A scratch route inside the app gives it the app's own layout, fonts and global styles for free. Labels, container widths and fixture props are everything the page adds: no fonts or styles of its own, no simulated themes or token swaps, no probes. A component observed under any of those is a different component.

Where the framework splits server from client components, match the page to the component. In Next, keep the page a server component when the component under test is one, since a `"use client"` page cannot render it. Mark the page `"use client"` when fixtures pass functions, class instances or other values that cannot cross the server-to-client boundary into an interactive component. A scenario that renders empty usually means a fixture was dropped at that boundary.

Widths are scenarios on the page. Render the width cases inside fixed-width containers beside the full-width one, so a single load shows every width and nothing ever gets resized. A fixed-width container exercises intrinsic sizing and container queries, not viewport media queries, which still see the full window. Where the component changes layout at a viewport breakpoint, say the containers cannot show it and name the breakpoint for the user to check by resizing.

Feed scenarios as props and fixture data. The harness never imports production state, never wires to live data and production never imports from the harness.

## 4. Look once

One pass. Load the page in a browser that is already at hand, skim every scenario top to bottom and note what visibly broke. "Text escapes the field's right edge", never "spacing feels tight". A run that never rendered is a code review wearing a costume, and a predicted failure is still not a finding.

One load is the budget. With no browser already at hand, or when it needs launching or debugging, skip observation and hand the URL over. Report only the URL and scenario list, with no findings table, page notes or clean verdict. An unobserved run cannot establish that everything survived.

Then mark each break you did see on the page, a one-line note under that scenario's label, in a single edit. The page has to read as the report on its own.

## 5. Report what broke and stop

Report findings as a table, broken scenarios first:

| Scenario                            | Observed                                      | Owner                  |
| ----------------------------------- | --------------------------------------------- | ---------------------- |
| One unbreakable 60-character string | Overflows the card, no wrap and no truncation | `hr-better-typography` |
| Zero items                          | Blank region with no message                  | `hr-better-writing`    |

The owner column names the domain skill whose rules diagnose the break, so the fix starts in the right place. This skill owns no domain rules and issues no verdict.

"Everything survived" is a complete and useful report. Say which scenarios are on the page and where it is running, so the user can see every one themselves. End there rather than padding the result with preferences.

Do not fix anything unasked. On a request to fix, follow the owner skill's rules, then re-render the failing scenarios to confirm.

## 6. Leave the page up, delete it on request

The page is half the report, so it outlives the findings table. Keep the page and its fixtures until the user says they are done with it. A dev server you started for the run is a different matter: stop it before the session ends and hand over the command that restarts it, so the page stays one command away without a process left running.

When the user requests deletion, remove the page and fixtures, then search for their route and names. Check that the diff leaves no harness references behind.

## Before you finish

| Mistake                                                    | Fix                                                                                        |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Every axis run against every component                     | Keep only the axes whose cue matches, and say which you dropped                            |
| A predicted failure reported as observed                   | Render it, or leave it out                                                                 |
| A scenario missing the content it was fed                  | The harness is broken, not the component; check the server-to-client boundary and re-check |
| A rebuilt lookalike component in the harness               | Import the real component from the project                                                 |
| The harness restyles or re-themes the component            | The app's layout, fonts and tokens as they are; labels and widths are all the page adds    |
| A browser launched, debugged or screenshotted per scenario | One load and one look, or hand the URL over and skip the look                              |
| Findings phrased as taste                                  | Report what was visible on the page, or nothing                                            |
| A break reported without an owner                          | Name the domain skill whose rules diagnose it                                              |
| A clean run padded with suggestions                        | "Everything survived" plus the scenario list is the report                                 |
| The viewport resized scenario by scenario                  | Widths are fixed containers on the page; one load shows them all                           |
| A break in the table but unmarked on the page              | Note it under the scenario's label; the page reads as the report on its own                |
| Page deleted in the same turn as the report                | The page is half the report; delete only on the user's word                                |
| A dev server left running after the session                | Stop the server you started; give the restart command                                      |
| Viewport breakpoints judged from fixed-width containers    | Containers do not trigger media queries; name the breakpoint for a resize check            |
