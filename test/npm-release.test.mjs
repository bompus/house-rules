import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

// Exercise the workflow's actual release guard rather than a second implementation.
const workflow = readFileSync(
  new URL("../.github/workflows/npm-publish.yml", import.meta.url),
  "utf8",
);
const block = workflow.split("node --input-type=module <<'JS'\n")[1].split("\n          JS")[0];
const guard = block.replace(/^          /gm, "").replace(/^import .*;\n/gm, "");

function check(heading, tag = "v0.10.0") {
  runInNewContext(guard, {
    assert,
    process: { env: { RELEASE_TAG: tag } },
    readFileSync: (file) => (file === "package.json" ? '{"version":"0.10.0"}' : heading),
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
  ])
    assert.throws(() => check(heading), `Accepted ${heading}`);
  assert.throws(() => check("## 0.10.0 - 2026-10-06", "v0.11.0"));
});
