# npm release procedure

The package name is `@bompus/house-rules`; the executable is `house-rules`.
It has no runtime dependencies or install hooks. Installing the package does
not install skills into an agent host. Composition writes the requested rules
file, its `house-rules-references/` directory when the rules include reference
procedures, and any `--skills-out` directory.

Keep the `package.json` version, changelog version and `v<version>` tag
identical.

## Before any publish step

Run the full public-materials audit in `rules/references/release-batching.md`
against the release candidate, covering every material it lists. Land
corrections on `main` first. Only then tag, publish to npm, create the GitHub
release or announce it.

## Publishing a release

Before publishing, run `npm run check:package -- --out <directory>` on the
release commit and confirm it passes. Publishing a stable GitHub release then
triggers `.github/workflows/npm-publish.yml`. It verifies that the tagged commit
belongs to `main`, checks the package version and dated changelog entry, and
checks the packed CLI and skill resources before publishing the same tarball. Prereleases are excluded.

If the version is already on npm, the workflow compares the published tarball's
integrity with the verified one and skips publishing when they match. Different
bytes at the same version fail the workflow, so fix the problem and release a
new version instead of republishing.

The workflow uses a GitHub-hosted runner and npm's OIDC trusted publishing,
which the package's npm settings must name: GitHub user `bompus`, repository
`house-rules`, workflow filename `npm-publish.yml`, with direct `npm publish`
enabled. The workflow stores no npm token, and none belongs in the repository.
npm requires Node 22.14 or newer and npm 11.5.1 or newer; the workflow uses
Node 26. npm automatically supplies provenance for this public repository and
package. See the [official trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/).

CI runs `npm run check:package -- --bun`. It installs the actual local tarball
into isolated scratch with lifecycle scripts disabled, exercises the CLI under
Node and Bun, and compares composed skills and resources with the source.
Scratch honors `HOUSE_RULES_TEST_TMP` and is removed when the check exits normally.
