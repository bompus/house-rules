// Composition and source discovery shared by output generation and configuration management.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = dirname(fileURLToPath(import.meta.url));
const PROTECTED = "End of every reply";
// The protected section points at § Offers, so Offers may be replaced but not removed.
const REQUIRED = [PROTECTED, "Offers"];
const OPS = ["replaces", "after", "before", "removes"];
const KEYS = [...OPS, "description", "requires"];

// Windows line endings and a byte-order mark would otherwise hide frontmatter and headings.
const normalize = (text) => text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");

// Minimal frontmatter: `key: value` lines between `---` fences.
export function parseFragment(rawText, source) {
  const text = normalize(rawText);
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  const meta = {};
  if (m) {
    for (const line of m[1].split("\n")) {
      const i = line.indexOf(":");
      if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  return { meta, body: (m ? text.slice(m[0].length) : text).trim(), source };
}

// Splits on level-2 headings outside fenced code blocks; level-3 and deeper stay inside their section.
export function splitSections(rawText) {
  const parts = [[]];
  let fence = null;
  for (const line of normalize(rawText).split("\n")) {
    const f = /^(`{3,}|~{3,})/.exec(line);
    if (f && (!fence || f[1][0] === fence[0])) fence = fence ? null : f[1];
    if (!fence && line.startsWith("## ")) parts.push([]);
    parts.at(-1).push(line);
  }
  const preamble = parts.shift().join("\n").trim();
  const sections = parts.map((lines) => ({
    heading: lines[0].slice(3).trim(),
    text: lines.join("\n").trim(),
  }));
  return { preamble, sections };
}

export function compose(coreText, fragments) {
  const { preamble, sections } = splitSections(coreText);
  const find = (heading, f) => {
    const i = sections.findIndex((s) => s.heading === heading);
    if (i < 0) throw new Error(`${f.source}: no section "${heading}" to target`);
    return i;
  };
  for (const f of fragments) {
    const unknown = Object.keys(f.meta).filter((k) => !KEYS.includes(k));
    if (unknown.length)
      throw new Error(
        `${f.source}: unknown frontmatter key "${unknown[0]}" (use ${KEYS.join(", ")})`,
      );
    const ops = OPS.filter((k) => k in f.meta);
    if (ops.length > 1) throw new Error(`${f.source}: use one of ${OPS.join(", ")}`);
    const op = ops[0];
    const target = op && f.meta[op];
    if (op && !target) throw new Error(`${f.source}: ${op}: needs a section heading`);
    if (target === PROTECTED && op !== "after")
      throw new Error(
        `${f.source}: "${PROTECTED}" stays first and can only be added to with after:`,
      );
    if (op === "removes") {
      if (REQUIRED.includes(target))
        throw new Error(`${f.source}: "${target}" can be replaced, not removed`);
      if (f.body) throw new Error(`${f.source}: a removes: fragment has no body`);
      sections.splice(find(target, f), 1);
      continue;
    }
    const { preamble: stray, sections: added } = splitSections(f.body);
    if (!added.length || stray)
      throw new Error(`${f.source}: body must start with a "## " heading`);
    if (op === "replaces") {
      // A replacement keeps the `after:` tag of the section it replaces, so later `after:` fragments still queue behind it.
      const i = find(target, f);
      sections.splice(i, 1, ...added.map((s) => ({ ...s, after: sections[i].after })));
    } else if (op === "before") sections.splice(find(target, f), 0, ...added);
    else if (op === "after") {
      // Earlier `after:` fragments for the same target stay first, in configured order.
      let i = find(target, f) + 1;
      while (sections[i]?.after === target) i++;
      sections.splice(i, 0, ...added.map((s) => ({ ...s, after: target })));
    } else sections.push(...added);
  }
  const seen = new Set();
  for (const s of sections) {
    if (seen.has(s.heading))
      throw new Error(`duplicate section "${s.heading}"; use replaces: to override it`);
    seen.add(s.heading);
  }
  if (sections[0]?.heading !== PROTECTED)
    throw new Error(`"${PROTECTED}" must stay the first section`);
  for (const h of REQUIRED)
    if (!seen.has(h))
      throw new Error(`a "${h}" section is required; a replacement must keep that heading`);
  return [preamble, ...sections.map((s) => s.text)].filter(Boolean).join("\n\n") + "\n";
}

const mdFiles = (dir) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(".md"))
        .sort()
    : [];

export function modifierList() {
  const dir = join(BASE, "rules/modifiers");
  return mdFiles(dir).map((f) => ({
    name: f.slice(0, -3),
    ...parseFragment(readFileSync(join(dir, f), "utf8"), f).meta,
  }));
}

// The directory holding house-rules.json is the user's layer unless the config lists others.
const layersOf = (config) => config.layers ?? ["."];

export function loadFragments(config, configDir) {
  const fragments = (config.modifiers ?? []).map((name) => {
    const path = join(BASE, "rules/modifiers", `${name}.md`);
    if (!existsSync(path)) throw new Error(`unknown modifier "${name}" (see --list)`);
    return parseFragment(readFileSync(path, "utf8"), `modifier ${name}`);
  });
  for (const layer of layersOf(config)) {
    const dir = join(resolve(configDir, layer), "rules");
    for (const f of mdFiles(dir))
      fragments.push(parseFragment(readFileSync(join(dir, f), "utf8"), join(dir, f)));
  }
  return fragments;
}

// Later layers' skills shadow base skills of the same name.
export function skillSources(config, configDir) {
  const base = join(BASE, "skills");
  const legacyNames = new Map(
    readdirSync(base)
      .filter((name) => name.startsWith("hr-") && existsSync(join(base, name, "SKILL.md")))
      .map((name) => [name.slice(3), name]),
  );
  const exclude = new Set(config.skills?.exclude ?? []);
  const independent = new Set(config.skills?.independent ?? []);
  for (const name of exclude) {
    if (legacyNames.has(name) && !independent.has(name))
      throw new Error(
        `legacy skill name "${name}" in skills.exclude; replace it with "${legacyNames.get(name)}"`,
      );
  }
  const sources = new Map();
  for (const root of [
    base,
    ...layersOf(config).map((l) => join(resolve(configDir, l), "skills")),
  ]) {
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root)) {
      if (!existsSync(join(root, name, "SKILL.md"))) continue;
      if (legacyNames.has(name) && !independent.has(name))
        throw new Error(
          `legacy skill name "${name}" in a personal layer; rename its directory and frontmatter name to "${legacyNames.get(name)}", or list "${name}" in skills.independent to keep it as an independent skill`,
        );
      if (root !== base && legacyNames.get(name.slice(3)) === name) {
        const declaredName = parseFragment(readFileSync(join(root, name, "SKILL.md"), "utf8"), name)
          .meta.name?.replace(/\s+#.*$/, "")
          .replace(/^(['"])(.*)\1$/, "$2");
        if (legacyNames.has(declaredName))
          throw new Error(
            `legacy skill name "${declaredName}" in frontmatter; set name to "${name}" to match its renamed override directory`,
          );
      }
      if (!exclude.has(name)) sources.set(name, join(root, name));
    }
  }
  return sources;
}

export function configurationPath(path) {
  return resolve(
    path ??
      join(
        process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
        "house-rules/house-rules.json",
      ),
  );
}

export function composeConfiguration(config, configDir) {
  const fragments = loadFragments(config, configDir);
  const rules = compose(readFileSync(join(BASE, "rules/core.md"), "utf8"), fragments);
  const skills = skillSources(config, configDir);
  const warnings = [];
  for (const f of fragments) {
    for (const need of (f.meta.requires ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)) {
      if (!skills.has(need))
        warnings.push(`${f.source} expects the "${need}" skill, which is not in the composed set`);
    }
  }
  return { fragments, rules, skills, warnings };
}
