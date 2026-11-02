---
description: Enable maintainer edits on GitHub pull requests from personal forks; report unsupported cases.
after: Repository work
reference: ../references/maintainer-edits.md
---

## Maintainer edits

For every GitHub pull request you submit, enable maintainer edits wherever GitHub
supports it, including contributions to external repositories: keep `gh pr create`'s
default and never pass `--no-maintainer-edit`. Report failed updates rather than
claiming the setting is enabled, and report unsupported cases without changing
repository access. This permission does not authorize enabling Actions or adding
secrets. Before opening a pull request, read
[the maintainer-edits procedure](../references/maintainer-edits.md).
