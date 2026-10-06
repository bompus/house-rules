import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function scratch(t, prefix = "house-rules-") {
  const dir = mkdtempSync(join(process.env.HOUSE_RULES_TEST_TMP ?? tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
