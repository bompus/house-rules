// Portable preferences only. Exact model/provider bindings belong to the host.
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
