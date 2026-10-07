# Contributing

Issues and pull requests are welcome: a rule an agent misreads, a modifier
or skill that would help other setups, a bug in `compose.mjs`.
Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).

## What fits

House-rules is a practical starting point for ordinary development with AI
coding agents. Include guidance for common work or a recurring failure with a
clear benefit over existing rules, tools and skills.

For a new rule, modifier or skill, show:

1. The concrete problem and representative developer task.
2. The existing alternative and why it is insufficient.
3. Evidence for the behavior, including when it should stay inactive.
4. Its cost in setup choices, loaded context, dependencies and maintenance.
5. Why it belongs here rather than in personal or project guidance.

Portability and explicit invocation alone do not establish a reason to include
a workflow. Prefer improving existing guidance or tools. Keep speculative
procedures and personal operating habits in their own layers.

Always-on rules must be broadly useful and preserve project choices. Default
skills must support routine work with little setup. Specialist additions need
a concrete shared use case and stay out of fresh defaults. Introduce them when
the relevant task arises; setup should not require choosing from the catalog.

Everything here must work for anyone's projects. Leave out names of private
projects or repositories, local paths, home directories and credentials. A
preference only some users want belongs in an opt-in modifier, not in
`rules/core.md`.

When you change rule wording, say in the pull request which agent behavior
it changes and how you saw it. The end-of-reply eval in `evals/end-of-reply/`
is one way to show it.

## Before you open a pull request

1. Run the checks in the README's Development section. CI runs them too.
2. Add a `CHANGELOG.md` entry under `Unreleased` for any change users will
   notice. The maintainer batches approved changes into versioned releases;
   each pull request does not need its own version or tag.

## How changes land

The maintainer lands pull requests by rebasing them onto `main` and
fast-forwarding, so your commits keep you as their author. Contributions are
licensed under the MIT licence in `LICENSE`. When you adapt someone else's
work, record its source and applicable licence notices in `THIRD_PARTY_NOTICES.md`.
A skill copied on its own must carry those notices inside its bundle, such as
`NOTICE.md` or `LICENSE`. Keep source references in instructions when they help
the task; pure credit belongs in the notices.
