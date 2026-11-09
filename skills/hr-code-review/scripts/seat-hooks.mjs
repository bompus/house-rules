// What a seat's agent loads from the user's own configuration besides its login: hooks and MCP servers.
// Claude's adapter gets an empty `settingSources` (acp-panel-client.mjs) and Codex runs with its hooks
// off (codexWrapper); this module covers the two agents that need a different launch: Devin starts with
// an empty configuration folder (its generated config has no hooks, see devinConfig) and Antigravity's
// `agy acp` with a private Gemini folder that holds only the copied login. The caller declares the
// rest covered with `--policy-option hooks-masked`.
import { chmodSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import {
  bunHardened,
  codexWrapper,
  devinConfig,
  exeName,
  mayStart,
  mayStartAgy,
  privateDir,
  reviewBase,
  seatAgent,
  seatEnv,
} from "./seat-launch.mjs";

/**
 * Whether `path` (or what it resolves to, links followed) is `base` or below it.
 * @param {string} base a canonical path
 * @param {string} path
 */
function inside(base, path) {
  let real = path;
  try {
    real = realpathSync(path);
  } catch {
    // Not there (yet): the lexical path stands.
  }
  return real === base || real.startsWith(base + sep);
}
/**
 * The launch with a relative first word made absolute from the folder the client was started in (not
 * the checkout, and not the empty folder a server may start in), so classification sees the program it
 * will run; refused when it, links followed, lies inside the review checkout: give an absolute path to
 * run a program from there. A bare name, found on PATH, and an absolute path stay as they are.
 * @param {string[]} cmd
 * @param {string} cwd the review root
 * @param {(message: string) => never} refuse
 */
export function absoluteFirst(cmd, cwd, refuse) {
  const first = cmd[0] ?? "";
  if (!/[\\/]/.test(first) || isAbsolute(first)) {
    return cmd;
  }
  const from = resolve(first);
  if (inside(reviewBase(cwd), from)) {
    refuse(
      `the server command ${first} resolves inside the review checkout (${from}); give an absolute path to run a program from there`,
    );
  }
  return [from, ...cmd.slice(1)];
}
// The only flags a seat passes to `agy acp` (one or two dashes; a value as `=V` or the next argument).
// Any other can move agy's configuration folders, add directories whose agent folders it runs, open an
// IDE MCP connection, change where the login goes, write a log through a link or approve tool calls.
/** @type {Map<string, boolean>} flag name -> takes a value */
const AGY_FLAGS = new Map([
  ["sandbox", false],
  ["disable-telemetry", false],
  ["disable_telemetry", false],
  ["agent", true],
]);
/** @param {string[]} args the arguments after `agy acp` */
function agyArgsAllowed(args) {
  for (let i = 0; i < args.length; i++) {
    const m = /^--?([A-Za-z0-9_-]+)(=.*)?$/.exec(args[i] ?? "");
    const takes = m ? AGY_FLAGS.get(m[1] ?? "") : undefined;
    if (!m || takes === undefined) {
      return false; // a positional argument, a lone `--` or another flag
    }
    if (takes && m[2] === undefined) {
      const value = args[++i]; // the next argument, never another flag
      if (!value || value.startsWith("-")) {
        return false;
      }
    } else if (!takes && m[2] !== undefined && !/^=(true|false)$/.test(m[2])) {
      return false;
    }
  }
  return true;
}
/** @param {string} what */
const unmasked = (what) =>
  `${what}; mask them and pass --policy-option hooks-masked, or launch it so the client can`;
/**
 * The launch command and environment with the user's hooks and MCP servers kept out of a Devin or
 * Antigravity seat. Refuses (through `refuse`) a launch that may start one of them and cannot be set up
 * that way, unless the caller declared `masked`.
 * @param {string[]} serverCmd the command as given
 * @param {string[]} cmd the command after the other launch rewrites
 * @param {Record<string, string | undefined>} env the seat's environment
 * @param {boolean} masked whether the caller passed --policy-option hooks-masked
 * @param {string} cwd the review root
 * @param {(message: string) => never} refuse
 * @returns {{ cmd: string[], env: Record<string, string | undefined> }}
 */
function hooksOff(serverCmd, cmd, env, masked, cwd, refuse) {
  const windows = process.platform === "win32";
  if (seatAgent(serverCmd) === "devin" || mayStart(serverCmd, "devin")) {
    if (masked) {
      return { cmd, env };
    }
    if (windows) {
      refuse(unmasked("Devin's user MCP servers cannot be kept out of a seat on Windows"));
    }
    // Devin loads its MCP servers from the configuration folder of the process, whichever --config it is
    // given; an empty folder holds none, and its login lives elsewhere.
    const folder = join(privateDir(), "devin-xdg");
    mkdirSync(folder, { mode: 0o700 });
    return { cmd, env: { ...env, XDG_CONFIG_HOME: folder } };
  }
  if (!mayStartAgy(serverCmd, process.env.PATH, cwd) || masked) {
    return { cmd, env };
  }
  const plain = exeName(cmd[0] ?? "") === "agy" && cmd[1] === "acp";
  if (windows || !plain || !agyArgsAllowed(cmd.slice(2))) {
    return refuse(
      unmasked(
        plain && !windows
          ? "the agy launch passes arguments the client cannot keep safe (it allows only --sandbox, --disable-telemetry and --agent): others can move its configuration folders, add directories whose agent folders it runs, open an IDE MCP connection, or write a log to a path the caller picks, which agy opens through a link"
          : "the launch may start agy in a form the client cannot give a private Gemini folder (only `agy acp` on Linux and macOS)",
      ),
    );
  }
  // The folder holds the login and nothing else, so none of the user's hooks or MCP servers load.
  const source = join(
    env.HOME ?? homedir(),
    ".gemini",
    "antigravity-cli",
    "antigravity-oauth-token",
  );
  /** @type {Buffer} */
  let token;
  try {
    token = readFileSync(source);
  } catch (e) {
    return refuse(
      `agy has no login to copy into the seat's Gemini folder (${source}: ${String(/** @type {NodeJS.ErrnoException} */ (e).code)}); sign in with agy first`,
    );
  }
  const gemini = join(privateDir(), "agy-gemini");
  mkdirSync(join(gemini, "antigravity-cli"), { recursive: true, mode: 0o700 });
  chmodSync(gemini, 0o700);
  chmodSync(join(gemini, "antigravity-cli"), 0o700);
  writeFileSync(join(gemini, "antigravity-cli", "antigravity-oauth-token"), token, { mode: 0o600 });
  return { cmd: [...cmd.slice(0, 2), "--gemini-dir", gemini, ...cmd.slice(2)], env };
}
/**
 * The command, environment and working directory a seat's server starts with: the launch hardened
 * (Devin's config, Bun), the seat's narrowed environment, the user's hooks and MCP servers kept out (see
 * the top of this file) and Codex's wrapper. A server the client recognizes as Codex, Claude or Devin
 * starts in an empty private folder, never in the checkout: nothing there can be read from its starting
 * folder (a Bun process's `.env` and `bunfig.toml`, a runner's `package.json`, a relative `PATH`
 * entry), and the review root reaches the agent only as the session's working directory. Those adapters
 * take their tool and project-file directory from the session. Any other launch, Antigravity included
 * (its tools run in the process's directory), keeps starting in the review root.
 * @param {string[]} serverCmd
 * @param {{ noWeb: boolean, cwd: string, codex: boolean, masked: boolean, refuse: (message: string) => never }} options
 */
export function seatLaunch(serverCmd, { noWeb, cwd, codex, masked, refuse }) {
  const agent = seatAgent(serverCmd);
  const isolated =
    (agent === "codex" || agent === "claude" || agent === "devin") &&
    !mayStartAgy(serverCmd, process.env.PATH, cwd);
  // The launch checks (a program found outside the checkout, Bun's flags) apply to every launch: the
  // empty folder is one more layer, and does not stop a program that changes directory itself.
  const hardened = bunHardened(devinConfig(serverCmd, noWeb, cwd, refuse), cwd, refuse);
  const base = seatEnv(
    process.env,
    hardened,
    (process.env.ACP_PANEL_PASS_ENV ?? "").split(",").map((p) => p.trim()),
  );
  const out = hooksOff(serverCmd, hardened, base, masked, cwd, refuse);
  const empty = isolated ? join(privateDir(), "server-cwd") : cwd;
  if (isolated) {
    mkdirSync(empty, { mode: 0o700 });
    // Below the checkout the folder would not be empty of its files: a runner looks in parent folders for
    // a `package.json` and `node_modules/.bin`. The caller owns TMPDIR, which must lie outside it.
    if (inside(reviewBase(cwd), empty)) {
      refuse(`the temporary folder ${empty} is inside the review checkout; set TMPDIR outside it`);
    }
  }
  return {
    cmd: out.cmd,
    env: codex ? codexWrapper(out.env, noWeb, cwd, refuse) : out.env,
    cwd: empty,
  };
}
