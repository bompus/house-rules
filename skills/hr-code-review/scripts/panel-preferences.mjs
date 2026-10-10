// Portable panel preferences and a pure resolver. See ../references/panel-plan.md.
// Exact model/provider bindings come from a user-owned file; nothing here calls a model.
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const alias = /^[a-z][a-z0-9-]{0,63}$/;

function keys(value, required, optional, path) {
  if (!object(value)) throw new Error(`${path} must be an object`);
  for (const key of required)
    if (!Object.hasOwn(value, key)) throw new Error(`${path}.${key} is required`);
  for (const key of Object.keys(value))
    if (![...required, ...optional].includes(key)) throw new Error(`unknown ${path}.${key}`);
}

export function validatePanelPreferences(value) {
  keys(value, ["version", "roles", "policy"], ["profile"], "panel");
  if (value.version !== 1) throw new Error("panel.version must be 1");
  if (value.profile !== undefined && !["quick", "balanced", "deep"].includes(value.profile))
    throw new Error("panel.profile must be quick, balanced or deep");
  if (!Array.isArray(value.roles) || value.roles.length === 0)
    throw new Error("panel.roles must be a non-empty array");
  const ids = new Set();
  for (const [index, role] of value.roles.entries()) {
    const path = `panel.roles[${index}]`;
    keys(role, ["id", "candidates"], [], path);
    if (typeof role.id !== "string" || !alias.test(role.id))
      throw new Error(`${path}.id must be a lowercase alias (letters, digits and hyphens)`);
    if (ids.has(role.id)) throw new Error(`duplicate panel role "${role.id}"`);
    ids.add(role.id);
    if (
      !Array.isArray(role.candidates) ||
      role.candidates.length === 0 ||
      role.candidates.some((candidate) => typeof candidate !== "string" || !alias.test(candidate))
    )
      throw new Error(`${path}.candidates must be a non-empty array of lowercase aliases`);
    if (new Set(role.candidates).size !== role.candidates.length)
      throw new Error(`${path}.candidates contains duplicates`);
  }
  keys(
    value.policy,
    ["fallback", "roundLimit", "meteredRoutes"],
    ["distinctFamilies", "excludeAuthorFamily", "allowReducedPanel"],
    "panel.policy",
  );
  for (const key of ["distinctFamilies", "excludeAuthorFamily", "allowReducedPanel"])
    if (value.policy[key] !== undefined && typeof value.policy[key] !== "boolean")
      throw new Error(`panel.policy.${key} must be boolean`);
  if (!["none", "approved-only"].includes(value.policy.fallback))
    throw new Error("panel.policy.fallback must be none or approved-only");
  if (!Number.isSafeInteger(value.policy.roundLimit) || value.policy.roundLimit < 1)
    throw new Error("panel.policy.roundLimit must be a positive safe integer");
  if (!["included-only", "explicit-approval-required"].includes(value.policy.meteredRoutes))
    throw new Error(
      "panel.policy.meteredRoutes must be included-only or explicit-approval-required",
    );
}

export function changePanelPreferences(config, value) {
  validatePanelPreferences(value);
  return { ...structuredClone(config), panel: structuredClone(value) };
}

const familyName = /^[a-z][a-z0-9-]{0,63}$/;

export function validatePanelBindings(value) {
  keys(value, ["version", "aliases"], [], "bindings");
  if (value.version !== 1) throw new Error("bindings.version must be 1");
  if (!object(value.aliases)) throw new Error("bindings.aliases must be an object");
  for (const [name, binding] of Object.entries(value.aliases)) {
    const path = `bindings.aliases.${name}`;
    if (!alias.test(name))
      throw new Error(`${path}: alias must be lowercase letters, digits and hyphens`);
    keys(binding, ["launch"], ["families", "metered"], path);
    if (!object(binding.launch) || Object.keys(binding.launch).length === 0)
      throw new Error(`${path}.launch must be a non-empty object`);
    if (
      binding.families !== undefined &&
      (!Array.isArray(binding.families) ||
        binding.families.length === 0 ||
        binding.families.some((family) => typeof family !== "string" || !familyName.test(family)) ||
        new Set(binding.families).size !== binding.families.length)
    )
      throw new Error(`${path}.families must be a non-empty array of distinct lowercase names`);
    if (binding.metered !== undefined && typeof binding.metered !== "boolean")
      throw new Error(`${path}.metered must be boolean`);
  }
}

// Project and task layers may only tighten the user's policy.
function combinePolicy(layers) {
  const policies = layers.map((layer) => layer.policy);
  const [user] = policies;
  return {
    fallback: policies.some((p) => p.fallback === "none") ? "none" : "approved-only",
    roundLimit: Math.min(...policies.map((p) => p.roundLimit)),
    meteredRoutes: policies.some((p) => p.meteredRoutes === "included-only")
      ? "included-only"
      : "explicit-approval-required",
    distinctFamilies: policies.some((p) => p.distinctFamilies === true),
    excludeAuthorFamily: policies.some((p) => p.excludeAuthorFamily === true),
    allowReducedPanel:
      user.allowReducedPanel === true && policies.every((p) => p.allowReducedPanel !== false),
  };
}

// A later layer replaces a role's whole ordered candidate list; new role ids append.
function combineRoles(layers) {
  const roles = new Map();
  for (const layer of layers)
    for (const role of layer.roles) roles.set(role.id, [...role.candidates]);
  return [...roles].map(([id, candidates]) => ({ id, candidates }));
}

function assign(roles, index, taken, chosen, distinct) {
  if (index === roles.length) return chosen;
  for (const option of roles[index].options) {
    if (distinct && option.families.some((family) => taken.has(family))) continue;
    const next = assign(
      roles,
      index + 1,
      new Set([...taken, ...option.families]),
      [...chosen, { role: roles[index].id, ...option }],
      distinct,
    );
    if (next) return next;
  }
  return null;
}

/**
 * request: { user, project?, task?, bindings, authorFamilies?, approvals?: { project?, metered? } }
 * Returns { ok, seats, reduced, rejected, blockers, roundLimit, policy }; never launches a seat.
 */
export function resolvePanel(request) {
  const { user, project, task, bindings, authorFamilies = [], approvals = {} } = request;
  validatePanelPreferences(user);
  validatePanelBindings(bindings);
  const blockers = [];
  const layers = [user];
  for (const [name, layer] of [
    ["project", project],
    ["task", task],
  ]) {
    if (layer === undefined) continue;
    validatePanelPreferences(layer);
    if (name === "project" && approvals.project !== true)
      blockers.push({ message: "project panel preferences are not approved" });
    else layers.push(layer);
  }
  const policy = combinePolicy(layers);
  const strictFamilies = policy.distinctFamilies || policy.excludeAuthorFamily;
  if (policy.excludeAuthorFamily && authorFamilies.length === 0)
    blockers.push({ message: "author family is unknown, so it cannot be excluded" });
  const metered = new Set(approvals.metered ?? []);
  const rejected = [];
  const reduced = [];
  const roles = [];
  for (const role of combineRoles(layers)) {
    const options = [];
    const candidates = policy.fallback === "none" ? role.candidates.slice(0, 1) : role.candidates;
    for (const name of candidates) {
      const binding = Object.hasOwn(bindings.aliases, name) ? bindings.aliases[name] : undefined;
      const reject = (reason) => rejected.push({ role: role.id, alias: name, reason });
      if (binding === undefined) reject("no binding for this alias");
      else if (strictFamilies && binding.families === undefined) reject("model family is unknown");
      else if (
        policy.excludeAuthorFamily &&
        binding.families.some((f) => authorFamilies.includes(f))
      )
        reject("shares a model family with the author");
      else if (binding.metered === true && policy.meteredRoutes === "included-only")
        reject("metered route is not allowed by an included-only policy");
      else if (binding.metered === true && !metered.has(name))
        reject("metered route needs explicit approval");
      else
        options.push({
          alias: name,
          families: binding.families ?? [],
          metered: binding.metered === true,
          launch: binding.launch,
        });
    }
    if (options.length > 0) roles.push({ id: role.id, options });
    else if (policy.allowReducedPanel) reduced.push(role.id);
    else blockers.push({ role: role.id, message: `no eligible route for role "${role.id}"` });
  }
  let seats = [];
  if (blockers.length === 0) {
    if (roles.length === 0) blockers.push({ message: "no role has an eligible route" });
    else {
      seats = assign(roles, 0, new Set(), [], policy.distinctFamilies);
      if (seats === null) {
        seats = [];
        blockers.push({ message: "no assignment gives every seat a distinct model family" });
      }
    }
  }
  return {
    ok: blockers.length === 0,
    seats,
    reduced,
    rejected,
    blockers,
    roundLimit: policy.roundLimit,
    policy,
  };
}

export function formatPanelPlan(plan) {
  const lines = [plan.ok ? "Panel plan (no model has been called):" : "Panel blocked:"];
  for (const seat of plan.seats) {
    const families = seat.families.length > 0 ? seat.families.join("+") : "unknown";
    lines.push(`  ${seat.role}: ${seat.alias} (${families}${seat.metered ? ", metered" : ""})`);
  }
  for (const role of plan.reduced) lines.push(`  ${role}: dropped, no eligible route`);
  for (const blocker of plan.blockers) lines.push(`  blocker: ${blocker.message}`);
  for (const item of plan.rejected)
    lines.push(`  skipped ${item.alias} for ${item.role}: ${item.reason}`);
  lines.push(`  rounds: ${plan.roundLimit}`);
  return lines.join("\n");
}
