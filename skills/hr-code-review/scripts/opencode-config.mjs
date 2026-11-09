// The read rules of the user's own OpenCode configuration, for opencode-seat.mjs: which read patterns
// the config denies or asks about, and how OpenCode matches a pattern. Matching the user's rules is best
// effort; anything not understood is refused.
import { readFileSync } from "node:fs";
import { join } from "node:path";

// A superset of how OpenCode matches a pattern: `*` and `**` match any run of characters, `?` one.
export const globRegex = (/** @type {string} */ pattern) => {
  // OpenCode matches with `/` for both separators, and lets a trailing " *" match an absent suffix.
  const text = pattern.replaceAll("\\", "/");
  const optional = text.endsWith(" *");
  const body = (optional ? text.slice(0, -2) : text)
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*+/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${body}${optional ? "( .*)?" : ""}$`, "s");
};
/**
 * The read patterns the user's OpenCode config denies or asks about, from the global folder, the
 * `managedDirs`, and what `env` selects (`OPENCODE_CONFIG`, `OPENCODE_CONFIG_DIR`, `OPENCODE_CONFIG_CONTENT`).
 * A missing file is optional; one that exists and cannot be read or parsed here (comments need Bun)
 * throws, so its denials are never dropped silently. The message names the file and an error code, never
 * the parser's text, which can quote the file. `["*", ...patterns]` means every read is denied.
 * @param {string} configDir
 * @param {string[]} [managedDirs]
 * @param {Record<string, string | undefined>} [env]
 */
export function userReadDenials(configDir, managedDirs = [], env = {}) {
  /** @type {string[]} */
  const denied = [];
  let everything = /** @type {boolean} */ (false);
  const actions = new Set(["allow", "ask", "deny"]);
  const isAction = (/** @type {unknown} */ v) => typeof v === "string" && actions.has(v);
  const isRecord = /** @type {(v: unknown) => v is Record<string, any>} */ (
    (v) => typeof v === "object" && v !== null && !Array.isArray(v)
  );
  /** @param {unknown} v @returns {[string, unknown][]} */
  const entriesOf = (v) => Object.entries(/** @type {Record<string, unknown>} */ (v));
  // OpenCode matches a tool name against a permission key as a glob, so every key that matches "read"
  // (`read`, `*`, `r*`, `?ead`) restricts reads.
  const forRead = (/** @type {string} */ key) => globRegex(key).test("read");
  // OpenCode loads both files when both exist, so the denials of each count; both are always read, so a
  // second file that cannot be used refuses the run even when the first already denies everything.
  const dirs = [
    configDir,
    ...managedDirs,
    ...(env.OPENCODE_CONFIG_DIR ? [env.OPENCODE_CONFIG_DIR] : []),
  ];
  /** @type {{ path: string, text?: string }[]} */
  const sources = [
    ...dirs.flatMap((d) => ["opencode.json", "opencode.jsonc"].map((n) => ({ path: join(d, n) }))),
    ...(env.OPENCODE_CONFIG ? [{ path: env.OPENCODE_CONFIG }] : []),
    ...(env.OPENCODE_CONFIG_CONTENT === undefined
      ? []
      : [{ path: "OPENCODE_CONFIG_CONTENT", text: env.OPENCODE_CONFIG_CONTENT }]),
  ];
  for (const { path, text } of sources) {
    /** @type {any} */
    let config;
    try {
      const source = text ?? readFileSync(path, "utf8");
      const jsonc = /** @type {any} */ (globalThis).Bun?.JSONC;
      if (jsonc) {
        // Bun's parser stops after the first value; wrapped in an array, a second one shows.
        const documents = jsonc.parse(`[${source}\n]`);
        if (!Array.isArray(documents) || documents.length !== 1) {
          throw new Error("not one JSON document");
        }
        config = documents[0];
      } else {
        config = JSON.parse(source);
      }
    } catch (e) {
      // An absent file is optional. One that exists and cannot be read or parsed (JSONC comments under a
      // runtime without a JSONC parser) is refused: its denials would otherwise be dropped silently.
      const code = /** @type {{ code?: unknown }} */ (e).code;
      if (text === undefined && (code === "ENOENT" || code === "ENOTDIR")) {
        continue;
      }
      throw new Error(
        `${path} cannot be read or parsed here (comments in it need Bun, and it must hold one document)${typeof code === "string" ? ` [${code}]` : ""}`,
        { cause: e },
      );
    }
    const substituted = (/** @type {string} */ text) => /\{(env|file):/.test(text);
    const unsupported = (/** @type {string} */ where) =>
      new Error(`${path}: ${where} has a value this seat does not understand; fix it or remove it`);
    // One `permission` value: an action for every tool, or a map of tool names to an action or to a map of
    // patterns to actions. A deny or ask for read, or for everything, is a final deny-all; patterns that
    // deny or ask are collected. A value of another shape is refused, never read as "no denial".
    const collect = (/** @type {unknown} */ permission, /** @type {string} */ where) => {
      if (permission === undefined) {
        return;
      }
      if (isAction(permission)) {
        everything ||= permission !== "allow";
        return;
      }
      if (!isRecord(permission)) {
        throw unsupported(where);
      }
      for (const [key, value] of entriesOf(permission)) {
        if (substituted(key)) {
          throw unsupported(`${where}.${key} (a {env:} or {file:} substitution)`);
        }
        if (!forRead(key)) {
          continue;
        }
        if (isAction(value)) {
          everything ||= value !== "allow";
        } else if (isRecord(value)) {
          for (const [pattern, action] of entriesOf(value)) {
            if (substituted(pattern)) {
              throw unsupported(`${where}.${key}["${pattern}"] (a {env:} or {file:} substitution)`);
            }
            if (!isAction(action)) {
              throw unsupported(`${where}.${key}["${pattern}"]`);
            }
            if (action !== "allow") {
              denied.push(pattern);
            }
          }
        } else {
          throw unsupported(`${where}.${key}`);
        }
      }
    };
    const native = (/** @type {unknown} */ list, /** @type {string} */ where) => {
      if (list === undefined) {
        return;
      }
      if (!Array.isArray(list)) {
        throw unsupported(where);
      }
      for (const entry of list) {
        if (!isRecord(entry) || typeof entry.action !== "string") {
          throw unsupported(`${where}[]`);
        }
        for (const field of ["action", "effect", "resource"]) {
          if (typeof entry[field] === "string" && substituted(entry[field])) {
            throw unsupported(`${where}[].${field} (a {env:} or {file:} substitution)`);
          }
        }
        if (forRead(entry.action) && entry.effect !== "allow") {
          if (typeof entry.resource === "string") {
            denied.push(entry.resource);
          } else {
            everything = true;
          }
        }
      }
    };
    const tools = (/** @type {unknown} */ section, /** @type {string} */ where) => {
      if (section === undefined) {
        return;
      }
      if (!isRecord(section)) {
        throw unsupported(where);
      }
      for (const [key] of entriesOf(section)) {
        if (substituted(key)) {
          throw unsupported(`${where}.${key} (a {env:} or {file:} substitution)`);
        }
      }
      everything ||= entriesOf(section).some(([key, value]) => forRead(key) && value === false);
    };
    // One definition (the top level, an agent, a legacy mode): permission map, tools switches, native list.
    const section = (/** @type {unknown} */ def, /** @type {string} */ where) => {
      if (!isRecord(def)) {
        throw unsupported(where);
      }
      collect(def.permission, `${where}.permission`);
      tools(def.tools, `${where}.tools`);
      native(def.permissions, `${where}.permissions`);
    };
    section(config ?? {}, "config");
    // Policy lists are a rule format this seat does not interpret.
    for (const [where, value] of [
      ["policies", config?.policies],
      ["experimental.policies", config?.experimental?.policies],
    ]) {
      if (value !== undefined) {
        throw unsupported(where);
      }
    }
    for (const group of ["agent", "agents", "mode", "modes"]) {
      const defs = config?.[group];
      if (defs === undefined) {
        continue;
      }
      if (!isRecord(defs) && !Array.isArray(defs)) {
        throw unsupported(group);
      }
      for (const [name, def] of Object.entries(defs)) {
        if (def !== null && def !== undefined) {
          section(def, `${group}.${name}`);
        }
      }
    }
  }
  return everything ? ["*", ...denied] : denied;
}
