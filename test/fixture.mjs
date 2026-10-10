import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function scratch(t, prefix = "house-rules-") {
  const dir = mkdtempSync(join(process.env.HOUSE_RULES_TEST_TMP ?? tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export const panelPreferences = {
  version: 1,
  profile: "deep",
  roles: [
    { id: "correctness", candidates: ["review-primary", "review-alternative"] },
    { id: "contrarian", candidates: ["challenge-primary"] },
  ],
  policy: {
    fallback: "approved-only",
    roundLimit: 1,
    meteredRoutes: "explicit-approval-required",
    distinctFamilies: true,
    excludeAuthorFamily: true,
    allowReducedPanel: false,
  },
};
