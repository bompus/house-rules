// Composition and source discovery shared by output generation and configuration management.
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = dirname(fileURLToPath(import.meta.url));
const PROTECTED = "End of every reply";
// The protected section points at § Offers, so Offers may be replaced but not removed.
const REQUIRED = [PROTECTED, "Offers"];
const OPS = ["replaces", "after", "before", "removes"];
const KEYS = [...OPS, "description", "requires", "reference"];

/**
 * @typedef {Record<string, string>} Meta frontmatter keys and their values
 * @typedef {{ name: string, text: string, heading: string }} ReferenceOutput
 * @typedef {object} Fragment
 * @property {Meta} meta
 * @property {string} body
 * @property {string} source where the text came from, for error messages
 * @property {string} [path] the file, when the fragment has one
 * @property {string} [root] the layer directory a reference must stay inside
 * @property {ReferenceOutput} [referenceOutput] the procedure written beside the rules
 * @typedef {{ heading: string, text: string, after?: string, referenceOutput?: ReferenceOutput }} Section
 * @typedef {object} Config
 * @property {string[]} [modifiers]
 * @property {string[]} [layers]
 * @property {{ include?: unknown, exclude?: string[], independent?: string[] }} [skills]
 */

// Windows line endings and a byte-order mark would otherwise hide frontmatter and headings.
const normalize = (/** @type {string} */ text) =>
  text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");

// A YAML value may be wrapped in one pair of matching quotes; the text inside is the value.
const unquote = (/** @type {string} */ value) =>
  value.length > 1 && /^(["']).*\1$/.test(value) ? value.slice(1, -1) : value;

/**
 * Minimal frontmatter: `key: value` lines between `---` fences.
 * @param {string} rawText
 * @param {string} source
 * @returns {Fragment}
 */
export function parseFragment(rawText, source) {
  const text = normalize(rawText);
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  /** @type {Meta} */
  const meta = {};
  if (m?.[1] !== undefined) {
    for (const line of m[1].split("\n")) {
      const i = line.indexOf(":");
      if (i > 0) {
        meta[line.slice(0, i).trim()] = unquote(line.slice(i + 1).trim());
      }
    }
  }
  return { meta, body: (m ? text.slice(m[0].length) : text).trim(), source };
}

/**
 * Splits on level-2 headings outside fenced code blocks; level-3 and deeper stay inside their section.
 * @param {string} rawText
 * @returns {{ preamble: string, sections: Section[] }}
 */
export function splitSections(rawText) {
  /** @type {string[][]} */
  const parts = [[]];
  /** @type {string | null} */
  let fence = null;
  for (const line of normalize(rawText).split("\n")) {
    const f = /^(`{3,}|~{3,})/.exec(line);
    const marker = f?.[1];
    if (marker !== undefined && (!fence || marker[0] === fence[0])) {
      fence = fence ? null : marker;
    }
    if (!fence && line.startsWith("## ")) {
      parts.push([]);
    }
    parts.at(-1)?.push(line);
  }
  const preamble = (parts.shift() ?? []).join("\n").trim();
  const sections = parts.map((lines) => ({
    heading: (lines[0] ?? "").slice(3).trim(),
    text: lines.join("\n").trim(),
  }));
  return { preamble, sections };
}

/**
 * @param {string} coreText
 * @param {Fragment[]} fragments
 * @param {string | undefined} referencesDirectory
 * @param {Map<string, ReferenceOutput>} candidates
 */
function composeParts(coreText, fragments, referencesDirectory, candidates) {
  const core = parseFragment(coreText, "core");
  if ("reference" in core.meta && "references" in core.meta) {
    throw new Error("core: use reference or references, not both");
  }
  const { reference, references } = core.meta;
  const paths =
    references !== undefined
      ? references.split(",").map((path) => path.trim())
      : reference !== undefined
        ? [reference]
        : [];
  if (paths.some((path) => !path) || new Set(paths).size !== paths.length) {
    throw new Error("core: references must contain distinct non-empty paths");
  }
  const outputs = new Map();
  if (paths.length) {
    core.path = join(BASE, "rules/core.md");
    core.root = BASE;
    for (const path of paths) {
      const output = renderReference(core, referencesDirectory, true, path);
      if (outputs.has(output.heading)) {
        throw new Error(`core: duplicate reference section "${output.heading}"`);
      }
      outputs.set(output.heading, output);
    }
    coreText = core.body;
  }
  const { preamble, sections } = splitSections(coreText);
  if (referencesDirectory !== undefined) {
    for (const section of sections) {
      section.referenceOutput = outputs.get(section.heading);
    }
  }
  const find = (/** @type {string} */ heading, /** @type {Fragment} */ f) => {
    const i = sections.findIndex((s) => s.heading === heading);
    if (i < 0) {
      throw new Error(`${f.source}: no section "${heading}" to target`);
    }
    return i;
  };
  for (const f of fragments) {
    const unknown = Object.keys(f.meta).filter((k) => !KEYS.includes(k));
    if (unknown.length) {
      throw new Error(
        `${f.source}: unknown frontmatter key "${unknown[0]}" (use ${KEYS.join(", ")})`,
      );
    }
    const ops = OPS.filter((k) => k in f.meta);
    if (ops.length > 1) {
      throw new Error(`${f.source}: use one of ${OPS.join(", ")}`);
    }
    const op = ops[0];
    const target = op ? f.meta[op] : undefined;
    if (op && !target) {
      throw new Error(`${f.source}: ${op}: needs a section heading`);
    }
    if (target === PROTECTED && op !== "after") {
      throw new Error(
        `${f.source}: "${PROTECTED}" stays first and can only be added to with after:`,
      );
    }
    if (op === "removes" && target) {
      if (REQUIRED.includes(target)) {
        throw new Error(`${f.source}: "${target}" can be replaced, not removed`);
      }
      if (f.body) {
        throw new Error(`${f.source}: a removes: fragment has no body`);
      }
      sections.splice(find(target, f), 1);
      continue;
    }
    const { preamble: stray, sections: added } = splitSections(f.body);
    for (const section of added) {
      section.referenceOutput = f.referenceOutput;
    }
    if (!added.length || stray) {
      throw new Error(`${f.source}: body must start with a "## " heading`);
    }
    if (op === "replaces" && target) {
      // A replacement keeps the `after:` tag of the section it replaces, so later `after:` fragments still queue behind it.
      const i = find(target, f);
      const { after } = sections[i] ?? {};
      sections.splice(i, 1, ...added.map((s) => ({ ...s, after })));
    } else if (op === "before" && target) {
      sections.splice(find(target, f), 0, ...added);
    } else if (op === "after" && target) {
      // Earlier `after:` fragments for the same target stay first, in configured order.
      let i = find(target, f) + 1;
      while (sections[i]?.after === target) {
        i++;
      }
      sections.splice(i, 0, ...added.map((s) => ({ ...s, after: target })));
    } else {
      sections.push(...added);
    }
  }
  const seen = new Set();
  for (const s of sections) {
    if (seen.has(s.heading)) {
      throw new Error(`duplicate section "${s.heading}"; use replaces: to override it`);
    }
    seen.add(s.heading);
    if (s.referenceOutput) {
      const resource = s.referenceOutput;
      const previous = candidates.get(resource.name);
      if (previous && previous.text !== resource.text) {
        throw new Error(`conflicting reference "${resource.name}"`);
      }
      candidates.set(resource.name, resource);
    }
  }
  if (sections[0]?.heading !== PROTECTED) {
    throw new Error(`"${PROTECTED}" must stay the first section`);
  }
  for (const h of REQUIRED) {
    if (!seen.has(h)) {
      throw new Error(`a "${h}" section is required; a replacement must keep that heading`);
    }
  }
  return [preamble, ...sections.map((s) => s.text)].filter(Boolean).join("\n\n") + "\n";
}

/**
 * @param {string} coreText
 * @param {Fragment[]} fragments
 */
export function compose(coreText, fragments) {
  const inline = fragments.map((fragment) => {
    if (
      !("reference" in fragment.meta) ||
      !fragment.body.includes(`](${fragment.meta.reference})`)
    ) {
      return fragment;
    }
    const f = { ...fragment };
    if (!f.path) {
      const name =
        typeof f.source === "string" ? f.source.replace(/^modifier /, "").replace(/\.md$/, "") : "";
      const path = join(BASE, "rules/modifiers", `${name}.md`);
      if (
        !/^[a-z0-9-]+$/.test(name) ||
        !existsSync(path) ||
        parseFragment(readFileSync(path, "utf8"), name).body !== f.body
      ) {
        throw new Error(`${f.source}: use loadFragments to establish the reference source layer`);
      }
      f.path = path;
      f.root = BASE;
    }
    renderReference(f, undefined);
    return f;
  });
  return composeParts(coreText, inline, undefined, new Map());
}

const mdFiles = (/** @type {string} */ dir) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(".md"))
        .sort()
    : [];

/** @returns {({ name: string, description?: string } & Meta)[]} */
export function modifierList() {
  const dir = join(BASE, "rules/modifiers");
  return mdFiles(dir).map((f) => ({
    name: f.slice(0, -3),
    ...parseFragment(readFileSync(join(dir, f), "utf8"), f).meta,
  }));
}

// The directory holding house-rules.json is the user's layer unless the config lists others.
const layersOf = (/** @type {Config} */ config) => config.layers ?? ["."];

/**
 * @param {Config} config
 * @param {string} configDir
 * @returns {Fragment[]}
 */
function loadRawFragments(config, configDir) {
  const fragments = (config.modifiers ?? []).map((name) => {
    const path = join(BASE, "rules/modifiers", `${name}.md`);
    if (!existsSync(path)) {
      throw new Error(
        `unknown modifier "${name}"; remove it from "modifiers" in the configuration file ("node compose.mjs --list" in the checkout, or "house-rules --list", shows the available names)`,
      );
    }
    return { ...parseFragment(readFileSync(path, "utf8"), `modifier ${name}`), path, root: BASE };
  });
  for (const layer of layersOf(config)) {
    const dir = join(resolve(configDir, layer), "rules");
    for (const f of mdFiles(dir)) {
      fragments.push({
        ...parseFragment(readFileSync(join(dir, f), "utf8"), join(dir, f)),
        path: join(dir, f),
        root: resolve(configDir, layer),
      });
    }
  }
  return fragments;
}

/**
 * Later layers' skills shadow base skills of the same name.
 * @param {Config} config
 * @param {string} configDir
 * @returns {Map<string, string>}
 */
export function skillSources(config, configDir) {
  const base = join(BASE, "skills");
  const shipped = new Set(
    readdirSync(base).filter((name) => existsSync(join(base, name, "SKILL.md"))),
  );
  const legacyNames = new Map(
    [...shipped].filter((name) => name.startsWith("hr-")).map((name) => [name.slice(3), name]),
  );
  const exclude = new Set(config.skills?.exclude ?? []);
  const independent = new Set(config.skills?.independent ?? []);
  const included = config.skills?.include;
  if (included !== undefined) {
    if (
      !Array.isArray(included) ||
      included.some((name) => typeof name !== "string" || !name.trim())
    ) {
      throw new Error("skills.include must be an array of non-empty strings");
    }
    if (new Set(included).size !== included.length) {
      throw new Error("skills.include contains duplicates");
    }
    for (const name of included) {
      if (!shipped.has(name)) {
        throw new Error(`unknown shipped skill "${name}" in skills.include (see config catalog)`);
      }
    }
  }
  for (const name of exclude) {
    if (legacyNames.has(name) && !independent.has(name)) {
      throw new Error(
        `legacy skill name "${name}" in skills.exclude; replace it with "${legacyNames.get(name)}"`,
      );
    }
  }
  const sources = new Map();
  for (const root of [
    base,
    ...layersOf(config).map((l) => join(resolve(configDir, l), "skills")),
  ]) {
    if (!existsSync(root)) {
      continue;
    }
    for (const name of readdirSync(root)) {
      if (!existsSync(join(root, name, "SKILL.md"))) {
        continue;
      }
      if (legacyNames.has(name) && !independent.has(name)) {
        throw new Error(
          `legacy skill name "${name}" in a personal layer; rename its directory and frontmatter name to "${legacyNames.get(name)}", or list "${name}" in skills.independent to keep it as an independent skill`,
        );
      }
      if (root !== base && legacyNames.get(name.slice(3)) === name) {
        const declaredName = parseFragment(readFileSync(join(root, name, "SKILL.md"), "utf8"), name)
          .meta.name?.replace(/\s+#.*$/, "")
          .replace(/^(['"])(.*)\1$/, "$2");
        if (declaredName !== undefined && legacyNames.has(declaredName)) {
          throw new Error(
            `legacy skill name "${declaredName}" in frontmatter; set name to "${name}" to match its renamed override directory`,
          );
        }
      }
      if (
        !exclude.has(name) &&
        (root !== base || included === undefined || included.includes(name))
      ) {
        sources.set(name, join(root, name));
      }
    }
  }
  return sources;
}

/** @param {string} [path] */
export function configurationPath(path) {
  return resolve(
    path ??
      join(
        process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
        "house-rules/house-rules.json",
      ),
  );
}

/**
 * @param {Fragment} f
 * @param {string | undefined} referencesDirectory
 * @param {boolean} [core]
 * @param {string} [reference]
 * @returns {ReferenceOutput}
 */
function renderReference(f, referencesDirectory, core = false, reference = f.meta.reference) {
  const invalidReference = `${f.source}: reference must be a regular file within its source layer`;
  if (!reference || f.path === undefined || f.root === undefined) {
    throw new Error(invalidReference);
  }
  const path = resolve(dirname(f.path), reference);
  if (!existsSync(path) || !lstatSync(path).isFile()) {
    throw new Error(invalidReference);
  }
  const inside = relative(realpathSync(f.root), realpathSync(path));
  if (inside.startsWith("..") || isAbsolute(inside)) {
    throw new Error(invalidReference);
  }
  const name = basename(path);
  if (!/^[a-z0-9][a-z0-9-]*\.md$/.test(name)) {
    throw new Error(`${f.source}: invalid reference filename`);
  }
  const text = readFileSync(path, "utf8");
  const original = splitSections(text);
  const parts = splitSections(f.body);
  const section = core
    ? parts.sections.find((s) => s.heading === original.sections[0]?.heading)
    : null;
  const short = core ? splitSections(section?.text ?? "") : parts;
  const heading = original.sections[0]?.heading;
  if (
    original.preamble ||
    short.preamble ||
    original.sections.length !== 1 ||
    short.sections.length !== 1 ||
    heading === undefined ||
    heading !== short.sections[0]?.heading
  ) {
    throw new Error(`${f.source}: reference must contain the same single section heading`);
  }
  const sourceLink = `](${reference})`;
  // In core mode the check above found the section, since short came from its text.
  const sectionText = section?.text ?? "";
  if (!(core ? sectionText : f.body).includes(sourceLink)) {
    throw new Error(`${f.source}: reference link missing from body`);
  }
  if (referencesDirectory === undefined) {
    f.body = core ? f.body.replace(sectionText, text.trim()) : text.trim();
  } else {
    const href = encodeURI(
      `${referencesDirectory.replace(/\\/g, "/").replace(/\/$/, "")}/${name}`,
    ).replace(/[()#?]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
    f.body = f.body.replaceAll(sourceLink, `](${href})`);
    if (!core) {
      f.referenceOutput = { name, text, heading };
    }
  }
  return { name, text, heading };
}

/**
 * @param {Config} config
 * @param {string} configDir
 * @param {unknown} [referencesDirectory]
 */
function referenceFragments(config, configDir, referencesDirectory) {
  if (
    referencesDirectory !== undefined &&
    (typeof referencesDirectory !== "string" || !referencesDirectory.trim())
  ) {
    throw new Error("referencesDirectory must be a non-empty string");
  }
  const fragments = loadRawFragments(config, configDir);
  /** @type {Map<string, ReferenceOutput>} */
  const candidates = new Map();
  for (const f of fragments) {
    if (!("reference" in f.meta)) {
      continue;
    }
    renderReference(f, referencesDirectory);
  }
  return { fragments, candidates, referencesDirectory };
}

/**
 * Existing low-level callers receive complete inline procedure bodies too.
 * @param {Config} config
 * @param {string} configDir
 */
export function loadFragments(config, configDir) {
  return referenceFragments(config, configDir).fragments;
}

/**
 * @param {Config} config
 * @param {string} configDir
 * @param {{ referencesDirectory?: unknown }} [options]
 */
export function composeConfiguration(config, configDir, { referencesDirectory } = {}) {
  const {
    fragments,
    candidates,
    referencesDirectory: directory,
  } = referenceFragments(config, configDir, referencesDirectory);
  const rules = composeParts(
    readFileSync(join(BASE, "rules/core.md"), "utf8"),
    fragments,
    directory,
    candidates,
  );
  const references = new Map([...candidates].map(([name, value]) => [name, value.text]));
  const skills = skillSources(config, configDir);
  /** @type {string[]} */
  const warnings = [];
  const core = parseFragment(readFileSync(join(BASE, "rules/core.md"), "utf8"), "rules/core.md");
  for (const f of [core, ...fragments]) {
    for (const need of (f.meta.requires ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)) {
      if (!skills.has(need)) {
        warnings.push(`${f.source} expects the "${need}" skill, which is not in the composed set`);
      }
    }
  }
  return { fragments, rules, skills, warnings, references };
}
