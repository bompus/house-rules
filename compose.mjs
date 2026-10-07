#!/usr/bin/env node
// Composes rules and skills into explicit output paths; config commands manage selections.
//   node compose.mjs --config <path> [--out <file>] [--skills-out <dir>]
//   node compose.mjs config help
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { composeConfiguration, configurationPath, modifierList } from "./composition.mjs";
import { configCommand } from "./config.mjs";
import { setupCommand } from "./setup.mjs";
export {
  compose,
  composeConfiguration,
  configurationPath,
  loadFragments,
  modifierList,
  parseFragment,
  skillSources,
  splitSections,
} from "./composition.mjs";
const BASE = dirname(fileURLToPath(import.meta.url));
const NOTICES = ["LICENSE", "THIRD_PARTY_NOTICES.md"];

function main(argv) {
  if (argv[0] === "setup") return setupCommand(argv.slice(1));
  if (argv[0] === "config") {
    return configCommand(argv.slice(1));
  }
  const { values } = parseArgs({
    args: argv,
    options: {
      config: { type: "string" },
      out: { type: "string" },
      "skills-out": { type: "string" },
      list: { type: "boolean" },
    },
  });
  if (values.list) {
    for (const m of modifierList()) console.log(`${m.name}: ${m.description ?? ""}`);
    return;
  }
  const configPath = configurationPath(values.config);
  const config = JSON.parse(readFileSync(configPath, "utf8").replace(/^\uFEFF/, ""));
  const { fragments, rules, skills, warnings } = composeConfiguration(config, dirname(configPath));
  for (const warning of warnings) console.error(`warning: ${warning}`);
  const { out, "skills-out": skillsOut } = values;
  // Composition errors and a non-empty --skills-out stop the run before anything is written.
  if (skillsOut && existsSync(skillsOut) && readdirSync(skillsOut).length)
    throw new Error(`--skills-out ${skillsOut} must be empty or absent`);
  if (out) {
    mkdirSync(dirname(resolve(out)), { recursive: true });
    writeFileSync(out, rules);
  } else process.stdout.write(rules);
  if (skillsOut) {
    // Skill tests stay in the source checkout; hosts get only what the skill uses.
    for (const [name, from] of skills)
      cpSync(from, join(skillsOut, name), {
        recursive: true,
        filter: (src) => src !== join(from, "test"),
      });
    for (const f of NOTICES) cpSync(join(BASE, f), join(skillsOut, f));
  }
  console.error(
    `composed ${fragments.length} fragment(s), ${rules.split("\n").length} lines${skillsOut ? `, ${skills.size} skill(s)` : ""}`,
  );
}

if (
  process.argv[1] &&
  realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))
) {
  try {
    await main(process.argv.slice(2));
  } catch (e) {
    console.error(`house-rules: ${e.message}`);
    process.exit(e.exitCode ?? 1);
  }
}
