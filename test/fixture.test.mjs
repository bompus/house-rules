import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { scratch } from "./fixture.mjs";

test("failed tests remove their fixtures from the selected scratch root", (t) => {
  const dir = scratch(t);
  const fixtures = join(dir, "fixtures");
  mkdirSync(fixtures);
  const child = join(dir, "failure.test.mjs");
  writeFileSync(
    child,
    `import { test } from "node:test";
import { scratch } from ${JSON.stringify(new URL("./fixture.mjs", import.meta.url).href)};
test("intentional fixture failure", (t) => {
  scratch(t);
  throw new Error("intentional failure");
});`,
  );
  const env = { ...process.env, HOUSE_RULES_TEST_TMP: fixtures };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, [process.versions.bun ? "test" : "--test", child], {
    env,
    encoding: "utf8",
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout + result.stderr, /intentional failure/);
  assert.deepEqual(readdirSync(fixtures), []);
});
