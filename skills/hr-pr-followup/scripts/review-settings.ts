// Settings the review gate cannot know. Both read the environment at call time; unset means none.

// A private review App posts as its own bot, so its review and any check named for it are
// review-bot output rather than ordinary CI that must pass. HR_PRIVATE_REVIEWER names its login
// (with or without "[bot]"); unset means there is no private reviewer and none is required.
export function privateReviewerLogin(): string | undefined {
  const login = process.env.HR_PRIVATE_REVIEWER?.trim()
    .replace(/\[bot\]$/i, "")
    .toLowerCase();
  if (login === undefined || login === "") {
    return undefined;
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(login)) {
    throw new Error(`HR_PRIVATE_REVIEWER must be a GitHub App login, got "${login}"`);
  }
  return login;
}

export function isPrivateReviewer(name: string): boolean {
  const login = privateReviewerLogin();
  return login !== undefined && name.toLowerCase().replace(/\[bot\]$/, "") === login;
}

// Checks that only observe a pull request. Queued, running or failed, they never refuse a landing.
// HR_ADVISORY_CHECKS lists their names, comma separated.
export function advisoryChecks(): Set<string> {
  return new Set(
    (process.env.HR_ADVISORY_CHECKS ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry !== ""),
  );
}
