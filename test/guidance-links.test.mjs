import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { auditLocalLinks, remoteLocalLinks } from "../guidance-links.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositories = { "example/project": root };

test("finds local guidance pointers in inline, reference and bare links", () => {
  const urls = [
    "[rules](https://github.com/example/project/blob/main/rules/core.md#writing)",
    "[rules]: https://github.com/example/project/blob/HEAD/rules/core.md",
    "Read https://github.com/example/project/tree/master/skills/",
  ];
  const found = remoteLocalLinks(urls.join("\n"), repositories);
  assert.deepEqual(
    found.map(({ line }) => line),
    [1, 2, 3],
  );
  assert.equal(found[0].target, resolve(root, "rules/core.md"));
  assert.equal(found[0].anchor, "writing");
});

test("preserves sources, history, downloads, rendering and documented upstream refresh", () => {
  const remote = "https://github.com/example/project";
  const text = [
    `${remote}/blob/0123456789abcdef/rules/core.md`,
    `${remote}/blob/v1.2.3/rules/core.md`,
    `${remote}/issues/1`,
    `${remote}/pull/2`,
    "https://github.com/external/source/blob/main/README.md",
    `![preview](${remote}/blob/main/image.png)`,
    `![spaced]( ${remote}/blob/main/image.png)`,
    `![reference][preview]`,
    `[preview]: ${remote}/blob/main/image.png`,
    `[provenance](${remote}/blob/main/README.md) <!-- local-reference: source Cite current upstream provenance. -->`,
    `    curl ${remote}/blob/main/install.sh`,
    `${remote}/blob/main/AGENTS.md <!-- local-reference: remote-refresh Fetch newest upstream guidance explicitly. -->`,
    "~~~sh",
    `curl ${remote}/blob/main/install.sh`,
    "~~~",
    "https://raw.githubusercontent.com/example/project/main/install.sh",
  ].join("\n");
  assert.deepEqual(remoteLocalLinks(text, repositories), []);
});

test("missing local targets still require reconciliation instead of being overlooked", () => {
  const found = remoteLocalLinks(
    "https://github.com/example/project/blob/main/missing.md",
    repositories,
  );
  assert.equal(found.length, 1);
});

test("an image reference reused for guidance is still checked", () => {
  const text =
    "![image][shared]\n[read][shared]\n[shared]: https://github.com/example/project/blob/main/README.md";
  assert.equal(remoteLocalLinks(text, repositories).length, 1);
  assert.equal(
    remoteLocalLinks("https://github.com/EXAMPLE/Project/blob/main/README.md", repositories).length,
    1,
  );
});

test("repository guidance keeps its operational pointers local", () => {
  assert.deepEqual(auditLocalLinks(root, { "bompus/house-rules": root }), []);
});
