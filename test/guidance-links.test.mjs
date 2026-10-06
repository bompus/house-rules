import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { scratch } from "./fixture.mjs";
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

test("malformed URL escapes report their line and leave the rest of the audit available", () => {
  const found = remoteLocalLinks(
    "https://github.com/example/project/blob/main/100%.md\nhttps://github.com/example/project/blob/main/AGENTS.md",
    repositories,
  );
  assert.equal(found.length, 2);
  assert.equal(found[0].line, 1);
  assert.equal(found[0].error, "Malformed percent-encoding");
  assert.equal(found[0].target, null);
  assert.equal(found[1].target, resolve(root, "AGENTS.md"));
});

test("all remote exceptions need a stated reason", () => {
  for (const marker of ["source", "download", "remote-refresh"]) {
    const url = "https://github.com/example/project/blob/main/AGENTS.md";
    assert.equal(
      remoteLocalLinks(`${url} <!-- local-reference: ${marker} -->`, repositories).length,
      1,
    );
    assert.deepEqual(
      remoteLocalLinks(
        `${url} <!-- local-reference: ${marker} Explicit upstream source. -->`,
        repositories,
      ),
      [],
    );
  }
});

test("audit CLI separates URL queries from paths without stripping encoded filename characters", (t) => {
  const dir = scratch(t, "house-rules-link-queries-");
  execFileSync("git", ["init", "--quiet", dir]);
  const cases = [
    ["https://github.com/example/project/blob/main/README.md?plain=1#intro", "README.md", "intro"],
    [
      "https://raw.githubusercontent.com/example/project/main/README.md?cache=1",
      "README.md",
      undefined,
    ],
    [
      "https://raw.githubusercontent.com/example/project/main/README.md?cache=1#intro",
      "README.md",
      "intro",
    ],
    ["https://github.com/example/project/blob/main/README.md?value=%", "README.md", undefined],
    [
      "https://github.com/example/project/blob/main/what%3F.md?plain=1#section?detail",
      "what?.md",
      "section?detail",
    ],
    [
      "https://raw.githubusercontent.com/example/project/main/hash%23.md?cache=1",
      "hash#.md",
      undefined,
    ],
  ];
  writeFileSync(resolve(dir, "links.md"), cases.map(([url]) => url).join("\n"));
  const findings = JSON.parse(
    execFileSync(
      process.execPath,
      [
        resolve(root, "guidance-links.mjs"),
        "--root",
        dir,
        "--repository",
        `example/project=${dir}`,
      ],
      { encoding: "utf8" },
    ),
  );
  assert.deepEqual(
    findings,
    cases.map(([url, path, anchor], index) => ({
      file: "links.md",
      line: index + 1,
      url,
      repository: "example/project",
      path,
      ...(anchor === undefined ? {} : { anchor }),
      target: resolve(dir, path),
    })),
  );
});

test("repository guidance keeps its operational pointers local", () => {
  assert.deepEqual(auditLocalLinks(root, { "bompus/house-rules": root }), []);
});
