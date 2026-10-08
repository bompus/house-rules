// Check the actual npm tarball and installed CLI without writing host adapters.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.env.npm_execpath;
assert(npm, "Run this check with npm run check:package");
const scratch = mkdtempSync(
  join(process.env.HOUSE_RULES_TEST_TMP ?? tmpdir(), "house-rules-package-"),
);
const run = (file, args, cwd = root) => execFileSync(file, args, { cwd, encoding: "utf8" });
try {
  const [packed] = JSON.parse(
    run(process.execPath, [
      npm,
      "pack",
      "--json",
      "--ignore-scripts",
      "--pack-destination",
      scratch,
    ]),
  );
  const files = new Set(packed.files.map(({ path }) => path));
  for (const required of [
    "compose.mjs",
    "composition.mjs",
    "rule-references.mjs",
    "rules/references/release-batching.md",
    "rules/references/landing.md",
    "rules/references/squash-landing.md",
    "rules/references/multi-agent.md",
    "skills/hr-what-next/references/reporting.md",
    "config.mjs",
    "config-view.mjs",
    "setup.mjs",
    "rules/core.md",
    "LICENSE",
    "THIRD_PARTY_NOTICES.md",
    "docs/configuration.md",
  ])
    assert(files.has(required), `Missing ${required}`);
  for (const path of files)
    assert(
      !/^(?:test|evals|notes|scripts|\.github)\/|^skills\/[^/]+\/test\//.test(path),
      `Unexpected ${path}`,
    );
  const prefix = join(scratch, "installed");
  run(process.execPath, [
    npm,
    "install",
    "--prefix",
    prefix,
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--package-lock=false",
    join(scratch, packed.filename),
  ]);
  const installed = join(prefix, "node_modules", "@bompus", "house-rules");
  const metadata = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
  assert.equal(metadata.name, "@bompus/house-rules");
  assert.equal(metadata.bin["house-rules"], "compose.mjs");
  assert(!metadata.dependencies || Object.keys(metadata.dependencies).length === 0);
  for (const hook of ["preinstall", "install", "postinstall"]) assert(!metadata.scripts?.[hook]);
  assert(
    existsSync(
      join(
        prefix,
        "node_modules",
        ".bin",
        process.platform === "win32" ? "house-rules.cmd" : "house-rules",
      ),
    ),
  );
  const config = join(scratch, "house-rules.json");
  cpSync(join(root, "examples", "person", "house-rules.json"), config);
  // Keep full resource coverage separate from the bounded fresh selection.
  const allSkillsConfig = join(scratch, "all-skills.json");
  writeFileSync(
    allSkillsConfig,
    JSON.stringify({ modifiers: ["release-batching", "squash-landing", "multi-agent"] }),
  );
  const runtimes = [process.execPath, ...(process.argv.includes("--bun") ? ["bun"] : [])];
  for (const [index, runtime] of runtimes.entries()) {
    assert.match(run(runtime, [join(installed, "compose.mjs"), "--list"], scratch), /coded-offers/);
    assert.match(
      run(runtime, [join(installed, "compose.mjs"), "config", "help"], scratch),
      /status/,
    );
    const setup = JSON.parse(
      run(
        runtime,
        [join(installed, "compose.mjs"), "setup", "--json", "--config", config],
        scratch,
      ),
    );
    assert.equal(setup.command, "status");
    assert.equal(setup.applied, null);
    assert(setup.skills.some((skill) => skill.explicitOnly));
    const output = join(scratch, `skills-${index}`);
    run(
      runtime,
      [
        join(installed, "compose.mjs"),
        "--config",
        allSkillsConfig,
        "--out",
        join(scratch, `rules-${index}.md`),
        "--skills-out",
        output,
      ],
      scratch,
    );
    function compare(source, target) {
      for (const entry of readdirSync(source, { withFileTypes: true })) {
        if (entry.name === "test") continue;
        const from = join(source, entry.name),
          to = join(target, entry.name);
        assert(existsSync(to), `Missing installed resource ${to}`);
        if (entry.isDirectory()) compare(from, to);
        else
          assert.deepEqual(
            readFileSync(to),
            readFileSync(from),
            `Changed installed resource ${to}`,
          );
      }
    }
    compare(join(root, "skills"), output);
    const rules = readFileSync(join(scratch, `rules-${index}.md`), "utf8");
    assert.match(rules, /house-rules-references\/release-batching.md/);
    assert.match(rules, /house-rules-references\/landing.md/);
    assert.match(rules, /house-rules-references\/squash-landing.md/);
    assert.match(rules, /house-rules-references\/multi-agent.md/);
    assert.match(rules, /house-rules-references\/reporting.md/);
    assert.equal(
      readFileSync(join(scratch, "house-rules-references", "reporting.md"), "utf8"),
      readFileSync(join(root, "skills/hr-what-next/references/reporting.md"), "utf8"),
    );
    assert.equal(
      readFileSync(join(scratch, "house-rules-references", "multi-agent.md"), "utf8"),
      readFileSync(join(root, "rules/references/multi-agent.md"), "utf8"),
    );
    assert.match(
      readFileSync(join(scratch, "house-rules-references", "landing.md"), "utf8"),
      /After integration:/,
    );
    assert.match(
      readFileSync(join(scratch, "house-rules-references", "squash-landing.md"), "utf8"),
      /When an app manages the checkout, leave it/,
    );
    assert.match(
      readFileSync(join(scratch, "house-rules-references", "release-batching.md"), "utf8"),
      /Every release's notes must/,
    );
  }
  const out = process.argv.indexOf("--out");
  if (out !== -1) {
    assert(process.argv[out + 1], "--out needs a directory");
    const destination = resolve(process.argv[out + 1]);
    mkdirSync(destination, { recursive: true });
    cpSync(join(scratch, packed.filename), join(destination, "house-rules.tgz"));
    console.log(
      JSON.stringify({
        version: packed.version,
        integrity: packed.integrity,
        tarball: join(destination, "house-rules.tgz"),
      }),
    );
  }
  console.log(`Packed CLI and skill resources verified (${files.size} files)`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
