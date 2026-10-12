import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dir, "../scripts/benefit-chart.py");
const hasMatplotlib =
  Bun.spawnSync(["python3", "-c", "import matplotlib"], { stderr: "ignore" }).exitCode === 0;
const dirs: string[] = [];

function chart(spec: object) {
  const dir = mkdtempSync(join(process.env.HOUSE_RULES_TEST_TMP ?? tmpdir(), "benefit-chart-"));
  dirs.push(dir);
  const specPath = join(dir, "spec.json");
  const out = join(dir, "chart.png");
  writeFileSync(specPath, JSON.stringify(spec));
  const result = Bun.spawnSync(["python3", "-I", script, specPath, out]);
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

  test("reports a missing baseline instead of dividing by zero", () => {
    const { result, alt } = chart({
      headline: "Allocations",
      rows: [{ label: "Calls", before: 0, after: 5, unit: "" }],
    });
    expect(result.exitCode).toBe(0);
    expect(alt).toContain("Calls: 0 to 5");
  });
});
