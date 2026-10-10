# Panel plan

Use the bundled `../scripts/panel-plan.mjs` to see which seats stored panel
preferences resolve to before any model runs. It reads files and prints a plan;
it never launches a seat, discovers a provider, checks quota or changes a file.

```sh
node <skill-directory>/scripts/panel-plan.mjs --bindings bindings.json \
  --author-family <family-of-the-running-session> [--config <house-rules.json>] \
  [--task task.json] [--project project.json --approve-project <sha256-of-project.json>] \
  [--approve-metered <alias>] [--json]
```

Exit 0 means a plan, 1 means named blockers, 2 means unreadable or invalid input.
`--config` defaults to the house-rules configuration; its `panel` section is the
user layer. Every input is a regular file, not a symlink.

## Bindings

A user-owned file maps each alias to its exact launch and provenance. Only the
user's own file belongs here; credentials stay in the provider's authentication.

```json
{
  "version": 1,
  "aliases": {
    "review-primary": {
      "families": ["anthropic"],
      "metered": false,
      "launch": { "runner": "claude", "model": "<id>", "effort": "<level>" }
    }
  }
}
```

`launch` is opaque to the resolver: the caller interprets and validates it. An
omitted `families` means the family is unknown. An unknown family cannot satisfy
`distinctFamilies` or `excludeAuthorFamily`, and an unknown author family
cannot be excluded.

## Resolution

1. Layers apply in order user, project, task. A later layer replaces a role's
   whole candidate list; its new roles append. Project preferences count only
   with `--approve-project` equal to the file's SHA-256 revision; otherwise the
   plan is blocked, not silently reduced to the user layer.
2. Policy only tightens: the lowest `roundLimit`, `fallback: none`,
   `meteredRoutes: included-only`, and either layer's `distinctFamilies` or
   `excludeAuthorFamily`. A reduced panel needs the user layer to allow it and no
   other layer to forbid it.
3. A candidate is skipped, with a reason, when it has no binding, an unknown or
   author family under strict policy, or a metered route (never allowed under
   `included-only`; under `explicit-approval-required` only with
   `--approve-metered <alias>`). With
   `fallback: none` only the first candidate of each role is tried.
4. A role with no eligible candidate blocks the plan, or is dropped when a
   reduced panel is allowed. Distinct families are found by trying later
   candidates; if no combination works the plan is blocked.

The plan lists each seat, every skipped candidate and the round limit. It
certifies configuration only, not availability, quota or effective effort.
