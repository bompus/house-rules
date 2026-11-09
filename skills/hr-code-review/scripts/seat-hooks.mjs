// What a seat's agent loads from the user's own configuration besides its login: hooks and MCP servers.
// Claude's adapter gets an empty `settingSources` (acp-panel-client.mjs) and Codex runs with its hooks
// off (codexWrapper); this module covers the two agents that need a different launch: Devin starts with
// an empty configuration folder (its generated config has no hooks, see devinConfig) and Antigravity's
// `agy acp` with a private Gemini folder that holds only the copied login. The caller declares the
// rest covered with `--policy-option hooks-masked`.
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  bunHardened,
  codexWrapper,
  devinConfig,
  exeName,
  mayStart,
  mayStartAgy,
  privateDir,
  seatAgent,
  seatEnv,
} from "./seat-launch.mjs";

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
 * The command and environment a seat's server starts with: the launch hardened (Devin's config, Bun),
 * the seat's narrowed environment, the user's hooks and MCP servers kept out (see the top of this file)
 * and Codex's wrapper.
 * @param {string[]} serverCmd
 * @param {{ noWeb: boolean, cwd: string, codex: boolean, masked: boolean, refuse: (message: string) => never }} options
 */
export function seatLaunch(serverCmd, { noWeb, cwd, codex, masked, refuse }) {
  const hardened = bunHardened(devinConfig(serverCmd, noWeb, cwd, refuse), cwd, refuse);
  const base = seatEnv(
    process.env,
    hardened,
    (process.env.ACP_PANEL_PASS_ENV ?? "").split(",").map((p) => p.trim()),
  );
  const out = hooksOff(serverCmd, hardened, base, masked, cwd, refuse);
  return { cmd: out.cmd, env: codex ? codexWrapper(out.env, noWeb, cwd, refuse) : out.env };
}
