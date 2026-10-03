import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SKILL = join(import.meta.dirname, "..");
const SCANNER = join(SKILL, "scripts", "scan.mjs");
const FIX = join(SKILL, "test", "fixtures");

function run(...args) {
  const r = spawnSync(process.execPath, [SCANNER, ...args], { cwd: SKILL, encoding: "utf8" });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

function scanJson(...paths) {
  const r = run("--json", ...paths);
  expect(r.code === 0 || r.code === 1).toBe(true);
  return { ...JSON.parse(r.stdout), code: r.code };
}

const rulesIn = (report) => report.findings.map((f) => `${f.rule}@${f.line}`);

describe("rules", () => {
  const cases = [
    ["purple-blue-gradient.css", ["purple-blue-gradient@2"]],
    ["purple-blue-gradient.tsx", ["purple-blue-gradient@2"]],
    [
      "violet-accent.css",
      ["violet-accent@2", "violet-accent@3", "violet-accent@4", "violet-accent@5"],
    ],
    ["violet-accent.html", ["violet-accent@1"]],
    ["gradient-text.css", ["gradient-text@2"]],
    ["frosted-glass.vue", ["frosted-glass@2", "frosted-glass@5"]],
    ["neon-glow.css", ["neon-glow@2"]],
    // Line 6 (plain paragraph) and line 7 (copyright and trademark signs) stay quiet.
    ["emoji-icon.html", ["emoji-icon@2", "emoji-icon@4"]],
    ["library-default-token.scss", ["library-default-token@1"]],
    ["tracked-caps.css", ["tracked-caps@3"]],
    ["tracked-caps.jsx", ["tracked-caps@1"]],
  ];
  for (const [file, expected] of cases) {
    test(`${file} reports exactly ${expected.join(", ")}`, () => {
      expect(rulesIn(scanJson(join(FIX, file)))).toEqual(expected);
    });
  }

  test("each finding carries rule, severity, file:line, trimmed match and hint", () => {
    const [f] = scanJson(join(FIX, "neon-glow.css")).findings;
    expect(f).toEqual({
      rule: "neon-glow",
      severity: "medium",
      file: "test/fixtures/neon-glow.css",
      line: 2,
      match: "box-shadow: 0 0 24px rgba(16, 185, 129, 0.7);",
      hint: expect.any(String),
    });
  });

  test("a gradient line is reported once as a gradient, not again as a violet accent", () => {
    const report = scanJson(join(FIX, "purple-blue-gradient.css"));
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].severity).toBe("high");
  });

  test("one stock sans as the only named face across files is flagged once", () => {
    const report = scanJson(join(FIX, "fonts-one-stock"));
    expect(rulesIn(report)).toEqual(["single-stock-font@1"]);
    expect(report.findings[0].file).toBe("test/fixtures/fonts-one-stock/base.css");
  });

  test("a second named face (monospace aside) clears the font rule", () => {
    expect(scanJson(join(FIX, "fonts-mixed")).findings).toEqual([]);
  });

  test("a single font declaration is not enough to call it everywhere", () => {
    expect(scanJson(join(FIX, "fonts-one-stock", "base.css")).findings).toEqual([]);
  });

  test("clean UI: blue accent, gray with a violet cast, soft shadow, plain caps", () => {
    const report = scanJson(join(FIX, "clean"));
    expect(report.findings).toEqual([]);
    expect(report.filesScanned).toBe(2);
    expect(report.code).toBe(0);
  });
});

describe("walking", () => {
  let dir;
  beforeAll(() => {
    dir = mkdtempSync(join(SKILL, "test", "walk-"));
    for (const skipped of ["node_modules/pkg", "dist", "coverage", ".next"]) {
      mkdirSync(join(dir, skipped), { recursive: true });
      writeFileSync(join(dir, skipped, "x.css"), "a { color: #8b5cf6; }\n");
    }
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "app.svelte"), '<p style="color: #8b5cf6">hi</p>\n');
    writeFileSync(join(dir, "src", "vendor.min.css"), "a{color:#8b5cf6}\n");
    writeFileSync(join(dir, "src", "notes.txt"), "#8b5cf6\n");
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("skips dependency, build and coverage output, minified and unsupported files", () => {
    const report = scanJson(dir);
    expect(report.filesScanned).toBe(1);
    expect(report.findings.map((f) => f.file)).toEqual([
      expect.stringMatching(/src\/app\.svelte$/),
    ]);
  });
});

describe("exit codes and output", () => {
  test("0 when only medium findings and failing at high (the default)", () => {
    expect(run(join(FIX, "violet-accent.html")).code).toBe(0);
  });

  test("--fail-on medium turns the same medium finding into exit 1", () => {
    expect(run("--fail-on", "medium", join(FIX, "violet-accent.html")).code).toBe(1);
    expect(run("--fail-on=medium", join(FIX, "violet-accent.html")).code).toBe(1);
  });

  test("--fail-on low counts low findings; default does not", () => {
    expect(run(join(FIX, "tracked-caps.css")).code).toBe(0);
    expect(run("--fail-on", "low", join(FIX, "tracked-caps.css")).code).toBe(1);
  });

  test("1 when a high finding is present", () => {
    expect(run(join(FIX, "purple-blue-gradient.css")).code).toBe(1);
  });

  test("text output names the finding and prints the scanned file count", () => {
    const r = run(join(FIX, "clean"), join(FIX, "gradient-text.css"));
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("test/fixtures/gradient-text.css:2  medium  gradient-text");
    expect(r.stdout).toContain("Scanned 3 files: 0 high, 1 medium, 0 low");
  });

  test("--json reports the scanned file count and severity counts", () => {
    const report = scanJson(join(FIX, "frosted-glass.vue"));
    expect(report.filesScanned).toBe(1);
    expect(report.counts).toEqual({ high: 0, medium: 0, low: 2 });
  });

  const usage = [
    ["no arguments", []],
    ["an unknown flag", ["--strict", join(FIX, "clean")]],
    ["a missing path", [join(FIX, "does-not-exist")]],
    ["an invalid --fail-on value", ["--fail-on", "critical", join(FIX, "clean")]],
    ["--fail-on with no value", ["--fail-on"]],
    ["zero scannable files", [join(FIX, "no-ui")]],
  ];
  for (const [name, args] of usage) {
    test(`2 for ${name}`, () => {
      const r = run(...args);
      expect(r.code).toBe(2);
      expect(r.stderr).toContain("scan:");
      expect(r.stdout).toBe("");
    });
  }

  test("--help prints usage and exits 0", () => {
    const r = run("--help");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Usage:");
  });
});
