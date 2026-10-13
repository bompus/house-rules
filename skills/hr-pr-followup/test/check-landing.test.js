import { expect, test as base } from "bun:test";
import { join } from "node:path";

// check-landing.py reads /proc, so it only runs on Linux.
const test = process.platform === "linux" ? base : base.skip;

test("check-landing.py passes its own unit tests", () => {
  const run = Bun.spawnSync(["python3", "-I", join(import.meta.dir, "check-landing.test.py")], {
    stderr: "pipe",
    stdout: "pipe",
  });
  expect(run.stderr.toString()).toMatch(/OK\s*$/);
  expect(run.exitCode).toBe(0);
});
