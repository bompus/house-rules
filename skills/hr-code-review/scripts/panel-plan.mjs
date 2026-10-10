// Prints the panel a set of preferences resolves to, before any model is called.
// See ../references/panel-plan.md.
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { formatPanelPlan, resolvePanel } from "./panel-preferences.mjs";

function readJson(path, label) {
  const file = resolve(path);
  if (!lstatSync(file).isFile())
    throw new Error(`${label} must be a regular file, not a symlink or directory`);
  const text = readFileSync(file, "utf8");
  try {
    return { value: JSON.parse(text), revision: createHash("sha256").update(text).digest("hex") };
  } catch {
    throw new Error(`invalid JSON in ${label}`);
  }
}

function main(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      config: { type: "string" },
      bindings: { type: "string" },
      project: { type: "string" },
      "approve-project": { type: "string" },
      task: { type: "string" },
      "author-family": { type: "string", multiple: true },
      "approve-metered": { type: "string", multiple: true },
      json: { type: "boolean" },
    },
  });
  if (values.bindings === undefined) throw new Error("--bindings <json> is required");
  const config = readJson(
    values.config ??
      join(
        process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
        "house-rules/house-rules.json",
      ),
    "configuration",
  );
  if (config.value.panel === undefined) throw new Error("configuration has no panel section");
  const project =
    values.project === undefined ? undefined : readJson(values.project, "project preferences");
  const request = {
    user: config.value.panel,
    project: project?.value,
    task: values.task === undefined ? undefined : readJson(values.task, "task preferences").value,
    bindings: readJson(values.bindings, "bindings").value,
    authorFamilies: values["author-family"] ?? [],
    approvals: {
      project: project !== undefined && values["approve-project"] === project.revision,
      metered: values["approve-metered"] ?? [],
    },
  };
  const plan = resolvePanel(request);
  console.log(values.json ? JSON.stringify(plan, null, 2) : formatPanelPlan(plan));
  return plan.ok ? 0 : 1;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
