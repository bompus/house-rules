# house-rules repository guidance

This file adds to your own rules for work on this repository. The checks are
in the README's Development section; run all of them before landing.

## Landing

The maintainer lands pull requests; contributors' commits keep their author
(see CONTRIBUTING.md). When you land for the maintainer, open a pull request
for the record, then land it with
`HR_PUSH_LANDED=bompus/house-rules bash skills/hr-pr-followup/scripts/merge-pr.sh bompus/house-rules#<n>`.
After the review and `check` gates pass, it fast-forwards `main` to the
reviewed head with a push, deletes the branch and verifies the landing. Do not
push to `main` by hand. A hand-written check-then-push sequence can push past a
refusal in a shell that ignores `set -e`. GitHub's merge buttons and
`gh pr merge` are off limits, because they write the account's profile name into
the public history.

Commits you write on `main` carry `bompus <bompus@users.noreply.github.com>`
as author and committer, set per commit with
`git -c user.name=bompus -c user.email=bompus@users.noreply.github.com commit`.
To land an outside contributor's pull request, rebase it onto `main` with that
committer identity and push the result to its branch. If you cannot push
there, close the pull request with a comment naming the landing commit.

## Releases

A change users will notice gets a `CHANGELOG.md` entry under `Unreleased`
in the same commit. Land independently verified changes through the normal
landing path; landing a pull request does not require a tag or release.
Changelog entries describe completed changes. Keep unfinished work in the
task plan rather than the changelog.

Before a release or public announcement, follow the full release procedure in
[`rules/references/release-batching.md`](rules/references/release-batching.md).

When the batch is ready, first run the full public-materials audit and the
changelog audit in that reference against the release candidate, covering every
material it lists. Land every correction on `main` before the tag, the npm publish, the GitHub
release or the announcement. Then prepare one release commit that moves all
`Unreleased` entries into a dated version section. Choose the semantic version for the
combined changes, including any breaking change. Keep `package.json` `version`
equal to the changelog version. Follow [docs/npm-release.md](docs/npm-release.md)
for the npm publication. Once that commit and every included change are
verified on `main`, tag the release commit `v<version>`
and publish notes containing that version's complete changelog entry:
`gh release create v<version> --target <sha> --title v<version> --notes-file <entry>`.

The installers follow the default branch, so batching tags does not defer
updates for those consumers. Existing tags and releases stay unchanged.

## Public repository

Write nothing that names a private project, private repository, local path,
home directory or credential.
