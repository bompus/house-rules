import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dir, "../scripts/benefit-chart.py");
const hasMatplotlib =
  Bun.spawnSync(["python3", "-I", "-c", "import matplotlib"], { stderr: "ignore" }).exitCode === 0;
const dirs: string[] = [];

function chart(spec: object, extra: string[] = []) {
  const dir = mkdtempSync(join(process.env.HOUSE_RULES_TEST_TMP ?? tmpdir(), "benefit-chart-"));
  dirs.push(dir);
  const specPath = join(dir, "spec.json");
  const out = join(dir, "chart.png");
  writeFileSync(specPath, JSON.stringify(spec));
  const result = Bun.spawnSync(["python3", "-I", script, specPath, out, ...extra]);
  return { result, alt: result.stdout.toString().trim(), out };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!hasMatplotlib)("benefit-chart.py", () => {
  test("labels an improvement, a regression and a change inside the band", () => {
    const { result, alt, out } = chart({
      headline: "Opening a thread takes 371 ms, was 927 ms",
      rows: [
        { label: "Open", before: 927, after: 371, unit: "ms", words: ["faster", "slower"] },
        { label: "Memory", before: 100, after: 130, unit: "MiB" },
        { label: "Idle", before: 100, after: 101, unit: "ms" },
        { label: "Throughput", before: 100, after: 150, unit: "ops/s", lower_is_better: false },
      ],
    });
    expect(result.exitCode).toBe(0);
    expect(alt).toContain("Open: 927 ms to 371 ms, 60% faster (2.5×)");
    expect(alt).toContain("Memory: 100 MiB to 130 MiB, 30% higher");
    expect(alt).toContain("Idle: 100 ms to 101 ms, no clear change");
    expect(alt).toContain("Throughput: 100 ops/s to 150 ops/s, 50% higher (1.5×)");
    expect(readFileSync(out).subarray(1, 4).toString()).toBe("PNG");
  });

  test("prints the same values as a Markdown table with --table", () => {
    const { result } = chart(
      {
        headline: "Build time",
        arms: ["Main", "Branch"],
        rows: [
          { label: "Build", before: 67.741, after: 46.181, unit: "s", words: ["faster", "slower"] },
        ],
      },
      ["--table"],
    );
    const out = result.stdout.toString();
    expect(out).toContain("| Metric | Main | Branch | Change |");
    expect(out).toContain("| Build | 67.7 s | 46.2 s | 32% faster |");
  });

  test("never rounds a near-total reduction up to 100%", () => {
    const { result, alt } = chart({
      headline: "Node read takes 0.08 ms, was 119 ms",
      rows: [{ label: "Read", before: 119.1, after: 0.083, unit: "ms" }],
    });
    expect(result.exitCode).toBe(0);
    expect(alt).toContain("Read: 119 ms to 0.083 ms, 99.9% lower (1,434.9×)");
  });

  test("carries the chart notes into the alt text and the table", () => {
    const { alt } = chart(
      {
        headline: "Renders per switch: 2, was 9",
        note: "Lower is better.",
        rows: [{ label: "Renders", before: 9, after: 2, unit: "", note: "Dev build only." }],
      },
      ["--table"],
    );
    expect(alt).toContain("Renders per switch: 2, was 9. Lower is better.");
    expect(alt).toContain("Renders: 9 to 2, 78% lower (4.5×) (Dev build only.)");
    expect(alt).toContain("Renders: Dev build only.");
  });

  test("rejects negative values instead of drawing them", () => {
    const { result } = chart({
      headline: "Delta",
      rows: [{ label: "Gain", before: -100, after: -50 }],
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("negative values are not supported");
  });

  test("reports a missing baseline instead of dividing by zero", () => {
    const { result, alt } = chart({
      headline: "Allocations",
      rows: [{ label: "Calls", before: 0, after: 5, unit: "" }],
    });
    expect(result.exitCode).toBe(0);
    expect(alt).toContain("Calls: 0 to 5");
  });
});
