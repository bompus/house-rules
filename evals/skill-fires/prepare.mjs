#!/usr/bin/env node
// Builds a throwaway plugin directory for `claude plugin eval`: the shipped skills plus these cases.
//   node evals/skill-fires/prepare.mjs <empty-destination-dir>
import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const destination = process.argv[2] && resolve(process.argv[2]);
if (!destination) {
  console.error("usage: node evals/skill-fires/prepare.mjs <empty-destination-dir>");
  process.exit(2);
}
if (existsSync(destination) && readdirSync(destination).length) {
  console.error(`${destination} is not empty; choose a new directory`);
  process.exit(2);
}
mkdirSync(join(destination, ".claude-plugin"), { recursive: true });
writeFileSync(
  join(destination, ".claude-plugin", "plugin.json"),
  `${JSON.stringify({ name: "house-rules-skills", description: "House-rules skills (evaluation copy)", skills: "./skills/" }, null, 2)}\n`,
);
cpSync(join(here, "../../skills"), join(destination, "skills"), {
  recursive: true,
  filter: (path) => !/[\\/](test|__pycache__)([\\/]|$)/.test(path),
});
for (const name of readdirSync(here, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)) {
  cpSync(join(here, name), join(destination, "evals", name), { recursive: true });
}
console.log(`evaluation copy ready: ${destination}`);
