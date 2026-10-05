// Selection management for compose.mjs config. JSON is the only settings store.
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
const SHIPPED_SKILLS = join(dirname(fileURLToPath(import.meta.url)), "skills");
import {
  composeConfiguration,
  configurationPath,
  modifierList,
  parseFragment,
  skillSources,
  splitSections,
} from "./composition.mjs";
import { renderConfig, renderHelp } from "./config-view.mjs";

const COMMANDS = ["catalog", "status", "validate", "preview", "set"];
const TOGGLES = ["enable-modifier", "disable-modifier", "enable-skill", "disable-skill"];
const revisionOf = (text) =>
  text === null ? "missing" : createHash("sha256").update(text).digest("hex");
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function stringList(value, key) {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string" || !v.trim()))
    throw new Error(`${key} must be an array of non-empty strings`);
  if (new Set(value).size !== value.length) throw new Error(`${key} contains duplicates`);
}

function validateShape(config) {
  if (!object(config)) throw new Error("configuration must be a JSON object");
  for (const key of ["modifiers", "layers"]) stringList(config[key], key);
  if (config.skills !== undefined && !object(config.skills))
    throw new Error("skills must be an object");
  for (const key of ["exclude", "independent"]) stringList(config.skills?.[key], `skills.${key}`);
  const known = new Set(modifierList().map((m) => m.name));
  for (const name of config.modifiers ?? []) {
    if (!known.has(name)) throw new Error(`unknown modifier "${name}" (see config catalog)`);
  }
  if (config.modifiers?.includes("question-cards") && !config.modifiers.includes("coded-offers"))
    throw new Error(
      "question-cards requires coded-offers; use --questions cards or disable question-cards",
    );
}

export function readConfiguration(path) {
  // Preserve the caller's config directory: relative layers use the same base as composition.
  path = resolve(path);
  let text = null;
  try {
    if (!lstatSync(path).isFile())
      throw new Error("config must be a regular file, not a symlink or directory");
    text = readFileSync(path, "utf8");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  let config = {};
  try {
    if (text !== null) config = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("invalid JSON in configuration");
  }
  validateShape(config);
  return { path, text, revision: revisionOf(text), config };
}

export function selectionReport(config, path) {
  validateShape(config);
  const result = composeConfiguration(config, dirname(path));
  const allSkills = skillSources(
    { ...config, skills: { ...config.skills, exclude: [] } },
    dirname(path),
  );
  const selected = new Set(config.modifiers ?? []);
  const modifiers = modifierList().map((m) => ({ ...m, enabled: selected.has(m.name) }));
  const skills = [...allSkills].map(([name, source]) => ({
    name,
    source,
    origin: source === join(SHIPPED_SKILLS, name) ? "shipped" : relative(dirname(path), source),
    enabled: result.skills.has(name),
    description:
      parseFragment(readFileSync(join(source, "SKILL.md"), "utf8"), source).meta.description ?? "",
  }));
  const unavailable = (config.skills?.exclude ?? []).filter((name) => !allSkills.has(name));
  const rules = splitSections(result.rules).sections.map((s) => ({
    heading: s.heading,
    source: "core",
  }));
  const origins = new Map();
  for (const f of result.fragments) {
    for (const section of splitSections(f.body).sections) origins.set(section.heading, f.source);
  }
  for (const rule of rules) {
    rule.source = origins.get(rule.heading) ?? "core";
    rule.origin =
      rule.source === "core" || rule.source.startsWith("modifier ")
        ? rule.source
        : relative(dirname(path), rule.source);
  }
  return {
    modifiers,
    skills,
    rules,
    unavailable,
    layers: (config.layers ?? ["."]).map((layer) => resolve(dirname(path), layer)),
    fragments: result.fragments.map((f) => ({ source: f.source, ...f.meta })),
    questions: selected.has("question-cards")
      ? "cards"
      : selected.has("coded-offers")
        ? "coded"
        : "plain",
    warnings: result.warnings,
    composedRules: result.rules,
    hostLoading: "unverified",
  };
}

export function changeSelection(config, options, path) {
  const next = structuredClone(config);
  const modifiers = new Set(next.modifiers ?? []);
  const excluded = new Set(next.skills?.exclude ?? []);
  const knownModifiers = new Set(modifierList().map((m) => m.name));
  // Use discovery even for excluded skills; preserve unrelated existing exclusions.
  const knownSkills = new Set(
    skillSources({ ...next, skills: { ...next.skills, exclude: [] } }, dirname(path)).keys(),
  );
  for (const [kind, known, choices] of [
    ["modifier", knownModifiers, modifiers],
    ["skill", knownSkills, excluded],
  ]) {
    const enable = options[`enable-${kind}`] ?? [];
    const disable = options[`disable-${kind}`] ?? [];
    for (const name of [...enable, ...disable]) {
      if (!known.has(name)) throw new Error(`unknown ${kind} "${name}" (see config catalog)`);
      if (enable.includes(name) && disable.includes(name))
        throw new Error(`cannot enable and disable "${name}" together`);
      if (
        kind === "modifier" &&
        options.questions !== undefined &&
        ["coded-offers", "question-cards"].includes(name)
      )
        throw new Error("use --questions or explicit question modifiers, not both");
    }
    for (const name of enable) {
      if (kind === "modifier") choices.add(name);
      else choices.delete(name);
    }
    for (const name of disable) {
      if (kind === "modifier") choices.delete(name);
      else choices.add(name);
    }
  }
  if (options.questions !== undefined) {
    if (!["plain", "coded", "cards"].includes(options.questions))
      throw new Error("--questions must be plain, coded or cards");
    if (options.questions === "plain") modifiers.delete("coded-offers");
    else modifiers.add("coded-offers");
    if (options.questions === "cards") modifiers.add("question-cards");
    else modifiers.delete("question-cards");
  }
  if (JSON.stringify([...modifiers]) !== JSON.stringify(next.modifiers ?? []))
    next.modifiers = [...modifiers];
  if (JSON.stringify([...excluded]) !== JSON.stringify(next.skills?.exclude ?? []))
    next.skills = { ...next.skills, exclude: [...excluded] };
  selectionReport(next, path); // Composition and legacy-name errors precede every write.
  return next;
}

// Cooperating CLI writers share an exclusive lock; expected revision guards stale previews.
// Manual editors do not share this lock. Recheck before rename, but they can still race that rename.
export function writeConfiguration(snapshot, next, expected) {
  if (!expected) throw new Error("--apply requires --expect <revision> from status or a preview");
  selectionReport(next, snapshot.path);
  mkdirSync(dirname(snapshot.path), { recursive: true });
  // Lock aliases of the same parent together without changing relative layer discovery.
  const lock = `${join(realpathSync(dirname(snapshot.path)), basename(snapshot.path))}.lock`;
  let lockFd;
  try {
    lockFd = openSync(lock, "wx", 0o600);
  } catch (e) {
    if (e.code === "EEXIST")
      throw new Error(
        `configuration is locked: ${lock}; inspect the owner before removing an abandoned lock`,
      );
    throw e;
  }
  const temporary = `${snapshot.path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(lockFd, JSON.stringify({ pid: process.pid }));
    const current = readConfiguration(snapshot.path);
    if (current.revision !== expected || current.revision !== snapshot.revision)
      throw new Error("configuration changed since preview; read status and preview again");
    if (current.text !== null && JSON.stringify(current.config) === JSON.stringify(next))
      return { changed: false, revision: current.revision };
    const text = `${JSON.stringify(next, null, 2)}\n`;
    const fd = openSync(
      temporary,
      "wx",
      current.text === null ? 0o600 : statSync(current.path).mode & 0o777,
    );
    try {
      writeFileSync(fd, text);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    if (readConfiguration(snapshot.path).revision !== current.revision)
      throw new Error("configuration changed during validation; preview again");
    renameSync(temporary, snapshot.path);
    return { changed: true, revision: revisionOf(text) };
  } finally {
    try {
      if (existsSync(temporary)) unlinkSync(temporary);
    } finally {
      try {
        closeSync(lockFd);
      } finally {
        unlinkSync(lock);
      }
    }
  }
}

export function configCommand(argv) {
  const command = argv[0] ?? "help";
  if (command === "help" || command === "--help") return console.log(renderHelp());
  if (!COMMANDS.includes(command))
    throw new Error(`unknown config command "${command}" (see config help)`);
  const { values } = parseArgs({
    args: argv.slice(1),
    options: {
      config: { type: "string" },
      help: { type: "boolean" },
      json: { type: "boolean" },
      rules: { type: "boolean" },
      questions: { type: "string" },
      apply: { type: "boolean" },
      expect: { type: "string" },
      ...Object.fromEntries(TOGGLES.map((key) => [key, { type: "string", multiple: true }])),
    },
  });
  if (values.help) return console.log(renderHelp());
  const changing = Boolean(
    values.questions !== undefined || TOGGLES.some((key) => values[key]?.length),
  );
  if (
    (changing || values.apply || values.expect !== undefined) &&
    !["set", "preview"].includes(command)
  )
    throw new Error("selection flags belong to config set or preview");
  if (values.apply && command !== "set") throw new Error("--apply belongs to config set");
  if (values.expect !== undefined && !values.apply) throw new Error("--expect requires --apply");
  if (values.rules && values.json) throw new Error("choose --rules or --json, not both");
  if (values.rules && command !== "preview") throw new Error("--rules belongs to config preview");
  const snapshot = readConfiguration(configurationPath(values.config));
  const next = changing ? changeSelection(snapshot.config, values, snapshot.path) : snapshot.config;
  const report = selectionReport(next, snapshot.path);
  const changes = [
    { key: "modifiers", before: snapshot.config.modifiers ?? [], after: next.modifiers ?? [] },
    {
      key: "skills.exclude",
      before: snapshot.config.skills?.exclude ?? [],
      after: next.skills?.exclude ?? [],
    },
  ].filter(({ before, after }) => JSON.stringify(before) !== JSON.stringify(after));
  const applied = values.apply ? writeConfiguration(snapshot, next, values.expect) : null;
  const output = {
    command,
    configPath: snapshot.path,
    exists: values.apply || snapshot.text !== null,
    revision: applied?.revision ?? snapshot.revision,
    changes,
    applied,
    ...report,
  };
  if (values.rules) return process.stdout.write(report.composedRules);
  if (values.json) console.log(JSON.stringify(output, null, 2));
  else console.log(renderConfig(output));
}
