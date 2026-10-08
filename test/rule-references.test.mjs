import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { compose, composeConfiguration, loadFragments } from "../composition.mjs";
import { scratch } from "./fixture.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const selected = { modifiers: ["release-batching"], skills: { include: [] } };
const cli = (args) =>
  spawnSync(process.execPath, [join(root, "compose.mjs"), ...args], { encoding: "utf8" });

test("inline callers and disabled modifiers preserve policy without requiring a bundle", (t) => {
  const dir = scratch(t, "reference-inline-");
  const full = composeConfiguration(selected, dir);
  assert.match(full.rules, /Every release's notes must/);
  assert.equal(full.references.size, 0);
  assert.equal(
    compose(readFileSync(join(root, "rules/core.md"), "utf8"), loadFragments(selected, dir)),
    full.rules,
  );
  assert.throws(
    () => composeConfiguration(selected, dir, { referencesDirectory: "" }),
    /non-empty string/,
  );
  const disabled = composeConfiguration({ skills: { include: [] } }, dir, {
    referencesDirectory: "resources",
  });
  assert.doesNotMatch(disabled.rules, /## Release batching/);
  assert.equal(disabled.references.size, 0);
  const config = join(dir, "config.json");
  writeFileSync(config, JSON.stringify(selected));
  const result = cli(["--config", config]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, full.rules);
  assert.deepEqual(Object.keys(selected), ["modifiers", "skills"]);
});

test("copied rules retain the full procedure with no skills or source checkout", (t) => {
  const dir = scratch(t, "reference-copy-");
  const source = join(dir, "source");
  mkdirSync(source);
  for (const name of [
    "compose.mjs",
    "composition.mjs",
    "rule-references.mjs",
    "config.mjs",
    "config-view.mjs",
    "setup.mjs",
    "rules",
    "skills",
  ])
    cpSync(join(root, name), join(source, name), { recursive: true });
  const config = join(dir, "config.json");
  writeFileSync(config, JSON.stringify(selected));
  const out = join(dir, "output", "rules.md");
  execFileSync(process.execPath, [join(source, "compose.mjs"), "--config", config, "--out", out]);
  rmSync(source, { recursive: true });
  const rules = readFileSync(out, "utf8");
  const link = /\[the release procedure\]\(([^)]+)\)/.exec(rules)[1];
  const procedure = readFileSync(join(dirname(out), decodeURI(link)), "utf8");
  assert.match(procedure, /Every release's notes must/);
  assert.match(procedure, /adds no permission to tag, publish or change release automation/);
  assert.doesNotMatch(rules, /Record completed changes in the repository's pending-release record/);
  const copied = join(dir, "another-host");
  cpSync(dirname(out), copied, { recursive: true });
  assert.equal(readFileSync(join(copied, decodeURI(link)), "utf8"), procedure);
});

test("repeat export updates owned files and rejects reference drift before changing rules", (t) => {
  const dir = scratch(t, "reference-drift-");
  const config = join(dir, "config.json");
  writeFileSync(config, JSON.stringify(selected));
  const out = join(dir, "rules.md"),
    refs = join(dir, "refs with space");
  const args = ["--config", config, "--out", out, "--references-out", refs];
  assert.equal(cli(args).status, 0);
  const before = readFileSync(out, "utf8");
  const manifest = readFileSync(join(refs, "manifest.json"), "utf8");
  assert.equal(cli(args).status, 0);
  assert.equal(readFileSync(join(refs, "manifest.json"), "utf8"), manifest);
  assert.match(before, /refs%20with%20space\/release-batching.md/);
  writeFileSync(join(refs, "release-batching.md"), "User changes");
  writeFileSync(out, "Existing rules");
  const rejected = cli(args);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /Modified or missing reference/);
  assert.equal(readFileSync(out, "utf8"), "Existing rules");
  assert.equal(readFileSync(join(refs, "release-batching.md"), "utf8"), "User changes");
});

test("invalid source references and overlapping or unmanaged destinations write nothing", (t) => {
  const dir = scratch(t, "reference-reject-");
  const layer = join(dir, "nested", "rules");
  mkdirSync(layer, { recursive: true });
  writeFileSync(join(dir, "outside.md"), "## Outside\n\nOutside source layer.\n");
  writeFileSync(
    join(layer, "bad.md"),
    "---\nafter: Landing\nreference: ../../outside.md\n---\n## Outside\n\n[read](../../outside.md)\n",
  );
  const config = join(dir, "config.json"),
    out = join(dir, "rules.md");
  writeFileSync(config, JSON.stringify({ layers: ["nested"] }));
  const escaping = cli(["--config", config, "--out", out]);
  assert.notEqual(escaping.status, 0);
  assert.match(escaping.stderr, /within its source layer/);
  assert.equal(existsSync(out), false);
  rmSync(join(layer, "bad.md"));
  writeFileSync(config, JSON.stringify(selected));
  const refs = join(dir, "house-rules-references");
  mkdirSync(refs);
  writeFileSync(join(refs, "notes.md"), "Unmanaged content");
  const unmanaged = cli(["--config", config, "--out", out]);
  assert.notEqual(unmanaged.status, 0);
  assert.match(unmanaged.stderr, /Unmanaged reference directory/);
  assert.equal(existsSync(out), false);
  assert.notEqual(
    cli(["--config", config, "--out", join(refs, "rules.md"), "--references-out", refs]).status,
    0,
  );
  assert.equal(existsSync(join(refs, "rules.md")), false);
  for (const flag of ["--references-out", "--skills-out"]) {
    const file = join(dir, flag.slice(2), "rules.md");
    const result = cli(["--config", config, "--out", file, flag, join(file, "nested")]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Output paths must not overlap/);
    assert.equal(existsSync(file), false);
  }
});

test("a personal replacement omits the overridden public reference from resource output", (t) => {
  const dir = scratch(t, "reference-replace-");
  mkdirSync(join(dir, "rules"));
  writeFileSync(
    join(dir, "rules", "release.md"),
    "---\nreplaces: Release batching\n---\n## Release batching\n\nPersonal release procedure.\n",
  );
  const result = composeConfiguration(selected, dir, { referencesDirectory: "resources" });
  assert.match(result.rules, /Personal release procedure/);
  assert.equal(result.references.size, 0);
});
