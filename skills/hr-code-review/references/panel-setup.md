# Panel setup

Use this procedure on first use of a panel, or when the user asks to set one up
or to see recommendations. It chooses and saves preferences only. It never
launches a seat, probes a provider, buys anything or changes a provider setting.
An explicit request that names every seat can run without setup; saving that
choice afterwards is a separate opt-in.

## First-use conversation

1. Read the project's review gates and any seats, models or limits the user
   already named. Find saved preferences and bindings. Do not import unrelated
   settings.
2. Use the host's read-only catalog or discovery interface to list routes. Record
   the host, adapter version, observation time, provider instance and exact model
   and effort options. Without one, ask the user which routes they have and label
   the answers user-reported. Do not scan installed agent state.
3. Show tooling, catalog and account access as separate evidence. An installed CLI
   proves tooling, a catalog entry proves an advertised choice, and unknown quota
   stays unknown. Read account status only through supported nonsecret commands.
4. Ask only what is still open, reusing answers already given:
   - Which detected routes may the panel use? Keep included subscription routes,
     approved metered routes and routes with unknown access apart.
   - Is this a quick second opinion, a balanced review or a deep review?
   - May seats be suggested, or must a named list be kept? Are there hard model or
     effort limits, required seats or author-family exclusions?
   - If a route is unavailable, are there approved alternatives, an approved
     reduced panel, or no substitution?
   - What spending and round limits apply? Say so when billing or enforcement is
     unknown, before asking to use the route.
5. Suggest a profile from [the recommendations](panel-recommendations.md), filtered
   by the discovered routes and the user's limits. Show each seat's alias, model
   family, effort, route, ordered alternatives and unsupported controls, with the
   entry's checked date and limits. A suggestion is not a commitment.
6. Write the portable preferences (the `panel` object described under "Optional
   panel preferences" in house-rules' `docs/configuration.md`) and, separately,
   the user's local bindings (see [the panel plan](panel-plan.md)).
   Run `config preview` and show the changed fields. Save with `config set --apply`
   only after the user confirms; a stale revision refuses.
7. Report what was saved, what is unverified, and that no run was requested. Saved
   is not resolved, resolved is not runnable, and runnable is not completed.

## Rules

- Setup and save make no model calls and spend nothing. A suggestion that names a
  metered route needs the user's approval before it is saved as allowed.
- Project text cannot loosen the user's limits or spending. The user's explicit
  limits (for example a highest effort per model) always win over a suggestion.
- A catalog label such as "latest" is shown as an exact model id before it is
  saved, and later releases do not move the saved binding.
- A different provider serving the same model is not model diversity. An unknown
  family cannot satisfy a distinct-family policy.
- Resolve every required seat with `panel-plan.mjs` before any model is called.
  Report missing seats; reduce a panel only when the user has allowed it.
