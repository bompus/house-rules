// One OpenCode panel seat: `opencode run` in the current directory with read-only tools, an empty
// environment and, on Linux, a filesystem boundary. OpenCode is not an ACP agent, so it does not go
// through acp-panel-client.mjs.
// Usage: bun opencode-seat.mjs <model-id> <effort> <prompt-file> [title]
// The seat sees PATH, HOME, TMPDIR, LANG and the XDG directories only, so no other vendor's key or SSH
// agent reaches it, and OpenCode logs in from its own auth file. Its permissions deny every tool except
// read, glob and list (no grep: its rules match search patterns, not files), keep `.env` files
// unreadable, and refuse reads outside the working directory (external_directory). OpenCode's own
// check treats a whole git project as inside and follows symlinks, so on Linux the seat also runs
// under bubblewrap: the filesystem shows only the system directories (read-only), an empty home, /tmp
// and /run, the seat's directory, the prompt file and the OpenCode binary; its config folder stays
// hidden (the seat's rules arrive in OPENCODE_CONFIG_CONTENT, with the user's own read denials kept)
// and the provider key arrives as OPENCODE_API_KEY, which the seat's own process can still read back
// through /proc. A symlink in the checkout to another credential file therefore finds nothing.
// Project configuration and Claude Code compatibility are off, so a checkout's `.opencode` plugins or
// `.claude` skills never load. The prompt goes in as an attached file, so a long prompt cannot exceed
// the argument limit. See ../references/acp-client.md.
import { spawn } from "node:child_process";
import {
  accessSync,
  constants as fsConstants,
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { constants, homedir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PASSED = [
  "PATH",
  "HOME",
  "TMPDIR",
  "LANG",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
];
// No grep: its rules match search patterns, not files, so it could return lines from a denied file.
const READ_ONLY = ["glob", "list"];
// Read allows everything in the directory except environment files; OpenCode applies the last
// matching rule, so the denials follow the general allow.
const READ = { "*": "allow", "*.env": "deny", "*.env.*": "deny", "*.env.example": "allow" };
export const SEAT_AGENT = "panel-seat";
// The providers whose key OpenCode reads from OPENCODE_API_KEY.
const OPENCODE_PROVIDERS = new Set(["opencode-go", "opencode"]);

/**
 * The seat's environment: only PASSED from `base`, PWD set to `dir`, and OpenCode's settings.
 * `extraDenied` are the read patterns the user's own config denies; they follow the seat's allow.
 * @param {NodeJS.ProcessEnv} base
 * @param {string} dir
 * @param {string[]} [extraDenied]
 * @returns {Record<string, string>}
 */
export function openCodeEnv(base, dir, extraDenied = []) {
  /** @type {Record<string, string>} */
  const env = {};
  for (const name of PASSED) {
    const value = base[name];
    if (value !== undefined) {
      env[name] = value;
    }
  }
  // OpenCode applies the last matching rule. The user's denials therefore go after every rule of the
  // seat's own (a key repeated in an object keeps its first position, so the seat's copy is dropped
  // first), and a denied "*" leaves only that denial.
  /** @type {Record<string, string>} */
  const read = extraDenied.includes("*")
    ? { "*": "deny" }
    : {
        ...Object.fromEntries(
          Object.entries(READ).filter(([pattern]) => !extraDenied.includes(pattern)),
        ),
        ...Object.fromEntries(extraDenied.map((p) => [p, "deny"])),
      };
  /** @type {Record<string, unknown>} */
  const permission = { "*": "deny", read };
  /** @type {Record<string, boolean>} */
  const tools = { "*": false, read: true };
  for (const tool of READ_ONLY) {
    permission[tool] = "allow";
    tools[tool] = true;
  }
  // The seat runs as its own agent (SEAT_AGENT) carrying the same rules, because OpenCode applies an
  // agent's permissions after the global ones: a user's `agent.build.permission` would otherwise
  // restore shell or reads outside the directory.
  const agent = { mode: "primary", description: "Read-only panel seat", permission, tools };
  return {
    ...env,
    PWD: dir,
    OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    OPENCODE_DISABLE_CLAUDE_CODE: "1",
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_CONFIG_CONTENT: JSON.stringify({ permission, tools, agent: { [SEAT_AGENT]: agent } }),
  };
}

/**
 * The `opencode run` arguments for one seat.
 * @param {string} model
 * @param {string} effort
 * @param {string} promptFile
 * @param {string} title
 */
export function runArgs(model, effort, promptFile, title) {
  return [
    "run",
    "--standalone",
    "--format",
    "json",
    "--model",
    `${model}#${effort}`,
    "--agent",
    SEAT_AGENT,
    "--title",
    title,
    "Do the panel task in the attached file.",
    "--file",
    resolve(promptFile),
  ];
}

// The system directories a native OpenCode binary needs, read-only; everything else (other users'
// homes, /srv, /mnt, /opt, /var) is absent from the seat's view.
const SYSTEM = ["/usr", "/bin", "/sbin", "/lib", "/lib64"];
// From /etc, only what name resolution, public TLS material and the dynamic loader read; a checkout
// symlink into the rest of /etc (/etc/environment, /etc/ssl/private and the like) finds nothing.
const ETC =
  "resolv.conf hosts nsswitch.conf gai.conf host.conf ssl/certs ssl/openssl.cnf ca-certificates pki/ca-trust pki/tls/certs pki/tls/cert.pem pki/tls/openssl.cnf ld.so.cache ld.so.conf ld.so.conf.d localtime passwd group"
    .split(" ")
    .map((name) => `/etc/${name}`);

// A file the seat's own read rules deny by name: `*.env` and `*.env.*`, except `*.env.example`.
const isEnvFile = (/** @type {string} */ name) =>
  name.endsWith(".env") || (name.includes(".env.") && !name.endsWith(".env.example"));
// A superset of how OpenCode matches a pattern: `*` and `**` match any run of characters, `?` one.
const globRegex = (/** @type {string} */ pattern) =>
  new RegExp(
    `^${pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*+/g, ".*")
      .replace(/\?/g, ".")}$`,
  );
const MAX_MASKED = 1000;
const MAX_ENTRIES = 200_000;
/**
 * The files under `dir` that the read rules deny by name: the environment files, and what the user's
 * own denied patterns match (by file name, by path from `dir` or by absolute path), and the
 * checkout's `.git/config` (a remote URL may carry a token). Links are not followed and `.git/objects`
 * is skipped. OpenCode checks the pathname it is asked to read, not what a link points to, so a link
 * named notes.txt that points to `.env` or `private.pem` passes its rules; the sandbox therefore
 * hides each of these files, whatever points at it. A checkout with more than MAX_MASKED of them, or
 * too many entries to scan, is refused. A denied `*` (everything) needs no masking.
 * @param {string} dir
 * @param {string[]} [denied] the user's denied read patterns
 * @param {string} [home] what a leading `~` or `$HOME` in a pattern stands for
 * @returns {string[]}
 */
export function deniedFiles(dir, denied = [], home = homedir()) {
  // OpenCode expands a leading `~` or `$HOME` in a pattern to the home folder.
  const expand = (/** @type {string} */ p) => p.replace(/^(~|\$HOME|\$\{HOME\})(?=\/|$)/, home);
  const patterns = denied.filter((p) => p !== "*").map((p) => globRegex(expand(p)));
  // Whether a path, as the read rules see it (`path` is what OpenCode would be asked to read), is denied:
  // an environment file, the `config` of any `.git` folder (a remote URL may carry a token), or a match
  // of the user's own patterns by name, by path from the checkout or by absolute path.
  const isDenied = (/** @type {string} */ path) => {
    const name = basename(path);
    return (
      isEnvFile(name) ||
      (name === "config" && basename(dirname(path)) === ".git") ||
      patterns.some((re) => re.test(name) || re.test(relative(dir, path)) || re.test(path))
    );
  };
  /** @type {string[]} */
  const found = [];
  const add = (/** @type {string} */ path) => {
    if (!found.includes(path)) {
      found.push(path);
      if (found.length > MAX_MASKED) {
        throw new Error(`more than ${MAX_MASKED} denied files in the review root`);
      }
    }
  };
  /** @type {string[]} */
  const others = [];
  /** @type {string[]} */
  const links = [];
  // Git's object store is large and holds only compressed objects; it is read only for hard links.
  /** @type {string[]} */
  const objectDirs = [];
  let seen = 0;
  const count = () => {
    if (++seen > MAX_ENTRIES) {
      throw new Error(`more than ${MAX_ENTRIES} entries in the review root`);
    }
  };
  for (const stack = [dir]; stack.length > 0;) {
    const here = /** @type {string} */ (stack.pop());
    for (const entry of readdirSync(here, { withFileTypes: true })) {
      count();
      const path = join(here, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "objects" && basename(here) === ".git") {
          objectDirs.push(path);
        } else {
          stack.push(path);
        }
      } else if (entry.isSymbolicLink()) {
        links.push(path);
      } else if (!entry.isFile()) {
        continue;
      } else if (isDenied(path)) {
        add(path);
      } else {
        others.push(path);
      }
    }
  }
  // A link is another way to what it points to, and OpenCode checks only the name it is asked for:
  // a link whose own path is denied (`.env -> secret.txt`) masks the file it points to, and a link to a
  // directory (`secrets -> backing`) is walked as if it were that directory, so the files that its
  // path would name as denied (`secrets/token.json`) are masked where they really are.
  for (const link of links) {
    let target;
    try {
      target = realpathSync(link);
    } catch {
      continue; // A dangling link points to nothing.
    }
    if (rootCovers(dir, [target]) === undefined) {
      continue; // Outside the root, so outside the sandbox.
    }
    const kind = lstatSync(target);
    if (kind.isFile()) {
      if (isDenied(link)) {
        add(target);
      }
    } else if (kind.isDirectory()) {
      const visited = new Set([target]);
      for (const walk = [[target, link]]; walk.length > 0;) {
        const [real, virtual] = /** @type {[string, string]} */ (walk.pop());
        for (const entry of readdirSync(real, { withFileTypes: true })) {
          count();
          const physical = join(real, entry.name);
          const named = join(virtual, entry.name);
          if (entry.isDirectory() && !visited.has(physical)) {
            visited.add(physical);
            walk.push([physical, named]);
          } else if (entry.isFile() && isDenied(named)) {
            add(physical);
          }
        }
      }
    }
  }
  // A hard link is the same file under another name, and the sandbox masks by path: every other name
  // of a denied file inside the root is masked too.
  const linked = new Set(
    found
      .map((p) => lstatSync(p))
      .filter((st) => st.nlink > 1)
      .map((st) => `${st.dev}:${st.ino}`),
  );
  if (linked.size > 0) {
    // The object directories hold files too, and a hard link could be hidden among them.
    for (const stack = [...objectDirs]; stack.length > 0;) {
      const here = /** @type {string} */ (stack.pop());
      for (const entry of readdirSync(here, { withFileTypes: true })) {
        count();
        if (entry.isDirectory()) {
          stack.push(join(here, entry.name));
        } else if (entry.isFile()) {
          others.push(join(here, entry.name));
        }
      }
    }
    for (const path of others) {
      const st = lstatSync(path);
      if (st.nlink > 1 && linked.has(`${st.dev}:${st.ino}`)) {
        add(path);
      }
    }
  }
  return found;
}
/**
 * The first of `protectedPaths` (real paths: the home folder, OpenCode's config and data folders) that
 * the review root is or contains, or undefined. The sandbox shows the root over its empty home, so such
 * a root would bring the real home, other providers' keys and OpenCode's own files back into view.
 * @param {string} dir real path of the review root
 * @param {string[]} protectedPaths
 */
export function rootCovers(dir, protectedPaths) {
  return protectedPaths.find((p) => {
    const rel = relative(dir, p);
    // Only `..` and `../...` leave the root; a child named `..home` is inside it.
    return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
  });
}
/**
 * The bubblewrap prefix: only SYSTEM, the name-resolution files under /etc and /run and the `shown`
 * paths (real paths, read-only), with private /tmp, /dev, /proc and an empty home. Each `masked`
 * path is replaced by an empty file.
 * @param {string} home the home folder
 * @param {string[]} shown
 * @param {string[]} [masked]
 */
export function sandboxArgs(home, shown, masked = []) {
  const real = (/** @type {string[]} */ paths) => [
    ...new Set(paths.filter((p) => existsSync(p)).map((p) => realpathSync(p))),
  ];
  return [
    "bwrap",
    "--die-with-parent",
    ...real(SYSTEM).flatMap((p) => ["--ro-bind", p, p]),
    // /bin, /lib and the like are often links into /usr on current systems.
    ...SYSTEM.filter((p) => existsSync(p) && realpathSync(p) !== p).flatMap((p) => [
      "--symlink",
      realpathSync(p),
      p,
    ]),
    // An /etc entry that is a link (resolv.conf into /run) keeps its link; its target is shown below.
    // The target of such a link is shown too (resolv.conf may point into /run/NetworkManager).
    ...ETC.filter((p) => existsSync(p)).flatMap((p) => {
      const target = realpathSync(p);
      return target === p
        ? ["--ro-bind", p, p]
        : [
            "--symlink",
            target,
            p,
            ...(target.startsWith("/run/systemd/resolve/") ? [] : ["--ro-bind", target, target]),
          ];
    }),
    "--dev",
    "/dev",
    "--unshare-pid",
    "--proc",
    "/proc",
    "--tmpfs",
    "/tmp",
    "--tmpfs",
    realpathSync(home),
    ...real(["/run/systemd/resolve"]).flatMap((p) => ["--ro-bind", p, p]),
    ...real(shown).flatMap((p) => ["--ro-bind", p, p]),
    ...masked.flatMap((p) => ["--ro-bind", "/dev/null", p]),
  ];
}

/**
 * The read patterns the user's global OpenCode config denies or asks about. A config this runtime
 * cannot parse (comments need Bun) is ignored.
 * @param {string} configDir
 */
export function userReadDenials(configDir) {
  /** @type {string[]} */
  const denied = [];
  // OpenCode loads both files when both exist, so the denials of each count.
  for (const name of ["opencode.json", "opencode.jsonc"]) {
    try {
      const parse = /** @type {any} */ (globalThis).Bun?.JSONC?.parse ?? JSON.parse;
      const config = parse(readFileSync(join(configDir, name), "utf8"));
      // A default that denies or asks for everything (`permission: "deny"`, `{"*": "deny"}`), and a
      // whole-tool "deny" or "ask" for read, become a final deny-all: the seat then reads nothing.
      const permission = config?.permission;
      const closed = (/** @type {unknown} */ v) => v === "deny" || v === "ask";
      const read = permission?.read;
      if (closed(permission) || closed(permission?.["*"]) || closed(read)) {
        return ["*"];
      }
      if (read && typeof read === "object") {
        for (const [pattern, value] of Object.entries(
          /** @type {Record<string, string>} */ (read),
        )) {
          if (closed(value)) {
            denied.push(pattern);
          }
        }
      }
    } catch {
      // This file is absent or cannot be read here.
    }
  }
  return denied;
}

/**
 * The executable `name` on `pathVar`, or undefined.
 * @param {string} name
 * @param {string | undefined} pathVar
 */
function onPath(name, pathVar) {
  for (const dir of (pathVar ?? "").split(delimiter)) {
    const candidate = join(isAbsolute(dir) ? dir : resolve(dir), name);
    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Not here.
    }
  }
  return undefined;
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  const [model, effort, promptFile, title = "panel-seat"] = process.argv.slice(2);
  if (!model || !effort || !promptFile) {
    console.error("usage: bun opencode-seat.mjs <model-id> <effort> <prompt-file> [title]");
    process.exit(2);
  }
  const dir = realpathSync(process.cwd());
  const home = homedir();
  const config = process.env.XDG_CONFIG_HOME || join(home, ".config");
  const denials = userReadDenials(join(config, "opencode"));
  const env = openCodeEnv(process.env, dir, denials);
  let cmd = ["opencode", ...runArgs(model, effort, promptFile, title)];
  if (process.platform === "linux") {
    const which = onPath("opencode", process.env.PATH);
    if (!which) {
      console.error("[opencode-seat] opencode is not on PATH");
      process.exit(127);
    }
    const data = env.XDG_DATA_HOME || join(home, ".local/share");
    const covered = rootCovers(
      dir,
      [home, join(config, "opencode"), join(data, "opencode")]
        .filter((p) => existsSync(p))
        .map((p) => realpathSync(p)),
    );
    if (covered !== undefined) {
      console.error(
        `[opencode-seat] the review root contains ${covered}, which the sandbox keeps out of view`,
      );
      process.exit(2);
    }
    const binary = realpathSync(which);
    /** @type {string[]} */
    let masked;
    try {
      masked = deniedFiles(dir, denials);
    } catch (e) {
      console.error(`[opencode-seat] ${e instanceof Error ? e.message : String(e)}`);
      process.exit(2);
    }
    // OpenCode 2 inside the empty home finds no saved login, so the key for the model's provider (the
    // id before `/`) comes from its auth file as OPENCODE_API_KEY; the file itself stays hidden.
    const provider = model.split("/")[0] ?? "";
    // OPENCODE_API_KEY is how OpenCode's own providers take a key. Another provider needs its own form
    // (a provider-specific variable, or an OAuth record), which the sandbox does not supply: refused.
    if (!OPENCODE_PROVIDERS.has(provider)) {
      console.error(
        `[opencode-seat] provider ${provider} is not supported: the sandbox supplies a key only for ${[...OPENCODE_PROVIDERS].join(" and ")}`,
      );
      process.exit(2);
    }
    try {
      const auth = JSON.parse(readFileSync(join(data, "opencode/auth.json"), "utf8"));
      const key = auth?.[provider]?.key;
      if (typeof key === "string" && key) {
        env.OPENCODE_API_KEY = key;
      }
    } catch {
      // No auth file: OpenCode reports the missing login itself.
    }
    cmd = [
      ...sandboxArgs(
        home,
        [
          dir,
          resolve(promptFile),
          // The binary alone (a self-contained executable); its folder could be the home folder.
          binary,
        ],
        masked,
      ),
      "--chdir",
      dir,
      "--setenv",
      "TMPDIR",
      "/tmp",
      "--",
      binary,
      ...cmd.slice(1),
    ];
  }
  const child = spawn(cmd[0] ?? "", cmd.slice(1), {
    cwd: dir,
    env,
    stdio: ["ignore", "inherit", "inherit"],
  });
  child.on("error", (e) => {
    console.error(`[opencode-seat] cannot start ${cmd[0]}: ${e.message}`);
    process.exit(127);
  });
  // A stop sent to this wrapper (a runner's deadline) goes to OpenCode too, with a forced kill after
  // 5 s, so the model request does not outlive the seat.
  for (const sig of /** @type {const} */ (["SIGTERM", "SIGINT", "SIGHUP"])) {
    process.on(sig, () => {
      child.kill(sig);
      setTimeout(() => child.kill("SIGKILL"), 5000).unref();
    });
  }
  child.on("close", (code, signal) =>
    process.exit(code ?? (signal ? 128 + constants.signals[signal] : 1)),
  );
}
