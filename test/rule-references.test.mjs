import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { compose, composeConfiguration, loadFragments, parseFragment } from "../composition.mjs";
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
  assert.deepEqual([...disabled.references.keys()], ["landing.md"]);
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
  writeFileSync(
    config,
    JSON.stringify({ ...selected, modifiers: [...selected.modifiers, "multi-agent"] }),
  );
  const out = join(dir, "output", "rules.md");
  execFileSync(process.execPath, [join(source, "compose.mjs"), "--config", config, "--out", out]);
  rmSync(source, { recursive: true });
  const rules = readFileSync(out, "utf8");
  const link = /\[the release procedure\]\(([^)]+)\)/.exec(rules)[1];
  const landing = /\[the landing procedure\]\(([^)]+)\)/.exec(rules)[1];
  const agents = /\[the agent-work procedure\]\(([^)]+)\)/.exec(rules)[1];
  const agentProcedure = readFileSync(join(dirname(out), decodeURI(agents)), "utf8");
  assert.equal(agentProcedure, readFileSync(join(root, "rules/references/multi-agent.md"), "utf8"));
  assert.match(readFileSync(join(dirname(out), decodeURI(landing)), "utf8"), /After integration:/);
  const procedure = readFileSync(join(dirname(out), decodeURI(link)), "utf8");
  assert.match(procedure, /Every release's notes must/);
  assert.match(procedure, /adds no permission to tag, publish or change release automation/);
  assert.doesNotMatch(rules, /Record completed changes in the repository's pending-release record/);
  const copied = join(dir, "another-host");
  cpSync(dirname(out), copied, { recursive: true });
  assert.equal(readFileSync(join(copied, decodeURI(link)), "utf8"), procedure);
  assert.equal(readFileSync(join(copied, decodeURI(agents)), "utf8"), agentProcedure);
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
  for (const invalid of ["{", "null"]) {
    writeFileSync(join(refs, "manifest.json"), invalid);
    const malformed = cli(args);
    assert.notEqual(malformed.status, 0);
    assert.match(malformed.stderr, /Invalid reference manifest:/);
    assert.ok(malformed.stderr.includes(join(refs, "manifest.json")));
    assert.equal(readFileSync(out, "utf8"), before);
    assert.equal(readFileSync(join(refs, "manifest.json"), "utf8"), invalid);
  }
  writeFileSync(join(refs, "manifest.json"), manifest);
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
  for (const reference of ["missing.md", ""]) {
    writeFileSync(
      join(layer, "bad.md"),
      `---\nafter: Landing\nreference: ${reference}\n---\n## Missing\n\n[read](${reference})\n`,
    );
    const missing = cli(["--config", config, "--out", out]);
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /reference must be a regular file within its source layer/);
    assert.equal(existsSync(out), false);
  }
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
  assert.equal(result.references.has("release-batching.md"), false);
  assert.deepEqual([...result.references.keys()], ["landing.md"]);
});

test("core landing and selected squash references preserve inline callers and personal overrides", (t) => {
  const dir = scratch(t, "reference-landing-");
  const config = { modifiers: ["squash-landing"], skills: { include: [] } };
  const inline = composeConfiguration(config, dir);
  assert.match(inline.rules, /After integration:/);
  assert.match(inline.rules, /Do not pass `--delete-branch`/);
  assert.equal(
    compose(readFileSync(join(root, "rules/core.md"), "utf8"), [
      parseFragment(
        readFileSync(join(root, "rules/modifiers/squash-landing.md"), "utf8"),
        "squash-landing",
      ),
    ]),
    inline.rules,
  );
  assert.doesNotMatch(inline.rules, /\[the landing procedure\]/);
  assert.equal(inline.references.size, 0);
  const linked = composeConfiguration(config, dir, { referencesDirectory: "resources" });
  assert.deepEqual([...linked.references.keys()].sort(), ["landing.md", "squash-landing.md"]);
  assert.match(linked.rules, /Never bypass required checks/);
  assert.match(linked.rules, /During integration, never switch, reset, force-move or remove/);
  assert.match(linked.references.get("landing.md"), /If the default branch is diverged/);
  assert.match(
    linked.references.get("squash-landing.md"),
    /When an app manages the checkout, leave it/,
  );
  mkdirSync(join(dir, "rules"));
  writeFileSync(
    join(dir, "rules", "landing.md"),
    "---\nreplaces: Landing\n---\n## Landing\n\nPersonal landing procedure.\n",
  );
  const replacement = composeConfiguration(config, dir, { referencesDirectory: "resources" });
  assert.equal(replacement.references.has("landing.md"), false);
  assert.equal(replacement.references.has("squash-landing.md"), true);
  assert.match(replacement.rules, /Personal landing procedure/);
});

test("personal reference replacements can reuse a replaced resource name, but live collisions fail", (t) => {
  const dir = scratch(t, "reference-owned-");
  mkdirSync(join(dir, "rules"));
  mkdirSync(join(dir, "references"));
  for (const [name, heading] of [
    ["landing", "Landing"],
    ["squash-landing", "Squash landing"],
  ]) {
    writeFileSync(
      join(dir, "rules", `${name}.md`),
      `---\nreplaces: ${heading}\nreference: ../references/${name}.md\n---\n## ${heading}\n\nRead [personal procedure](../references/${name}.md).\n`,
    );
    writeFileSync(
      join(dir, "references", `${name}.md`),
      `## ${heading}\n\nPersonal ${name} procedure.\n`,
    );
  }
  assert.throws(
    () =>
      compose(readFileSync(join(root, "rules/core.md"), "utf8"), [
        parseFragment(readFileSync(join(dir, "rules", "landing.md"), "utf8"), "landing"),
      ]),
    /use loadFragments/,
  );
  const config = { modifiers: ["squash-landing"], skills: { include: [] } };
  assert.match(composeConfiguration(config, dir).rules, /Personal landing procedure/);
  const linked = composeConfiguration(config, dir, { referencesDirectory: "resources" });
  assert.match(linked.references.get("landing.md"), /Personal landing procedure/);
  assert.match(linked.references.get("squash-landing.md"), /Personal squash-landing procedure/);
  writeFileSync(
    join(dir, "rules", "landing.md"),
    "---\nafter: Landing\nreference: ../references/landing.md\n---\n## Other\n\nRead [other](../references/landing.md).\n",
  );
  writeFileSync(join(dir, "references", "landing.md"), "## Other\n\nOther procedure.\n");
  assert.throws(
    () => composeConfiguration(config, dir, { referencesDirectory: "resources" }),
    /conflicting reference/,
  );
});

test("agent-work references follow modifier selection and preserve default APIs and replacements", (t) => {
  const dir = scratch(t, "reference-agents-");
  const config = {
    modifiers: ["multi-agent"],
    skills: { include: [], exclude: ["hr-code-review"] },
  };
  const canonical = readFileSync(join(root, "rules/references/multi-agent.md"), "utf8");
  const inline = composeConfiguration(config, dir);
  assert.ok(inline.rules.includes(canonical.trimEnd()));
  assert.equal(inline.references.size, 0);
  assert.equal(
    compose(readFileSync(join(root, "rules/core.md"), "utf8"), [
      parseFragment(
        readFileSync(join(root, "rules/modifiers/multi-agent.md"), "utf8"),
        "multi-agent",
      ),
    ]),
    inline.rules,
  );
  const linked = composeConfiguration(config, dir, { referencesDirectory: "resources" });
  assert.equal(linked.references.get("multi-agent.md"), canonical);
  assert.match(linked.rules, /read \[the agent-work procedure\]\(resources\/multi-agent.md\)/);
  assert.match(linked.rules, /further\s+fixes do not reset that limit/);
  assert.match(linked.rules, /disconnected or resumable session/);
  assert.equal(
    composeConfiguration({ skills: { include: [] } }, dir, {
      referencesDirectory: "resources",
    }).references.has("multi-agent.md"),
    false,
  );
  mkdirSync(join(dir, "rules"));
  writeFileSync(
    join(dir, "rules", "agents.md"),
    "---\nreplaces: Working with other agents\n---\n## Working with other agents\n\nPersonal worker procedure.\n",
  );
  const replaced = composeConfiguration(config, dir, { referencesDirectory: "resources" });
  assert.match(replaced.rules, /Personal worker procedure/);
  assert.equal(replaced.references.has("multi-agent.md"), false);
});
