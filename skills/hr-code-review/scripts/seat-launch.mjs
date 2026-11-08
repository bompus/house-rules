// How acp-panel-client.mjs starts a seat: the environment it gets, which agent a launch command
// starts, the Codex wrapper that turns off MCP servers and the Devin config that denies shell and MCP.
// See ../references/acp-client.md. Imported by the client; keep this file beside it.
import { execFileSync } from "node:child_process";
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";

// A seat's environment: named locale, path, proxy and certificate variables plus its own agent's login
// variables; other keys, GH_TOKEN and SSH_AUTH_SOCK stay out. ACP_PANEL_PASS_ENV adds prefixes.
const BASE_ENV = new Set(
  "PATH HOME USER LOGNAME SHELL LANG LANGUAGE TERM TZ TMPDIR LC_ALL LC_CTYPE LC_COLLATE LC_MESSAGES LC_NUMERIC LC_TIME LC_MONETARY XDG_CONFIG_HOME XDG_DATA_HOME XDG_CACHE_HOME XDG_STATE_HOME XDG_RUNTIME_DIR BUN_INSTALL BUN_INSTALL_CACHE_DIR HTTP_PROXY HTTPS_PROXY NO_PROXY ALL_PROXY http_proxy https_proxy no_proxy all_proxy SSL_CERT_FILE SSL_CERT_DIR NODE_EXTRA_CA_CERTS".split(
    " ",
  ),
);
// Each agent and its login prefixes. The agent comes from the launch executable, the package a runner
// starts or the script an interpreter runs, never from other arguments (see seatAgent).
/** @type {[string, RegExp, string[]][]} */
const AGENTS = [
  ["codex", /^(@agentclientprotocol\/)?codex-acp(@[^/]*)?$|^codex$/, ["CODEX_", "OPENAI_"]],
  [
    "claude",
    /^(@agentclientprotocol\/)?claude-agent-acp(@[^/]*)?$|^claude$/,
    ["ANTHROPIC_", "CLAUDE_"],
  ],
  ["devin", /^devin$/, ["DEVIN_"]],
  ["grok", /^grok$/, ["GROK_", "XAI_"]],
  ["agy", /^(agy|agy_acp_server\.par|agy-acp)$/, ["GEMINI_", "GOOGLE_"]],
  ["cursor", /^(cursor-agent|cursor)(@[^/]*)?$/, ["CURSOR_"]],
];
// Windows variables a program needs to start; names there match without regard to case.
const WINDOWS = process.platform === "win32";
const WINDOWS_ENV =
  "SYSTEMROOT SYSTEMDRIVE WINDIR COMSPEC PATHEXT USERPROFILE USERNAME APPDATA LOCALAPPDATA TEMP TMP HOMEDRIVE HOMEPATH PROGRAMDATA PROGRAMFILES PROGRAMFILES(X86) PROCESSOR_ARCHITECTURE NUMBER_OF_PROCESSORS OS".split(
    " ",
  );
/** @param {string} name */
const fold = (name) => (WINDOWS ? name.toUpperCase() : name);
const PACKAGE_RUNNERS = new Set(["bunx", "npx", "pnpx"]);
const RUNNER_FLAGS = new Set("-y --yes -q --quiet --silent --bun --no-install".split(" "));
const SCRIPT_FILE = /\.[cm]?[jt]s$/i;
const SCRIPT_EXT = /\.[cm]?[jt]s$/i;
const ADAPTER_NAME = /^(codex-acp|claude-agent-acp|agy-acp|cursor-agent|devin)$/;
const INTERPRETERS = new Set(["node", "bun", "deno"]);
/**
 * The last path segment of a POSIX or Windows path, without a Windows executable suffix.
 * @param {string} s
 */
export function exeName(s) {
  return (s.split(/[\\/]/).at(-1) ?? s).replace(/\.(exe|cmd|bat)$/i, "");
}
/**
 * An executable's name for matching: no Windows suffix and no script extension (`codex-acp.js`).
 * @param {string} s
 */
const agentExe = (s) => exeName(s).replace(SCRIPT_EXT, "");
/**
 * The agent a script path belongs to: the nearest of its last four path segments that names an agent
 * (`cursor-agent/versions/<v>/index.js`), and not a home directory (`/home/claude/x.mjs`).
 * @param {string} script
 */
export function scriptAgent(script) {
  // The entry file's own name counts without its extension (`devin.mjs`, `codex-acp.js`).
  const parts = script.split(/[\\/]/);
  parts.push(parts.pop()?.replace(SCRIPT_EXT, "") ?? "");
  return parts
    .slice(-4)
    .reverse()
    .map((n) =>
      ["home", "Users"].includes(parts[parts.lastIndexOf(n) - 1] ?? "")
        ? undefined
        : AGENTS.find(([, re]) => re.test(n))?.[0],
    )
    .find((agent) => agent !== undefined);
}
/**
 * The script files an interpreter command names: plain arguments, and the value attached to a flag
 * (`--import=/opt/claude/preload.mjs`). A flag's separate value cannot be told from the entry script.
 * @param {string[]} cmd
 */
function interpreterScripts(cmd) {
  return cmd
    .slice(1)
    .map((a) => (a.startsWith("-") ? a.slice(a.indexOf("=") + 1) : a))
    .filter(
      (a) =>
        !a.startsWith("-") &&
        // A script file, or a path whose last part is an adapter's own name without an extension
        // (`tools/bin/codex-acp`). Bare product names (`claude`, `codex`) are too often a directory.
        (SCRIPT_FILE.test(a) || (/[\\/]/.test(a) && ADAPTER_NAME.test(exeName(a)))),
    );
}
/**
 * Whether a launch seatAgent cannot read could still start the agent `name`: the executable, a runner's
 * package or plain argument, or an interpreter's script is that agent. Other arguments (a title, a
 * working directory) do not count.
 * @param {string[]} cmd
 * @param {string} name
 */
export function mayStart(cmd, name) {
  const re = AGENTS.find(([agent]) => agent === name)?.[1];
  if (!re) {
    return false;
  }
  const exe = agentExe(cmd[0] ?? "");
  if (PACKAGE_RUNNERS.has(exe)) {
    return cmd
      .slice(1)
      .map((a) => (a.startsWith("--package=") ? a.slice("--package=".length) : a))
      .some((a) => !a.startsWith("-") && re.test(a));
  }
  if (INTERPRETERS.has(exe)) {
    return interpreterScripts(cmd).some((s) => scriptAgent(s) === name);
  }
  return re.test(exe);
}
/**
 * The one agent a launch command starts, or undefined.
 * @param {string[]} cmd
 */
export function seatAgent(cmd) {
  const exe = agentExe(cmd[0] ?? "");
  /** @type {string[]} */
  let names = [];
  if (PACKAGE_RUNNERS.has(exe)) {
    // The package comes after options that take no separate value. An option with one (`npx --cache
    // claude <package>`) would make its value look like the package, so such a command selects nothing.
    /** @type {string | undefined} */
    let pkg;
    let first;
    for (const a of cmd.slice(1)) {
      if (a.startsWith("--package=")) {
        if (pkg !== undefined) {
          return undefined; // two packages: which one runs is the runner's choice
        }
        pkg = a.slice("--package=".length);
      } else if (RUNNER_FLAGS.has(a) || (a.startsWith("--") && a.includes("="))) {
        continue;
      } else if (a.startsWith("-")) {
        return undefined;
      } else {
        first = a;
        break;
      }
    }
    // With `--package=`, the plain argument after it is the command the runner runs; it must name the
    // same agent as the package, or the launch is ambiguous (`--package=<claude> codex-acp`).
    if (pkg !== undefined && first !== undefined) {
      const of = (/** @type {string} */ n) => AGENTS.find(([, re]) => re.test(n))?.[0];
      if (of(pkg) !== of(first)) {
        return undefined;
      }
    }
    names = [pkg ?? first ?? ""];
  } else if (INTERPRETERS.has(exe)) {
    // Every script file named on the command line counts, because a flag's value (`node --import
    // /opt/claude/preload.mjs /opt/grok/server.mjs`) looks like the script: the agent is known only when
    // they all point to the same one, and an ambiguous command selects nothing.
    // A flag's attached value (`--import=/opt/claude/preload.mjs`) counts the same way.
    const agents = interpreterScripts(cmd).map(scriptAgent);
    return agents.length > 0 && agents.every((a) => a === agents[0]) ? agents[0] : undefined;
  } else {
    names = [exe];
  }
  return AGENTS.find(([, re]) => names.some((n) => re.test(n)))?.[0];
}
// The names `agy` goes by: the CLI, its ACP server wrapper and its packaged server.
const AGY_NAME = /^(agy|agy-acp|agy_acp_server\.par)$/i;
/**
 * Whether a launch command may start Antigravity's `agy acp`, which runs the MCP servers, plugins and
 * hooks it finds in the working directory's agent folders at the first prompt. Any argument counts
 * where it names agy (after splitting on spaces and shell punctuation, so `sh -c "agy acp"`, `env X=1
 * agy acp`, `env --split-string="agy acp"`, a runner's package and a script path all match), and so
 * does any word that is, or that `PATH` resolves to, a link to agy (looked up from `cwd`, where the
 * launch runs). A name written to hide it (shell quoting inside the name, a renamed copy) is not
 * detected; the check catches a mistake, it is not a boundary against a caller that hides the launch.
 * @param {string[]} cmd
 * @param {string} [pathVar] the PATH to look the executable up on
 * @param {string} [cwd] the directory the launch runs in
 */
export function mayStartAgy(cmd, pathVar = process.env.PATH, cwd = process.cwd()) {
  const named = (/** @type {string} */ token) => {
    const base = agentExe(token).replace(/^(.+)@[^/@]*$/, "$1");
    // A script file also counts by the agent folder it sits in, as seatAgent reads it.
    return AGY_NAME.test(base) || (SCRIPT_FILE.test(token) && scriptAgent(token) === "agy");
  };
  // A literal `PATH=...` in the command (`env PATH=/x antigravity`) is searched before the inherited
  // PATH; an empty entry means the working directory.
  const assigned = cmd.flatMap((arg) =>
    arg
      .split(/[\s;&|()<>"'`]+/)
      .filter((t) => t.startsWith("PATH="))
      .map((t) => t.slice(5)),
  );
  const pathDirs = [...assigned, pathVar ?? ""]
    .flatMap((value) => value.split(delimiter))
    .map((d) => resolve(cwd, d));
  const real = (/** @type {string} */ candidate) => {
    try {
      return realpathSync(candidate);
    } catch {
      return undefined;
    }
  };
  // Whether a word is a link to agy: by its path from `cwd`, or, for a bare word, the first executable
  // of that name on PATH (the one the shell would run).
  const resolvesToAgy = (/** @type {string} */ word) => {
    if (/[\\/]/.test(word)) {
      const target = real(resolve(cwd, word));
      return target !== undefined && named(target);
    }
    if (!/^[\w.@+-]+$/.test(word)) {
      return false;
    }
    for (const dir of pathDirs) {
      const candidate = join(dir, word);
      try {
        accessSync(candidate, constants.X_OK);
      } catch {
        continue;
      }
      const target = real(candidate);
      return target !== undefined && named(target);
    }
    return false;
  };
  const counts = (/** @type {string} */ word) =>
    word !== "" && (named(word) || resolvesToAgy(word));
  for (const arg of cmd) {
    // The argument as written (a path with spaces in it), then its words.
    if (counts(arg)) {
      return true;
    }
    for (const token of arg.split(/[\s;&|()<>"'`]+/)) {
      // An option's attached value counts too (`--split-string=agy acp`, `-Sagy`).
      const forms = [token];
      if (token.includes("=")) {
        forms.push(token.slice(token.indexOf("=") + 1));
      }
      if (/^-S./.test(token)) {
        forms.push(token.slice(2));
      }
      if (forms.some(counts)) {
        return true;
      }
    }
  }
  return false;
}
// Claude Code's reading of a switch such as CLAUDE_CODE_USE_BEDROCK.
/** @param {string | undefined} v */
const switchedOn = (v) => /^(1|true|yes|on)$/i.test(v ?? "");
/**
 * @param {NodeJS.ProcessEnv} env
 * @param {string[]} cmd
 * @param {string[]} extraPrefixes
 */
export function seatEnv(env, cmd, extraPrefixes) {
  const agent = seatAgent(cmd);
  const own = AGENTS.find(([name]) => name === agent)?.[2] ?? [];
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
function privateDir() {
  if (!privateDirPath) {
    privateDirPath = mkdtempSync(join(tmpdir(), "acp-panel-"));
    chmodSync(privateDirPath, 0o700);
    const dir = privateDirPath;
    process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  }
  return privateDirPath;
}
// codex-acp starts the program named by CODEX_PATH as Codex. Every Codex seat runs through a wrapper
// that turns off each MCP server `codex mcp list --json` names (an override of `mcp_servers={}` would
// merge, so each is named) and, under --no-web, web search and the apps connector.
/**
 * @param {NodeJS.ProcessEnv} env
 * @param {boolean} offline
 * @param {string} cwd the review root: Codex adds that checkout's own MCP servers to the user's
 * @param {(message: string) => never} refuse
 */
export function codexWrapper(env, offline, cwd, refuse) {
  /** @param {string} why */
  const cannot = (why) => refuse(`cannot turn off Codex's MCP servers: ${why}`);
  if (process.platform === "win32") {
    cannot("unsupported on Windows");
  }
  const real = env.CODEX_PATH || "codex";
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
  // show: that table is dropped, and the rest of the caller's configuration stays.
  let configJson = env.CODEX_CONFIG;
  if (configJson) {
    try {
      const { mcp_servers: _dropped, ...rest } = JSON.parse(configJson);
      configJson = JSON.stringify(rest);
    } catch {
      cannot("CODEX_CONFIG is not valid JSON");
    }
  }
  const wrapper = join(privateDir(), "codex-no-web");
  writeFileSync(
    wrapper,
    `#!/usr/bin/env bash\nexec "\${CODEX_NO_WEB_REAL:-codex}" "$@" ${off.map((o) => `-c '${o}'`).join(" ")}\n`,
    { mode: 0o700 },
  );
  return {
    ...env,
    CODEX_NO_WEB_REAL: real,
    CODEX_PATH: wrapper,
    ...(configJson ? { CODEX_CONFIG: configJson } : {}),
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
/**
 * @param {string[]} cmd
 * @param {boolean} offline
 * @param {string} dir
 * @param {(message: string) => never} refuse
 */
export function devinConfig(cmd, offline, dir, refuse) {
  if (seatAgent(cmd) !== "devin") {
    // A launch the client cannot read (`npx --cache DIR devin acp`, `node --import x.mjs devin/index.js`)
    // may still start Devin, and Devin without the deny config would run its project hooks and MCP
    // servers: it is refused, not passed on.
    if (mayStart(cmd, "devin")) {
      refuse(
        "this launch may start Devin but the client cannot tell how; write it as `devin ...`, `bunx devin ...` or `npx -y devin ...`",
      );
    }
    return cmd;
  }
  // Devin's cloud mode relays the session to a remote agent, which has its own MCP servers and tools: the
  // local deny rules and the offline check do not reach it.
  if (
    cmd.some(
      (a, i) =>
        a === "--cloud" ||
        a.startsWith("--cloud=") ||
        (a === "cloud" && i > 0 && exeName(cmd[i - 1] ?? "") === "devin"),
    )
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
    JSON.stringify({ ...base, permissions: { ...base.permissions, deny } }, null, 2),
    {
      mode: 0o600,
    },
  );
  const kept = at < 0 ? cmd : [...cmd.slice(0, at), ...cmd.slice(at + (attached ? 1 : 2))];
  // `--config` goes right after Devin itself: its own executable, the name a runner starts, or the last
  // Devin script among an interpreter's plain arguments (a preload comes before the entry script), never
  // before an interpreter's script.
  const devin = Math.max(
    0,
    kept.findLastIndex(
      (a, i) =>
        i > 0 &&
        !a.startsWith("-") &&
        (exeName(a) === "devin" || (SCRIPT_FILE.test(a) && scriptAgent(a) === "devin")),
    ),
  );
  return [...kept.slice(0, devin + 1), "--config", config, ...kept.slice(devin + 1)];
}
