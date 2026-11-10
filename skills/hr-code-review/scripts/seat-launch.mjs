// What a seat's server starts with: the environment it gets, the Codex wrapper that turns off MCP servers and
// the Devin config that denies shell and MCP. See ../references/acp-client.md. Imported by the client; keep
// this file beside seat-paths.mjs, seat-spec.mjs and seat-hooks.mjs.
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { constants as osConstants, tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { resolveProgram } from "./seat-paths.mjs";

// A seat's environment: named locale, path, proxy and certificate variables plus its own agent's login
// variables; other keys, GH_TOKEN and SSH_AUTH_SOCK stay out. ACP_PANEL_PASS_ENV adds prefixes.
const BASE_ENV = new Set(
  "PATH HOME USER LOGNAME SHELL LANG LANGUAGE TERM TZ TMPDIR LC_ALL LC_CTYPE LC_COLLATE LC_MESSAGES LC_NUMERIC LC_TIME LC_MONETARY XDG_CONFIG_HOME XDG_DATA_HOME XDG_CACHE_HOME XDG_STATE_HOME XDG_RUNTIME_DIR HTTP_PROXY HTTPS_PROXY NO_PROXY ALL_PROXY http_proxy https_proxy no_proxy all_proxy SSL_CERT_FILE SSL_CERT_DIR NODE_EXTRA_CA_CERTS".split(
    " ",
  ),
);
// Each agent's login prefixes: its own variables pass to its seat and no other agent's do.
/** @type {Record<string, string[]>} */
export const LOGIN_PREFIXES = {
  codex: ["CODEX_", "OPENAI_"],
  claude: ["ANTHROPIC_", "CLAUDE_"],
  devin: ["DEVIN_"],
  grok: ["GROK_", "XAI_"],
  agy: ["GEMINI_", "GOOGLE_"],
  cursor: ["CURSOR_"],
};
// Windows variables a program needs to start; names there match without regard to case.
const WINDOWS = process.platform === "win32";
const WINDOWS_ENV =
  "SYSTEMROOT SYSTEMDRIVE WINDIR COMSPEC PATHEXT USERPROFILE USERNAME APPDATA LOCALAPPDATA TEMP TMP HOMEDRIVE HOMEPATH PROGRAMDATA PROGRAMFILES PROGRAMFILES(X86) PROCESSOR_ARCHITECTURE NUMBER_OF_PROCESSORS OS".split(
    " ",
  );
/** @param {string} name */
const fold = (name) => (WINDOWS ? name.toUpperCase() : name);
/**
 * The last path segment of a POSIX or Windows path, without a Windows executable suffix.
 * @param {string} s
 */
export function exeName(s) {
  return (s.split(/[\\/]/).at(-1) ?? s).replace(/\.(exe|cmd|bat)$/i, "");
}
/**
 * The environment git runs with: a seat's narrowed one plus the variables that locate a repository, and
 * the server's PATH (the folder of links from programFolder), so a `#!` interpreter git or a hook names
 * is not the checkout's.
 * @param {string} pathValue the PATH
 * @returns {Record<string, string | undefined>}
 */
export function gitEnvironment(pathValue) {
  return {
    ...seatEnv(
      process.env,
      "",
      "GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_CEILING_DIRECTORIES GIT_DISCOVERY_ACROSS_FILESYSTEM GIT_CONFIG_GLOBAL GIT_CONFIG_SYSTEM GIT_CONFIG_NOSYSTEM GIT_EXEC_PATH GIT_TEMPLATE_DIR".split(
        " ",
      ),
    ),
    LC_ALL: "C",
    PATH: pathValue,
  };
}
/**
 * The git program the client runs, from the trusted folders. None there is "no git program": the error
 * carries `code: "ENOENT"`, as a missing executable does.
 * @param {string[]} dirs
 * @param {string} root
 */
export function gitProgram(dirs, root) {
  const program = resolveProgram("git", dirs, root, (message) => {
    throw new Error(message);
  });
  if (!program) {
    throw Object.assign(new Error("no git in the trusted program folders"), { code: "ENOENT" });
  }
  return program;
}
/** The refusal for an agy launch the caller has not declared masked. */
export const AGY_UNMASKED =
  "the launch may start agy, which runs the hooks, plugins and MCP servers in the .agents, .agent, _agents and _agent folders of the working directory and its parents; mask those folders and pass --policy-option agy-masked";
// Claude Code's reading of a switch such as CLAUDE_CODE_USE_BEDROCK.
/** @param {string | undefined} v */
const switchedOn = (v) => /^(1|true|yes|on)$/i.test(v ?? "");
/**
 * The names a seat keeps from the caller's environment: the base list and its own agent's login
 * prefixes (`agent` is a key of LOGIN_PREFIXES, or empty for none), plus `extraPrefixes`. PATH and the
 * path-valued names are set and checked by the caller (seat-paths.mjs, seat-spec.mjs).
 * @param {NodeJS.ProcessEnv} env
 * @param {string} agent
 * @param {string[]} extraPrefixes
 */
export function seatEnv(env, agent, extraPrefixes) {
  const own = LOGIN_PREFIXES[agent] ?? [];
  // A Claude seat that logs in through AWS or Google Cloud reads that route's credentials and region
  // from the environment.
  const cloud =
    agent !== "claude"
      ? []
      : [
          ...(switchedOn(env.CLAUDE_CODE_USE_BEDROCK) ? ["AWS_"] : []),
          ...(switchedOn(env.CLAUDE_CODE_USE_VERTEX)
            ? [
                "GOOGLE_APPLICATION_CREDENTIALS",
                "GOOGLE_CLOUD_PROJECT",
                "CLOUD_ML_REGION",
                "VERTEX_REGION_",
              ]
            : []),
        ];
  const prefixes = [...own, ...cloud, ...extraPrefixes.filter((p) => p.length > 0)].map(fold);
  const named = new Set([...BASE_ENV, ...(WINDOWS ? WINDOWS_ENV : [])].map(fold));
  /** @type {NodeJS.ProcessEnv} */
  const out = {};
  for (const [name, value] of Object.entries(env)) {
    const key = fold(name);
    if (value !== undefined && (named.has(key) || prefixes.some((p) => key.startsWith(p)))) {
      out[name] = value;
    }
  }
  return out;
}

// The files the client writes for a seat live in one private directory, removed when it exits.
/** @type {string | undefined} */
let privateDirPath;
const UNQUOTABLE = process.platform === "win32" ? /[\s"'`]/ : /[\s"'`\\]/;
export function privateDir() {
  if (!privateDirPath) {
    privateDirPath = mkdtempSync(join(tmpdir(), "acp-panel-"));
    chmodSync(privateDirPath, 0o700);
    const dir = privateDirPath;
    process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
    // A stop that arrives while the folder is being filled (a login copied into it, say) ends the client
    // through the exit hook above; with no handler the process would die without it. Once the client
    // installs its own handlers for these signals this one stands aside.
    for (const sig of /** @type {const} */ (["SIGTERM", "SIGINT", "SIGHUP"])) {
      process.on(sig, () => {
        if (process.listenerCount(sig) === 1) {
          process.exit(128 + osConstants.signals[sig]);
        }
      });
    }
  }
  // `BUN_OPTIONS` has no quoting, and PATH is split on the separator: the folder's path must carry
  // neither, so a TMPDIR that does is a refusal, not a seat that starts with the wrong options.
  if (UNQUOTABLE.test(privateDirPath) || privateDirPath.includes(delimiter)) {
    throw new Error(
      `the private folder ${privateDirPath} has whitespace, a quote, a backslash or "${delimiter}" in its path; set TMPDIR (TEMP on Windows) to a folder without them`,
    );
  }
  return privateDirPath;
}
// codex-acp starts the program named by CODEX_PATH as Codex. Every Codex seat runs through a wrapper
// that turns off each MCP server `codex mcp list --json` names (an override of `mcp_servers={}` would
// merge, so each is named) and, under --no-web, web search and the apps connector.
/**
 * The Codex program `codex mcp list` runs: `CODEX_PATH` when set, else `codex`, each held to the rule of
 * resolveProgram (an absolute path to a regular executable outside the checkout, or a bare name found
 * in the trusted folders). The path, or undefined when none runs.
 * @param {NodeJS.ProcessEnv} env
 * @param {string} cwd the review root
 * @param {string[]} dirs the trusted program folders
 * @param {(message: string) => never} refuse
 */
function codexProgram(env, cwd, dirs, refuse) {
  return resolveProgram(env.CODEX_PATH || "codex", dirs, cwd, refuse);
}
/**
 * @param {NodeJS.ProcessEnv} env
 * @param {boolean} offline
 * @param {string} cwd the review root: Codex adds that checkout's own MCP servers to the user's
 * @param {string[]} dirs the trusted program folders
 * @param {(message: string) => never} refuse
 */
export function codexWrapper(env, offline, cwd, dirs, refuse) {
  const cannot = /** @type {(why: string) => never} */ (
    (/** @type {string} */ why) => refuse(`cannot turn off Codex's MCP servers: ${why}`)
  );
  if (process.platform === "win32") {
    cannot("unsupported on Windows");
  }
  const real = codexProgram(env, cwd, dirs, refuse);
  if (!real) {
    return cannot(
      "`codex` (or CODEX_PATH) must name a regular executable outside the review root: a bare name is looked up in the trusted program folders, an explicit path must be absolute",
    );
  }
  /** @type {({ name?: unknown } | null)[]} */
  let servers = [];
  try {
    servers = JSON.parse(
      execFileSync(real, ["mcp", "list", "--json"], {
        encoding: "utf8",
        env,
        cwd,
        timeout: 30_000,
      }),
    );
  } catch (e) {
    cannot(`\`${real} mcp list --json\` failed (${String(e).slice(0, 200)})`);
  }
  if (!Array.isArray(servers)) {
    cannot("`codex mcp list --json` did not print a list");
  }
  const off = offline ? ['web_search="disabled"', "features.apps=false"] : [];
  for (const entry of servers) {
    const name = entry?.name;
    if (typeof name !== "string" || !/^[A-Za-z0-9_-]+$/.test(name)) {
      cannot(`MCP server name ${JSON.stringify(name)} cannot be turned off safely`);
    }
    off.push(`mcp_servers.${name}.enabled=false`);
  }
  // codex-acp adds the servers of a CODEX_CONFIG table to the session, which `codex mcp list` does not
  // show: that table is dropped, and the rest of the caller's configuration stays. The session's `hooks`
  // feature is off, so no hook of the user or of the checkout runs in the seat (a `-c` override on the
  // wrapper's command line does not reach the hooks; this session setting does).
  let configJson = env.CODEX_CONFIG;
  try {
    const { mcp_servers: _dropped, ...rest } = configJson ? JSON.parse(configJson) : {};
    const features = rest.features;
    if (
      features !== undefined &&
      (typeof features !== "object" || features === null || Array.isArray(features))
    ) {
      cannot("CODEX_CONFIG features is not an object");
    }
    configJson = JSON.stringify({ ...rest, features: { ...features, hooks: false } });
  } catch {
    cannot("CODEX_CONFIG is not valid JSON");
  }
  const wrapper = join(privateDir(), "codex-no-web");
  writeFileSync(
    wrapper,
    `#!/bin/sh\nexec "\${CODEX_NO_WEB_REAL:-codex}" "$@" ${off.map((o) => `-c '${o}'`).join(" ")}\n`,
    { mode: 0o700 },
  );
  return {
    ...env,
    CODEX_NO_WEB_REAL: real,
    CODEX_PATH: wrapper,
    CODEX_CONFIG: configJson,
  };
}
// Devin runs its shell, MCP tools and web search without asking, so it starts with a config denying its
// shell and every MCP operation (and, under --no-web, fetches, web search and subagents). `--config`
// replaces the user config, so this one is the config Devin would have read (the launch's own, resolved
// against the seat's directory, else the user config) with the rules added, private and removed at exit.
const DEVIN_DENY =
  "exec mcp__* mcp_call_tool mcp_read_resource mcp_list_tools mcp_list_resources".split(" ");
const DEVIN_OFFLINE = ["Fetch(*)", "web_search", "webfetch", "run_subagent"];
// Other tools whose settings Devin can import (MCP servers, hooks, rules); all are switched off.
const DEVIN_IMPORTS =
  "claude cursor opencode windsurf zed vscode copilot agents_standard cloud".split(" ");
/**
 * The seat directory and its parents, real paths, up to the project root Devin uses (a directory
 * holding `.git` or `.jj`); without one, every parent below the home folder, whose `~/.devin` is Devin's
 * own data (the home folder counts only when it is itself the project root). A project `.devin`
 * folder anywhere here can hold settings, MCP servers or hooks that Devin loads above the user config.
 * @param {string} dir
 */
function projectDirs(dir) {
  const home = realpathSync(process.env.HOME || "/");
  /** @type {string[]} */
  const dirs = [];
  const isRoot = (/** @type {string} */ d) =>
    existsSync(join(d, ".git")) || existsSync(join(d, ".jj"));
  for (let d = realpathSync(dir); ; d = dirname(d)) {
    if (d === home && !isRoot(d)) {
      return dirs;
    }
    dirs.push(d);
    if (isRoot(d) || dirname(d) === d) {
      return dirs;
    }
  }
}
/**
 * The servers in a parsed config's `mcpServers` that are not switched off.
 * @param {any} config parsed JSON, which may be null or not an object
 */
function enabledIn(config) {
  /** @type {Record<string, { disabled?: boolean, enabled?: boolean } | null>} */
  const servers = config?.mcpServers ?? {};
  return Object.entries(servers)
    .filter(([, s]) => s?.disabled !== true && s?.enabled !== false)
    .map(([name]) => name);
}
/** Devin's config may carry comments; Bun parses those, other runtimes read plain JSON only. */
const parseConfig = (/** @type {string} */ text) =>
  (/** @type {any} */ (globalThis).Bun?.JSONC?.parse ?? JSON.parse)(text);
/** @param {string} file */
function enabledMcpServers(file) {
  if (!existsSync(file)) {
    return [];
  }
  try {
    return enabledIn(parseConfig(readFileSync(file, "utf8")));
  } catch {
    return undefined; // present but unreadable here: its servers are unknown
  }
}
/** @type {string | undefined} */
let emptyBunfigPath;
/** An existing empty TOML file for Bun's `--config=`, in the private folder. */
export function emptyBunfig() {
  if (!emptyBunfigPath) {
    emptyBunfigPath = join(privateDir(), "empty-bunfig.toml");
    writeFileSync(emptyBunfigPath, "", { mode: 0o600 });
  }
  return emptyBunfigPath;
}
/**
 * @param {string[]} cmd
 * @param {boolean} offline
 * @param {string} dir
 * @param {(message: string) => never} refuse
 */
export function devinConfig(cmd, offline, dir, refuse) {
  // Devin's cloud mode relays the session to a remote agent, which has its own MCP servers and tools: the
  // local deny rules and the offline check do not reach it.
  if (
    cmd.some((a, i) => a === "--cloud" || a.startsWith("--cloud=") || (a === "cloud" && i === 1))
  ) {
    refuse("Devin's cloud mode runs the session remotely, where the panel's rules do not apply");
  }
  const isConfig = (/** @type {string} */ a) => a === "--config" || a.startsWith("--config=");
  if (cmd.filter(isConfig).length > 1) {
    refuse("the Devin launch names --config more than once");
  }
  const at = cmd.findIndex(isConfig);
  const attached = at >= 0 && (cmd[at] ?? "").startsWith("--config=");
  const named = at < 0 ? undefined : attached ? (cmd[at] ?? "").slice(9) : cmd[at + 1];
  for (const d of projectDirs(dir)) {
    if (existsSync(join(d, ".devin"))) {
      refuse(
        `${join(d, ".devin")} can hold Devin settings, MCP servers or hooks that run before the panel's rules apply`,
      );
    }
  }
  const userConfig =
    process.platform === "win32" && !process.env.XDG_CONFIG_HOME
      ? join(process.env.APPDATA ?? "", "devin", "config.json")
      : `${process.env.XDG_CONFIG_HOME || `${process.env.HOME}/.config`}/devin/config.json`;
  const source = named === undefined ? userConfig : resolve(dir, named);
  /** @type {{ permissions?: { deny?: string[] }, read_config_from?: Record<string, unknown> } & Record<string, unknown>} */
  let base = { version: 1 };
  if (named !== undefined || existsSync(source)) {
    try {
      base = parseConfig(readFileSync(source, "utf8"));
    } catch (e) {
      refuse(`cannot read Devin config ${source}: ${String(e).slice(0, 200)}`);
    }
  }
  const shape = /** @type {unknown} */ (base);
  if (!shape || typeof shape !== "object" || Array.isArray(shape)) {
    refuse(`Devin config ${source} is not a JSON object`);
  }
  const listedDeny = base.permissions?.deny;
  if (listedDeny !== undefined && !Array.isArray(listedDeny)) {
    refuse(`Devin config ${source}: permissions.deny is not a list`);
  }
  const required = offline ? [...DEVIN_DENY, ...DEVIN_OFFLINE] : DEVIN_DENY;
  const deny = [...new Set([...(listedDeny ?? []), ...required])];
  // Imports from other tools (their MCP servers start with the session, a checkout's `.mcp.json` or
  // `.cursor/mcp.json` among them) are switched off in every mode; sources already listed stay off.
  base = {
    ...base,
    read_config_from: Object.fromEntries(
      [...new Set([...Object.keys(base.read_config_from ?? {}), ...DEVIN_IMPORTS])].map((k) => [
        k,
        false,
      ]),
    ),
  };
  // Offline, Devin's own MCP servers would still connect at startup and nothing switches them off per
  // session, so an offline seat with one enabled is refused. Devin loads its user MCP config whichever
  // config file it is given, so that one is checked too.
  const mcpFiles = [...new Set([dirname(userConfig), dirname(source)])].map((d) =>
    join(d, "mcp_config.json"),
  );
  const listed = mcpFiles.map((f) => [f, enabledMcpServers(f)]);
  const unreadable = listed.filter(([, servers]) => servers === undefined).map(([f]) => f);
  if (offline && unreadable.length > 0) {
    refuse(
      `--no-web: cannot read ${unreadable.join(", ")} to check that no Devin MCP server is enabled (comments in it need Bun)`,
    );
  }
  const native = [
    ...new Set([...listed.flatMap(([, servers]) => servers ?? []), ...enabledIn(base)]),
  ];
  if (offline && native.length > 0) {
    refuse(
      `--no-web: Devin MCP servers ${native.join(", ")} connect at startup; disable them (devin mcp disable) or run without --no-web`,
    );
  }
  const config = join(privateDir(), "devin-config.json");
  writeFileSync(
    config,
    // The user's hooks and MCP servers are left out (a seat needs neither): the hooks would run in the
    // seat, and a server in the config would be one more place Devin could start one from.
    JSON.stringify(
      { ...base, hooks: {}, mcpServers: {}, permissions: { ...base.permissions, deny } },
      null,
      2,
    ),
    {
      mode: 0o600,
    },
  );
  const kept = at < 0 ? cmd : [...cmd.slice(0, at), ...cmd.slice(at + (attached ? 1 : 2))];
  // `--config` goes right after Devin's own executable.
  return [cmd[0] ?? "", "--config", config, ...kept.slice(1)];
}
