# house-rules repository guidance

This file adds to your own rules for work on this repository. The checks are
in the README's Development section; run all three before landing.

## Landing

Commits on `main` carry one identity as both author and committer:
`bompus <bompus@users.noreply.github.com>`. Set it per commit with
`git -c user.name=bompus -c user.email=bompus@users.noreply.github.com commit`.

Land through a pull request for the record, then fast-forward `main` to the
branch head: `git push origin <branch>:main`. GitHub marks the pull request
merged when its head reaches `main`. Delete the branch afterwards. Never land
with GitHub's squash, merge or rebase buttons, or with any GitHub CLI or
wrapper-script merge: they write the account's profile name into the public
history.

## Releases

A change users will notice gets a `CHANGELOG.md` entry under a new version,
following semantic versioning, in the same commit.

## Public repository

Write nothing that names a private project, private repository, local path,
home directory or credential.
