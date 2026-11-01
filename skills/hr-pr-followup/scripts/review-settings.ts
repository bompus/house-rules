// Settings the review gate cannot know. Both read the environment at call time; unset means none.

// A private review App posts as its own bot, so its review and any check named for it are
// review-bot output rather than ordinary CI that must pass. HR_PRIVATE_REVIEWER names its login
// (with or without "[bot]"); unset means there is no private reviewer and none is required.
export function privateReviewerLogin(): string | undefined {
  const raw = process.env.HR_PRIVATE_REVIEWER?.trim();
  if (raw === undefined || raw === "") {
    return undefined;
  }
  const login = raw.replace(/\[bot\]$/i, "").toLowerCase();
  // GitHub logins are at most 39 characters of letters, digits and hyphens, with no hyphen at either end.
  if (!/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/.test(login)) {
    throw new Error(`HR_PRIVATE_REVIEWER must be a GitHub App login, got "${raw}"`);
  }
  return login;
}

export function isPrivateReviewer(name: string): boolean {
  const login = privateReviewerLogin();
  return login !== undefined && name.toLowerCase().replace(/\[bot\]$/, "") === login;
}

// Checks that only observe a pull request. Queued, running or failed, they never refuse a landing.
// HR_ADVISORY_CHECKS is a JSON array of their names, since a check name can hold a comma
// ("test (ubuntu, 20)").
export function advisoryChecks(): Set<string> {
  const raw = process.env.HR_ADVISORY_CHECKS?.trim();
  if (raw === undefined || raw === "") {
    return new Set();
  }
  let names: unknown;
  try {
    names = JSON.parse(raw);
  } catch {
    names = undefined;
  }
  if (!Array.isArray(names) || !names.every((name) => typeof name === "string")) {
    throw new Error(
      'HR_ADVISORY_CHECKS must be a JSON array of check names, for example ["observe (linux, x64)"]',
    );
  }
  return new Set(names);
}

// Read both settings once, so a malformed value fails before any review state is judged.
export function validateReviewSettings(): void {
  privateReviewerLogin();
  advisoryChecks();
}
