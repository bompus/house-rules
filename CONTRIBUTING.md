# Contributing

Issues and pull requests are welcome: a rule an agent misreads, a modifier
or skill that would help other setups, a bug in `compose.mjs`.

## What fits

Everything here must work for anyone's projects. Leave out names of private
projects or repositories, local paths, home directories and credentials. A
preference only some users want belongs in an opt-in modifier, not in
`rules/core.md`.

When you change rule wording, say in the pull request which agent behavior
it changes and how you saw it. The end-of-reply eval in `evals/end-of-reply/`
is one way to show it.

## Before you open a pull request

1. Run the checks in the README's Development section. CI runs them too.
2. Add a `CHANGELOG.md` entry under a new version for any change users will
   notice.

## How changes land

The maintainer lands pull requests by rebasing them onto `main` and
fast-forwarding, so your commits keep you as their author. Contributions are
licensed under the MIT licence in `LICENSE`. When you adapt someone else's
work, credit it in `THIRD_PARTY_NOTICES.md` and beside the adapted text.
