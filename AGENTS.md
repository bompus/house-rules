# house-rules repository guidance

This file adds to your own rules for work on this repository. The checks are
in the README's Development section; run all three before landing.

## Landing

Commits you write on `main` carry one identity as both author and committer:
`bompus <bompus@users.noreply.github.com>`. Set it per commit with
`git -c user.name=bompus -c user.email=bompus@users.noreply.github.com commit`.
An outside contributor's commits keep their author. Rebase them onto `main`
with that identity as committer (the same `-c` flags on `git rebase`), push
the result to the pull request's branch (forks allow maintainer edits by
default), then land it as below. Rebasing changes the commit IDs, so GitHub
marks the pull request merged only when its updated head reaches `main`. When
you cannot push to that branch, close the pull request with a comment naming
the landing commit.

Land through a pull request for the record, then fast-forward `main` to the
branch head: `git push origin <branch>:main`. GitHub marks the pull request
merged when its head reaches `main`. Delete the branch afterwards. Never land
with GitHub's squash, merge or rebase buttons, or with any GitHub CLI or
wrapper-script merge: they write the account's profile name into the public
history.

## Releases

A change users will notice gets a `CHANGELOG.md` entry under `Unreleased`
in the same commit. Land independently verified changes through the normal
landing path; landing a pull request does not require a tag or release.

Before publishing, review approved backlog items and open pull requests with
their owners. Batch compatible changes that are ready or already intended for
the next release. Record included changes, unfinished items and the release
cutoff or readiness condition in the task plan. Pending backlog items do not
authorize implementation or landing. Do not hold a ready batch for unrelated,
unapproved or indefinite work. An urgent security, regression or compatibility
fix can ship on its own.

When the batch is ready, prepare one release commit that moves all `Unreleased`
entries into a dated version section. Choose the semantic version for the
combined changes, including any breaking change. Once that commit and every
included change are verified on `main`, tag the release commit `v<version>`
and publish notes containing that version's complete changelog entry:
`gh release create v<version> --target <sha> --title v<version> --notes-file <entry>`.

The installers follow the default branch, so batching tags does not defer
updates for those consumers. Existing tags and releases stay unchanged.

## Public repository

Write nothing that names a private project, private repository, local path,
home directory or credential.
