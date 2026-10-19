import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { scratch } from "./fixture.mjs";

const root = join(import.meta.dirname, "..");
const screen = join(root, "evals/end-of-reply/screen");

// Each screening scenario's `without:` must match its composed rules exactly once, or run.mjs
// stops with exit 2. A rule reworded without its scenario fails here instead of in a model run.
for (const [name, config, dir] of /** @type {[string, object | string, string][]} */ ([
  ["core rules", { modifiers: [], skills: { include: [] } }, screen],
  ["modifier rules", join(screen, "modifiers/config.json"), join(screen, "modifiers")],
])) {
  test(`every ${name} screening scenario names exactly one rule`, (t) => {
    const tmp = scratch(t, "house-rules-screen-");
    const configPath = typeof config === "string" ? config : join(tmp, "config.json");
    if (typeof config !== "string") {
      writeFileSync(configPath, JSON.stringify(config));
    }
    const rules = join(tmp, "rules.md");
    const composed = spawnSync(
      process.execPath,
      [join(root, "compose.mjs"), "--config", configPath, "--out", rules],
      { encoding: "utf8" },
    );
    assert.equal(composed.status, 0, composed.stderr);
    const model = join(tmp, "model.mjs");
    writeFileSync(
      model,
      `process.stdin.resume(); process.stdin.on("end", () => process.stdout.write("x"));`,
    );
    const r = spawnSync(
      process.execPath,
      [
        join(root, "evals/end-of-reply/run.mjs"),
        "--screen",
        "--scenarios",
        dir,
        "--rules",
        rules,
        "--cmd",
        `"${process.execPath}" "${model}"`,
      ],
      { encoding: "utf8" },
    );
    assert.notEqual(r.status, 2, r.stderr);
    assert.match(r.stdout, /^screen \(passes of 1 runs per arm\):$/m);
    // Every scenario file must reach a verdict line, so an empty or mistyped directory cannot pass.
    const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
    assert.ok(files.length > 0, dir);
    assert.equal(r.stdout.match(/^ {2}\S+\.md: with \d+, without \d+ -> /gm)?.length, files.length);
  });
}
