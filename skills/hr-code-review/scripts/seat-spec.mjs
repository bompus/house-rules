// A seat's server as a typed launch: an agent name, an executable and its arguments become the command,
// the environment and the starting folder, built from the trusted program folders and an allowlist of
// the caller's environment, never filtered out of a command and an environment the caller shaped. See
// ../references/acp-client.md.
import { existsSync, mkdtempSync, readlinkSync, realpathSync, statSync } from "node:fs";
import { basename, delimiter, dirname, isAbsolute, join, sep } from "node:path";
import { emptyBunfig, exeName, privateDir, seatEnv } from "./seat-launch.mjs";
import { checkEnvPaths, inside, resolveProgram, reviewBase } from "./seat-paths.mjs";

/**
 * What each agent starts as. `exe` and `args` are what a launch with no `--server-exe` runs (a bare name
 * looked up in the trusted folders); `start` is where its server starts: "private" is an empty folder of
 * the client's own, with the review root reaching the agent only as the session's working directory.
 * Antigravity's tools run in the process's directory, so it is the one that starts in the review root, with
 * the same program folders and environment. Cursor and Grok start in the private folder too; neither has
 * been checked on a live adapter to take its directory from the session.
 * @type {Record<string, { exe?: string, args: string[], start: "private" | "root" }>}
 */
export const PROFILES = {
  codex: { args: [], start: "private" },
  claude: { args: [], start: "private" },
  devin: { exe: "devin", args: ["acp"], start: "private" },
  agy: { exe: "agy", args: ["acp"], start: "root" },
  cursor: { exe: "cursor-agent", args: [], start: "private" },
  grok: { exe: "grok", args: [], start: "private" },
  other: { args: [], start: "private" },
};
export const SEAT_AGENTS = Object.keys(PROFILES);
// The names an agent's own program goes by: `other` is not for them, so a launch that is one is not
// given the uniform treatment under a name that skips the agent's own rules. A guard against a mistake,
// not a boundary against a caller that hides the program.
const AGENT_PROGRAM =
  /^(devin|agy|agy-acp|agy_acp_server\.par|codex-acp|claude-agent-acp|cursor-agent|grok)$/i;
const RUNNERS = new Set(["bunx", "npx", "npx-cli", "pnpx"]);
const RUNTIMES = new Set(["node", "bun", "deno"]);
// Programs that start another program named in their arguments. The client sets the environment and
// starts the server itself, so nothing needs one, and one would let a command restore a PATH, name a
// package runner or start an agent under another name.
const WRAPPERS = new Set(
  "env sh bash dash ash zsh ksh csh tcsh fish cmd powershell pwsh wsl wscript cscript mshta busybox coreutils xargs nohup nice ionice timeout time setsid sudo doas su stdbuf chroot unshare nsenter flock taskset chrt command exec strace ltrace watch parallel".split(
    " ",
  ),
);
// What the caller's environment can never inject into a seat, whatever prefixes it passes: each runs or
// loads code before the server's own. The client sets BUN_OPTIONS itself, below.
const INJECTORS =
  /^(NODE_OPTIONS|NODE_PATH|NODE_EXTRA_.*_HOOK.*|BASH_ENV|ENV|BUN_OPTIONS|LD_.*|DYLD_.*|GCONV_PATH|LOCPATH|NLSPATH|PYTHON.*|RUBY.*|GEM_(HOME|PATH|ROOT)|PERL.*|JAVA_TOOL_OPTIONS|_JAVA_OPTIONS|JDK_JAVA_OPTIONS|CLASSPATH|DOTNET_STARTUP_HOOKS)$/i;
// The flags of `deno run` that only grant or deny a permission or quiet it, with an attached value at most.
const DENO_PERMISSION_FLAG =
  /^(-A|-q|--quiet|--no-prompt|--no-check|--no-lock|--cached-only|--(allow|deny)-[a-z-]+(=.*)?)$/;
const SCRIPT_EXT = /\.[cm]?[jt]s$/i;

/**
 * The names a program goes by along its links: the name it was found under, each link's target, the
 * file at the end (`renamed -> npx -> npx-cli.js` is three names).
 * @param {string} path
 */
function chainNames(path) {
  const names = [exeName(path)];
  let at = path;
  for (let i = 0; i < 40; i++) {
    let target;
    try {
      target = readlinkSync(at);
    } catch {
      break;
    }
    // A relative target is read from the folder the link is in, as the system reads it: `hop/..` goes
    // through the link `hop`, so the target is not normalized by cutting names off as text.
    try {
      at = isAbsolute(target) ? target : `${realpathSync.native(dirname(at))}${sep}${target}`;
    } catch {
      break;
    }
    names.push(exeName(at));
  }
  return names;
}

/**
 * The launch of a seat's server.
 * @param {{ agent: string, exe?: string, args: string[], root: string, dirs: string[], extraPrefixes: string[], pathValue?: string }} spec
 *   `exe` is an absolute path, or absent for an agent whose profile names one; `dirs` is the trusted
 *   program folders (trustedDirs); `root` is the review root; `pathValue` is the server's PATH (the
 *   folder of links from programFolder; the trusted folders themselves when absent).
 * @param {(message: string) => never} refuse
 * @returns {{ cmd: string[], argv0: string | undefined, env: Record<string, string | undefined>, cwd: string, start: "private" | "root" }}
 */
export function seatSpec({ agent, exe, args, root, dirs, extraPrefixes, pathValue }, refuse) {
  const profile = PROFILES[agent];
  if (!profile) {
    return refuse(`--seat-agent ${agent} is not one of ${SEAT_AGENTS.join(", ")}`);
  }
  if (exe !== undefined && !isAbsolute(exe)) {
    return refuse(`--server-exe ${exe} must be an absolute path`);
  }
  const wanted = exe ?? profile.exe;
  if (!wanted) {
    return refuse(`--seat-agent ${agent} needs --server-exe with the absolute path of its server`);
  }
  const program = resolveProgram(wanted, dirs, root, refuse);
  if (!program) {
    return refuse(
      exe === undefined
        ? `${wanted} is not in the trusted program folders (the system's and --bin-dir)`
        : `${wanted} is not a regular executable file`,
    );
  }
  const found = isAbsolute(wanted)
    ? wanted
    : (dirs.map((d) => join(d, wanted)).find(existsSync) ?? program);
  const names = [...new Set([...chainNames(found), exeName(program)])];
  const full = [...profile.args, ...args];
  const interpreter = [...RUNTIMES].find((n) => names.includes(n));
  // Where the script stands in the arguments: first for `bun` and `node`, after `run` and the
  // permission flags for `deno`. Only those flags may stand between `run` and the script: any other
  // (`--preload`, `--import-map`, `--config`, `--require`) can load code, and a flag's value could be
  // mistaken for the script.
  let at = 0;
  if (interpreter === "deno") {
    at = full[0] === "run" ? 1 : -1;
    while (at > 0 && DENO_PERMISSION_FLAG.test(full[at] ?? "")) {
      at++;
    }
  }
  const script = interpreter && at >= 0 ? full[at] : undefined;
  // The names the script goes by along its own links, as the program's are (an absolute script only: a
  // relative one would be read from the private folder).
  const bare = (/** @type {string} */ n) => n.replace(SCRIPT_EXT, "");
  const scriptNames = script && isAbsolute(script) ? chainNames(script).map(bare) : [];
  const runner = [...names.map(bare), ...scriptNames].find((n) => RUNNERS.has(n));
  if (runner) {
    return refuse(
      `${runner} is a package runner, which fetches and runs code at review time; install the adapter and give its absolute path`,
    );
  }
  const wrapper = names.find((n) => WRAPPERS.has(n));
  if (wrapper) {
    return refuse(
      `${wrapper} starts another program; give that program as --server-exe, since the client sets the environment and starts it itself`,
    );
  }
  if (agent === "other") {
    const named = [
      ...names,
      ...scriptNames,
      ...(script ? [basename(script), basename(dirname(script))] : []),
    ];
    if (named.some((n) => AGENT_PROGRAM.test(bare(n)))) {
      return refuse(
        `${program} or its script is an agent's own program; name it with --seat-agent`,
      );
    }
  }
  if (interpreter) {
    // `bun SCRIPT`, `node SCRIPT`, `deno run [permission flags] SCRIPT` only: no subcommand and no option of
    // the caller's before the script (a later `--config` could undo what BUN_OPTIONS below sets, a
    // `--require` runs a file first), and the script an absolute file outside the checkout, so the
    // server is never code the checkout supplies.
    let ok = false;
    const given = script;
    if (given && isAbsolute(given)) {
      try {
        const real = realpathSync.native(given);
        ok = statSync(real).isFile() && !inside(reviewBase(root), real);
        // The script that runs is the file that was checked, so a link changed afterwards changes nothing.
        full[at] = real;
      } catch {
        ok = false;
      }
    }
    if (!ok) {
      return refuse(
        `a ${interpreter} server must be started as \`${interpreter}${interpreter === "deno" ? " run [permission flags]" : ""} SCRIPT [args]\`, with the script, as the first argument, an absolute path to a file outside the review checkout`,
      );
    }
  }
  const env = seatEnv(process.env, agent === "other" ? "" : agent, extraPrefixes);
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === "PATH" || INJECTORS.test(key)) {
      delete env[key];
    }
  }
  env.PATH = pathValue ?? dirs.join(delimiter);
  checkEnvPaths(env, root, refuse);
  // Any Bun in the server's process tree (the server itself, a `#!` line naming bun, a helper it starts)
  // reads no `.env` and an empty configuration, wherever it starts: the flags come from here, not argv.
  env.BUN_OPTIONS = `--no-env-file --config=${emptyBunfig()}`;
  let cwd = root;
  if (profile.start === "private") {
    cwd = mkdtempSync(join(privateDir(), "server-cwd-"));
    // Below the checkout the folder would not be empty of its files: a runner looks in parent folders
    // for a `package.json` and `node_modules/.bin`. The temporary folder belongs to the caller.
    if (inside(reviewBase(root), cwd)) {
      refuse(`the temporary folder ${cwd} is inside the review checkout; set TMPDIR outside it`);
    }
  }
  const argv0 = exeName(found) === basename(program) ? undefined : basename(found);
  return { cmd: [program, ...full], argv0, env, cwd, start: profile.start };
}

/**
 * The command a launch will run as the caller wrote it, for a launch policy that looks at it before any
 * server starts: the executable (as given, or the agent's own name), the profile's arguments, the caller's.
 * @param {string} agent
 * @param {string} exe
 * @param {string[]} args
 */
export function launchPreview(agent, exe, args) {
  const profile = PROFILES[agent];
  return [exe || profile?.exe || "", ...(profile?.args ?? []), ...args];
}

/**
 * The server's own arguments from the command line, in order, removed from `argv`:
 * `--server-arg=VALUE` takes any value, `--server-arg VALUE` one that is not itself a flag (a missing
 * value cannot swallow the next restriction).
 * @param {string[]} argv
 */
export function takeServerArgs(argv) {
  /** @type {string[]} */
  const values = [];
  for (let i = 0; i < argv.length;) {
    const arg = argv[i] ?? "";
    if (arg.startsWith("--server-arg=")) {
      values.push(arg.slice("--server-arg=".length));
      argv.splice(i, 1);
    } else if (
      arg === "--server-arg" &&
      i + 1 < argv.length &&
      !(argv[i + 1] ?? "").startsWith("--")
    ) {
      values.push(argv[i + 1] ?? "");
      argv.splice(i, 2);
    } else {
      i++;
    }
  }
  return values;
}
