---
name: hr-issue-tracker-setup
description: "Configure a project's issue tracker and conventions for domain terms and architecture decision records (ADRs). Use when explicitly asked to establish or change those conventions; reuse existing configuration. General agent, CI and development-environment setup are outside this workflow."
disable-model-invocation: true
---

# Project tracker setup

Make the project's tracker and domain-document conventions usable from its
agent guidance. Configure only the conventions the user requested.

## Establish what already exists

Read the project's instruction root and the tracker, glossary and ADR guidance
it names. Follow existing links before searching for another system. Identify
which tracker owns tasks, where its records live, and how domain terms and
decisions are recorded. A convention can be complete without a separate glossary
or ADR directory.

When the requested configuration already works, report its entry points and
leave it alone. Other workflows do not require this setup to run first.

## Resolve the missing conventions

Reuse the project's tracker and document locations. Do not create a second
tracker, replace an established one or impose glossary/ADR files by default.
If a choice is missing, ask only for the decisions that change the requested
configuration, such as which tracker to use or whether to record domain terms.
Use the active host's decision format and existing user answers.

Document how the chosen tracker represents tasks, child decisions, supporting
evidence, blockers and ready work. Use its existing concepts; add fields or
structure only when a missing distinction prevents the requested workflow.

## Update and verify the owning guidance

Edit the project's canonical guidance in place. Its instruction root should
point to the tracker and detailed domain-document conventions rather than
repeat them. Preserve project safeguards and generated loading adapters;
use their owning generator when an adapter needs updating.

Keep shared personal skills in their configured shared source and installation
scope. Project-only skills belong with the project. This workflow does not
install skills, configure agent accounts or set up CI and developer tooling.

Run the project's applicable guidance checks and verify the documented entry
points from the intended workspace. Report what changed, what was already
configured and any decision or check still unresolved. Do not claim runtime
loading from a file update alone.
