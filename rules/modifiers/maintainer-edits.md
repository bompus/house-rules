---
description: Enable maintainer edits on GitHub pull requests from personal forks; report unsupported cases.
after: Repository work
---

## Maintainer edits

For every GitHub pull request you submit, enable maintainer edits wherever
GitHub supports it, including contributions to external repositories.
In the browser, select "Allow edits from maintainers" or "Allow edits and
access to secrets by maintainers". With `gh pr create`, keep its enabled
default; never pass `--no-maintainer-edit`. With the API, set
`maintainer_can_modify` to `true`.

Check the saved setting when the creation result is unclear or when correcting
an existing PR. Use `maintainer_can_modify` on
`/repos/{owner}/{repo}/pulls/{pull_number}` to read or update it with the API.
Report failed updates rather than claiming the setting is enabled.

GitHub supports this permission for PRs from personal forks. For PRs within
the same repository, edits use repository permissions; the fork setting does
not apply. Report other unsupported cases without changing repository access.

When a fork contains GitHub Actions workflows, this permission also lets
maintainers edit those workflows, potentially exposing fork secrets and access
to other branches. Selecting this modifier includes that permission; it does
not authorize enabling Actions or adding secrets.
