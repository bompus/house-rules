import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

// Exercise the workflow's actual release guard rather than a second implementation.
const workflow = readFileSync(
  new URL("../.github/workflows/npm-publish.yml", import.meta.url),
  "utf8",
);
const block = workflow.split("bun run - <<'JS'\n")[1]?.split("\n          JS")[0] ?? "";
const guard = block.replace(/^ {10}/gm, "").replace(/^import .*;\n/gm, "");

/**
 * @param {string} heading
 * @param {string} [tag]
 */
function check(heading, tag = "v0.10.0") {
  runInNewContext(guard, {
    assert,
    process: { env: { RELEASE_TAG: tag } },
    readFileSync: (/** @type {string} */ file) =>
      file === "package.json" ? '{"version":"0.10.0"}' : heading,
  });
}

test("npm release guard requires the exact version and a complete valid date", () => {
  check("## 0.10.0 - 2026-10-06");
  check("## 0.10.0 - 2028-02-29\r\n");
  for (const heading of [
    "## Unreleased",
    "## 0.10.0 - TBD",
    "## 0.10.0 - 2026-02-30",
    "## 0.10.0 - 2026-02-29",
    "## 0.10.0 - 2026-13-01",
    "## 0.10.0 - 2026-10-06 trailing",
    "text ## 0.10.0 - 2026-10-06",
    "## 0.11.0 - 2026-10-06",
  ]) {
    assert.throws(() => check(heading), `Accepted ${heading}`);
  }
  assert.throws(() => check("## 0.10.0 - 2026-10-06", "v0.11.0"));
});

const registryBlock = workflow.split("bun run - <<'JS'\n")[2]?.split("\n          JS")[0] ?? "";
const registryGuard = registryBlock.replace(/^ {10}/gm, "").replace(/^import .*;\n/gm, "");
test("registry guard preserves duplicate publication and integrity refusal under Bun", async () => {
  const tarball = Buffer.from("saved tarball");
  const { createHash } = await import("node:crypto");
  const integrity = `sha512-${createHash("sha512").update(tarball).digest("base64")}`;
  for (const [status, existingIntegrity, expected] of [
    [404, "", "published=false\n"],
    [200, integrity, "published=true\n"],
    [200, "different", null],
    [503, "", null],
  ]) {
    /** @type {string[]} */
    const writes = [];
    const result = runInNewContext(`(async () => {${registryGuard}\n})()`, {
      assert,
      createHash,
      process: { env: { GITHUB_OUTPUT: "output", RUNNER_TEMP: "artifact" } },
      readFileSync: (/** @type {string} */ file) =>
        file === "package.json" ? '{"name":"fixture","version":"0.10.0"}' : tarball,
      appendFileSync: (/** @type {string} */ file, /** @type {string} */ text) => {
        assert.equal(file, "output");
        writes.push(text);
      },
      fetch: async () => ({
        status,
        ok: status === 200,
        json: async () => ({ dist: { integrity: existingIntegrity } }),
      }),
    });
    if (expected === null) {
      await assert.rejects(result);
      assert.deepEqual(writes, []);
    } else {
      await result;
      assert.deepEqual(writes, [expected]);
    }
  }
});
