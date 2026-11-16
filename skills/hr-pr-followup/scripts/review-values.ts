// Shape checks for GitHub API values and the required-check list, shared by check-pr-review.ts.

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("malformed API object");
  }
  return value as Record<string, unknown>;
}
export function text(value: unknown): value is string {
  return typeof value === "string";
}
export function date(value: unknown): boolean {
  return text(value) && Number.isFinite(Date.parse(value));
}
export function author(value: unknown): boolean {
  if (value === null) {
    return true;
  }
  const a = record(value);
  return (
    text(a.__typename) &&
    ["Bot", "EnterpriseUserAccount", "Mannequin", "Organization", "User"].includes(a.__typename) &&
    text(a.login)
  );
}
/** Names of the checks the base branch requires; rejects a missing base ref or a partial rule list. */
export function requiredCheckNames(baseRef: unknown): string[] {
  const ref = record(baseRef);
  const rules = record(ref.rules);
  if (record(rules.pageInfo).hasNextPage !== false || !Array.isArray(rules.nodes)) {
    throw new Error("base branch rules are incomplete");
  }
  const names = new Set<string>();
  const add = (value: unknown) => {
    if (!text(value)) {
      throw new Error("malformed required check");
    }
    names.add(value);
  };
  if (ref.branchProtectionRule !== null) {
    const rule = record(ref.branchProtectionRule);
    const contexts = rule.requiredStatusCheckContexts;
    const checks = rule.requiredStatusChecks;
    if (!Array.isArray(contexts) || !Array.isArray(checks)) {
      throw new Error("malformed branch protection rule");
    }
    for (const context of contexts) {
      add(context);
    }
    for (const check of checks) {
      add(record(check).context);
    }
  }
  for (const node of rules.nodes) {
    const rule = record(node);
    if (!text(rule.type)) {
      throw new Error("malformed base branch rule");
    }
    if (rule.type !== "REQUIRED_STATUS_CHECKS") {
      continue;
    }
    const checks = record(rule.parameters).requiredStatusChecks;
    if (!Array.isArray(checks)) {
      throw new Error("malformed required checks rule");
    }
    for (const check of checks) {
      add(record(check).context);
    }
  }
  return [...names].sort();
}
