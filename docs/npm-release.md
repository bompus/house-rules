# npm release setup

The package name is `@bompus/house-rules`; the executable is `house-rules`.
It has no runtime dependencies or install hooks. Installing the package does
not install skills into an agent host. Composition writes only explicit outputs.

`package.json` starts at the existing release version, 0.10.0. This preparation
does not publish that version. In the next batched release commit, update its
version with the dated changelog entry. Keep the package version, changelog
version and `v<version>` tag identical.

## First publication

The first publication requires an npm account that owns the `bompus` scope.
An earlier publication of another package does not establish current login or
scope access. Authenticate using npm's web login and complete its 2FA approval.
Do not put credentials into the repository or workflow.

On the selected release commit, run `npm run check:package -- --out <directory>`.
Publish that verified `house-rules.tgz` with `npm publish <tarball> --access public`.
Then configure its trusted publisher on npm for GitHub user `bompus`, repository
`house-rules`, workflow filename `npm-publish.yml`. Enable direct `npm publish`.
The default staged-publication permission alone does not permit this workflow.

The first GitHub release workflow checks the published tarball integrity and
skips an identical existing version. Different bytes at the same version fail
the workflow. Subsequent versions publish automatically after trusted publisher
setup. Do not create another release solely to test authentication.

## Subsequent releases

Publishing a stable GitHub release triggers `.github/workflows/npm-publish.yml`.
It verifies that the tagged commit belongs to `main`, checks the package version
and dated changelog entry, and checks the packed CLI and skill resources before
publishing the same tarball. Prereleases are excluded.

The workflow uses a GitHub-hosted runner and npm's OIDC trusted publishing.
It stores no npm token. npm requires Node 22.14 or newer and npm 11.5.1 or newer;
the workflow uses Node 26. npm automatically supplies provenance for this public
repository and package. See the [official trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/).

CI runs `npm run check:package -- --bun`. It installs the actual local tarball
into isolated scratch with lifecycle scripts disabled, exercises the CLI under
Node and Bun, and compares composed skills and resources with the source.
Scratch honors `HOUSE_RULES_TEST_TMP` and is removed when the check exits normally.
