// The adapters a seat starts from a host's version file: which version of an ACP adapter (codex-acp,
// claude-agent-acp) the host has installed, and where. The launch is `<node> <the adapter's script>`, by
// absolute path, from a folder a separate install step filled earlier: nothing is fetched at review time.
// See ../references/acp-client.md, section Adapters.
import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { inside, resolveProgram, reviewBase } from "./seat-paths.mjs";

/** The adapter each agent that has one starts. */
export const ADAPTER_FOR = { codex: "codex-acp", claude: "claude-agent-acp" };
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+_-]*$/;
const BIN = /^[0-9A-Za-z][0-9A-Za-z._-]*$/;
// What the marker `installed.json` must say beside the file's entry. Its lock hash is not compared.
const MARKED = ["adapter", "package", "version", "bin", "runtime"];

/**
 * Where the version file is by default: `$XDG_CONFIG_HOME/seat-adapters.json` (an absolute value), else
 * `~/.config/seat-adapters.json`.
 * @param {Record<string, string | undefined>} env
 */
export function adaptersFile(env) {
  const xdg = env.XDG_CONFIG_HOME;
  const base = xdg && isAbsolute(xdg) ? xdg : join(homedir(), ".config");
  return join(base, "seat-adapters.json");
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The launch of an installed adapter: the absolute node and the adapter's canonical script.
 * @param {{ agent: string, file: string, dirs: string[], root: string }} spec
 *   `file` is the version file, `dirs` the trusted program folders (trustedDirs), `root` the review root.
 * @param {(message: string) => never} refuse
 * @returns {{ exe: string, args: string[] }}
 */
export function resolveAdapter({ agent, file, dirs, root }, refuse) {
  const adapter = /** @type {Record<string, string>} */ (ADAPTER_FOR)[agent];
  if (!adapter) {
    return refuse(`--seat-agent ${agent} has no adapter in a version file; give --server-exe`);
  }
  const base = reviewBase(root);
  /** @type {string} */
  let text;
  try {
    // The file the path leads to, links followed: a host-owned file is not one the checkout holds.
    const realFile = realpathSync.native(file);
    if (inside(base, realFile)) {
      return refuse(
        `${file} is inside the review checkout (${realFile}); point --adapters outside it`,
      );
    }
    text = readFileSync(realFile, "utf8");
  } catch (e) {
    if (/** @type {NodeJS.ErrnoException} */ (e).code === "ENOENT") {
      return refuse(
        `this host has no seat adapters installed (${file} does not exist); \`--server-exe ABSOLUTE-PATH\` runs an adapter from a path`,
      );
    }
    return refuse(`${file} cannot be read: ${e instanceof Error ? e.message : String(e)}`);
  }
  /** @type {unknown} */
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    return refuse(`${file} is not valid JSON`);
  }
  if (!isObject(doc) || doc.schema !== 1) {
    return refuse(`${file} is not a seat adapters file of schema 1`);
  }
  const rootValue = typeof doc.root === "string" ? doc.root : "";
  const installRoot = rootValue.startsWith("~/") ? join(homedir(), rootValue.slice(2)) : rootValue;
  if (!isAbsolute(installRoot)) {
    return refuse(`${file}: root must be an absolute path (or start with ~/)`);
  }
  if (typeof doc.install !== "string" || !doc.install) {
    return refuse(`${file}: install must name the command that installs the adapters`);
  }
  const entry = isObject(doc.adapters) ? doc.adapters[adapter] : undefined;
  if (!isObject(entry)) {
    return refuse(`${file} has no entry for ${adapter}`);
  }
  for (const [field, ok] of /** @type {const} */ ([
    ["package", typeof entry.package === "string" && entry.package !== ""],
    ["version", typeof entry.version === "string" && VERSION.test(entry.version)],
    ["bin", typeof entry.bin === "string" && BIN.test(entry.bin)],
    ["runtime", entry.runtime === "node"],
  ])) {
    if (!ok) {
      return refuse(`${file}: ${adapter} has an invalid ${field}`);
    }
  }
  const { version, bin } = /** @type {{ version: string, bin: string }} */ (entry);
  const notInstalled = `seat adapter ${adapter} ${version} is not installed under ${installRoot}; run: ${doc.install}`;
  const folder = join(installRoot, adapter, version);
  /** @type {unknown} */
  let marker;
  /** @type {string} */
  let realFolder;
  /** @type {string} */
  let realMarker;
  try {
    realFolder = realpathSync.native(folder);
    realMarker = realpathSync.native(join(realFolder, "installed.json"));
  } catch {
    return refuse(notInstalled);
  }
  // The marker is the version folder's own file, not a link to one elsewhere.
  if (!inside(realFolder, realMarker)) {
    return refuse(
      `${join(folder, "installed.json")} resolves outside ${folder} (${realMarker}); reinstall with: ${doc.install}`,
    );
  }
  try {
    marker = JSON.parse(readFileSync(realMarker, "utf8"));
  } catch {
    return refuse(notInstalled);
  }
  if (!isObject(marker)) {
    return refuse(notInstalled);
  }
  // The adapter is the agent's, whatever the entry says of itself.
  const wanted = { ...entry, adapter };
  for (const field of MARKED) {
    if (marker[field] !== wanted[/** @type {keyof typeof wanted} */ (field)]) {
      return refuse(
        `${join(folder, "installed.json")} does not match ${file} (${field}): reinstall with: ${doc.install}`,
      );
    }
  }
  /** @type {string} */
  let script;
  try {
    // The script is the file the installed package's own `bin` names, not what `.bin` holds: on Windows
    // npm leaves a shell shim there, which Node cannot run.
    const pkgDir = join(
      realFolder,
      "node_modules",
      .../** @type {string} */ (entry.package).split("/"),
    );
    const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
    const target = isObject(pkg) && isObject(pkg.bin) ? pkg.bin[bin] : undefined;
    if (typeof target !== "string" || target === "") {
      return refuse(notInstalled);
    }
    script = realpathSync.native(join(pkgDir, target));
  } catch {
    return refuse(notInstalled);
  }
  if (inside(base, realFolder) || inside(base, script)) {
    return refuse(`seat adapter ${adapter} ${version} is inside the review checkout (${script})`);
  }
  if (!inside(realFolder, script)) {
    return refuse(`${bin} resolves outside ${folder} (${script}); reinstall with: ${doc.install}`);
  }
  const node = resolveProgram("node", dirs, root, refuse);
  if (!node) {
    return refuse("node is not in the trusted program folders (the system's and --bin-dir)");
  }
  return { exe: node, args: [script] };
}

/**
 * The server's executable and arguments as the command line gave them, or, for a codex or claude seat
 * with no `--server-exe`, the adapter the version file names (`--adapters`, else the default file).
 * `--adapters` is refused when relative, empty, or with `--server-exe` or an agent that has no adapter.
 * @param {{ agent: string, serverExe: string, serverArgs: string[], adaptersGiven: boolean, adaptersArg: string, dirs: string[], root: string }} spec
 * @param {(message: string) => never} refuse
 * @returns {{ exe: string | undefined, args: string[] }}
 */
export function launchFromFlags(
  { agent, serverExe, serverArgs, adaptersGiven, adaptersArg, dirs, root },
  refuse,
) {
  if (adaptersGiven && !isAbsolute(adaptersArg)) {
    return refuse("--adapters needs the absolute path of the seat adapters file");
  }
  if (adaptersGiven && (serverExe || !(agent in ADAPTER_FOR))) {
    return refuse(
      `--adapters names the file that gives a ${Object.keys(ADAPTER_FOR).join(" or ")} seat its adapter; it cannot go with --server-exe or another agent`,
    );
  }
  if (!(agent in ADAPTER_FOR) || serverExe) {
    return { exe: serverExe || undefined, args: serverArgs };
  }
  const adapter = resolveAdapter(
    { agent, file: adaptersArg || adaptersFile(process.env), dirs, root },
    refuse,
  );
  return { exe: adapter.exe, args: [...adapter.args, ...serverArgs] };
}
