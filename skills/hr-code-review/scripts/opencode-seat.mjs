// One OpenCode panel seat: `opencode run` in the current directory with read-only tools, an empty
// environment and, on Linux, a filesystem boundary. OpenCode is not an ACP agent, so it does not go
// through acp-panel-client.mjs.
// Usage: bun opencode-seat.mjs <model-id> <effort> <prompt-file> [title] [--root CHECKOUT] [--bwrap ABSOLUTE-PATH]
// The seat sees PATH, HOME, TMPDIR, LANG and the XDG directories only, so no other vendor's key or SSH
// agent reaches it, and OpenCode logs in from its own auth file. Its permissions deny every tool except
// read, glob and list (no grep: its rules match search patterns, not files), keep `.env` files
// unreadable, and refuse reads outside the working directory (external_directory). OpenCode's own
// check treats a whole git project as inside and follows symlinks, so on Linux the seat also runs
// under bubblewrap: the filesystem shows only the system directories (read-only), an empty home, /tmp
// and /run, a sanitized copy of the checkout (see copyReviewRoot: regular files only, no `.git`, and
// without the files the read rules deny) mounted at the checkout's own path, the prompt file and the
// OpenCode binary; its config folder stays hidden (the seat's rules arrive in OPENCODE_CONFIG_CONTENT,
// with the user's own read denials kept) and the provider key arrives as OPENCODE_API_KEY, which the
// seat's own process can still read back through /proc. The seat never sees the original checkout, so
// a symlink in it to a credential file finds nothing. The copy is removed when the seat ends.
// Project configuration and Claude Code compatibility are off, so a checkout's `.opencode` plugins or
// `.claude` skills never load. The prompt goes in as an attached file, so a long prompt cannot exceed
// the argument limit. See ../references/acp-client.md.
import { spawn } from "node:child_process";
import {
  accessSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  readSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { constants, homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { cleanPath, envPath, pathExecutable, reviewBase } from "./seat-launch.mjs";

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
const globRegex = (/** @type {string} */ pattern) => {
  // OpenCode matches with `/` for both separators, and lets a trailing " *" match an absent suffix.
  const text = pattern.replaceAll("\\", "/");
  const optional = text.endsWith(" *");
  const body = (optional ? text.slice(0, -2) : text)
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*+/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${body}${optional ? "( .*)?" : ""}$`, "s");
};
const MAX_ENTRIES = 200_000;
const MAX_FILES = 100_000;
const MAX_BYTES = 512 * 1024 * 1024;
/**
 * Whether a path, as the read rules see it (`path` is what OpenCode would be asked to read), is
 * denied: an environment file, the `config` of a `.git` folder, or a match of the user's own
 * patterns by name, by path from the checkout or by absolute path (a leading `~` or `$HOME` in a
 * pattern is the home folder).
 * @param {string} dir the review root
 * @param {string[]} denied the user's denied read patterns
 * @param {string} home
 * @returns {(path: string) => boolean}
 */
export function deniedBy(dir, denied, home) {
  const expand = (/** @type {string} */ p) =>
    p.replace(/^(~|\$HOME|\$\{HOME\})(?=\/|$)/, () => home);
  const patterns = denied.filter((p) => p !== "*").map((p) => globRegex(expand(p)));
  return (path) =>
    isEnvFile(basename(path)) ||
    (basename(path) === "config" && basename(dirname(path)) === ".git") ||
    patterns.some((re) => {
      const slashed = (/** @type {string} */ p) => p.replaceAll("\\", "/");
      return (
        re.test(slashed(basename(path))) ||
        re.test(slashed(relative(dir, path))) ||
        re.test(slashed(path))
      );
    });
}
/**
 * Copies the regular files of the review root `dir` into a new private folder under `parent` (mode
 * 0700; files read-only) and returns its path, leaving out the files the read rules deny by name. The
 * seat sees only this copy, so a link cannot lead it out of the checkout and nothing needs masking.
 * Symlinks, special files and every `.git` entry are not copied. A file is left out when it is an
 * environment file, matches the user's own denied patterns (by file name, by path from `dir` or by
 * absolute path), is reached under a denied name through a link (`.env -> secret.txt`, or
 * `secrets -> backing` with a pattern for `secrets/*`, every alias of a folder and nested links
 * included), or is another name of a left-out file (the same device and inode). A `.git/config` (a
 * remote URL may carry a token) is denied by name too, so a link or hard link to it is left out. `keep`
 * lists real paths that are copied whatever the rules say (the prompt file, when it is inside `dir`).
 * A root with more than `limits.entries` entries, `limits.files` files or `limits.bytes` bytes is
 * refused, and so is one that changes while it is copied (a file replaced or resized, a folder swapped
 * for a link): each file is opened without following a link and must be, by `/proc/self/fd`, the
 * regular file that was scanned at that path. A denied `*` (everything) copies only `keep`. The copy
 * works in slices so a stop sent meanwhile is handled; `onCreate` gets the folder as soon as it exists.
 * @param {string} dir the review root
 * @param {string} parent folder that gets the copy
 * @param {string[]} [denied] the user's denied read patterns
 * @param {string} [home] what a leading `~` or `$HOME` in a pattern stands for
 * @param {string[]} [keep]
 * @param {{ limits?: { entries: number, files: number, bytes: number }, onCreate?: (copy: string) => void }} [options]
 * @returns {Promise<{ copy: string, files: number, bytes: number }>}
 */
export async function copyReviewRoot(
  dir,
  parent,
  denied = [],
  home = homedir(),
  keep = [],
  options = {},
) {
  const limits = options.limits ?? { entries: MAX_ENTRIES, files: MAX_FILES, bytes: MAX_BYTES };
  dir = realpathSync(dir);
  const everything = denied.includes("*");
  const byPath = denied.some((p) => p !== "*" && p.includes("/"));
  const isDenied = deniedBy(dir, denied, home);
  let seen = 0;
  const count = () => {
    if (++seen > limits.entries) {
      throw new Error(`more than ${limits.entries} entries in the review root`);
    }
  };
  /** @type {Set<string>} */
  const omit = new Set();
  /** @type {string[]} */
  const folders = [];
  /** @type {{ path: string, st: import("node:fs").Stats }[]} */
  const files = [];
  /** @type {string[]} */
  const links = [];
  /** @type {string[]} */
  const gitDirs = [];
  for (const stack = [dir]; stack.length > 0;) {
    const here = /** @type {string} */ (stack.pop());
    for (const entry of readdirSync(here, { withFileTypes: true })) {
      count();
      const path = join(here, entry.name);
      if (entry.name === ".git") {
        // Not copied (the seat has no use for it, and a file named .git points outside the root), but
        // what is denied inside it stays denied under every name: it is scanned below.
        if (entry.isDirectory()) {
          gitDirs.push(path);
        } else if (entry.isSymbolicLink()) {
          links.push(path);
        } else if (entry.isFile() && isDenied(path)) {
          omit.add(path); // Never copied, but its hard-link aliases are found by inode below.
        }
      } else if (entry.isDirectory()) {
        folders.push(path);
        stack.push(path);
      } else if (entry.isSymbolicLink()) {
        links.push(path);
      } else if (entry.isFile()) {
        files.push({ path, st: lstatSync(path) });
      }
    }
  }
  for (const { path } of files) {
    if (isDenied(path)) {
      omit.add(path);
    }
  }
  // Inside a `.git` folder (its object store excepted: hash names, and large) a denied file is found
  // by the same rules, so its hard-link aliases outside are left out by inode, and a link in it is
  // followed like any other.
  for (const stack = [...gitDirs]; stack.length > 0;) {
    const here = /** @type {string} */ (stack.pop());
    for (const entry of readdirSync(here, { withFileTypes: true })) {
      if (entry.name === "objects" && basename(here) === ".git") {
        continue;
      }
      count();
      const path = join(here, entry.name);
      if (entry.isDirectory()) {
        stack.push(path);
      } else if (entry.isSymbolicLink()) {
        links.push(path);
      } else if (entry.isFile() && isDenied(path)) {
        omit.add(path);
      }
    }
  }
  // A link is another way to what it points to, and OpenCode checks only the name it is asked for. The
  // links themselves are not copied, but the file behind a link whose own path is denied
  // (`.env -> secret.txt`) is left out, and a link to a directory (`secrets -> backing`) is walked
  // as if it were that directory, by every path that reaches each folder (only a folder that is
  // already on the way down ends a walk), so the files that a path would name as denied
  // (`secrets/token.json`) are left out where they really are. A target outside the root is not in
  // the copy, so it needs nothing.
  const inside = (/** @type {string} */ link) => {
    try {
      const target = realpathSync(link);
      return rootCovers(dir, [target]) === undefined ? undefined : target;
    } catch {
      return undefined; // A dangling link points to nothing.
    }
  };
  const walkLinked = (
    /** @type {string} */ real,
    /** @type {string} */ virtual,
    /** @type {Set<string>} */ ancestors,
  ) => {
    for (const entry of readdirSync(real, { withFileTypes: true })) {
      if (entry.name === "objects" && basename(real) === ".git") {
        continue;
      }
      count();
      const path = join(real, entry.name);
      const named = join(virtual, entry.name);
      const actual = entry.isSymbolicLink() ? inside(path) : path;
      if (actual === undefined) {
        continue;
      }
      const kind = lstatSync(actual);
      if (kind.isDirectory()) {
        if (!ancestors.has(actual)) {
          walkLinked(actual, named, new Set([...ancestors, actual]));
        } else if (byPath) {
          // The folder is its own ancestor, so it has endless virtual paths, and a denied path pattern
          // could match one of them.
          throw new Error(
            `${relative(dir, path)} links back to a folder above it and a denied read pattern names a path`,
          );
        }
      } else if (kind.isFile() && isDenied(named)) {
        omit.add(actual);
      }
    }
  };
  for (const link of links) {
    const target = inside(link);
    if (target === undefined) {
      continue;
    }
    const kind = lstatSync(target);
    if (kind.isFile()) {
      if (isDenied(link)) {
        omit.add(target);
      }
    } else if (kind.isDirectory()) {
      walkLinked(target, link, new Set([target]));
    }
  }
  // A hard link is the same file under another name, and the copy is made by path: every other name
  // of a left-out file is left out too.
  const linked = new Set();
  for (const path of omit) {
    try {
      const st = lstatSync(path);
      if (st.nlink > 1) {
        linked.add(`${st.dev}:${st.ino}`);
      }
    } catch {
      // Gone since the scan.
    }
  }
  const kept = new Set(keep);
  // A kept file that a rule denies (an env file, a pattern, another name of a denied inode) is not
  // overridden: the run is refused, not given the secret.
  for (const path of kept) {
    const file = files.find((f) => f.path === path);
    if (
      omit.has(path) ||
      (file !== undefined && file.st.nlink > 1 && linked.has(`${file.st.dev}:${file.st.ino}`))
    ) {
      throw new Error(
        `${relative(dir, path)} is a file the read rules deny and cannot be the prompt`,
      );
    }
  }
  const copied = files.filter(
    ({ path, st }) =>
      kept.has(path) ||
      (!everything && !omit.has(path) && !(st.nlink > 1 && linked.has(`${st.dev}:${st.ino}`))),
  );
  const bytes = copied.reduce((sum, { st }) => sum + st.size, 0);
  if (copied.length > limits.files) {
    throw new Error(`more than ${limits.files} files in the review root to copy`);
  }
  if (bytes > limits.bytes) {
    throw new Error(`more than ${limits.bytes} bytes in the review root to copy`);
  }
  const copy = mkdtempSync(join(parent, "opencode-seat-"));
  try {
    options.onCreate?.(copy);
    for (const folder of folders) {
      mkdirSync(join(copy, relative(dir, folder)), { recursive: true, mode: 0o700 });
    }
    const chunk = Buffer.allocUnsafe(1 << 20);
    let done = 0;
    for (const { path, st } of copied) {
      // Open without following a link, then check that what is open is the file that was scanned at
      // this very path: a link swapped in for a file or for any folder on the way fails one of these.
      const fd = openSync(
        path,
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
      );
      try {
        const now = fstatSync(fd);
        let at = path;
        try {
          at = readlinkSync(`/proc/self/fd/${fd}`);
        } catch {
          // No /proc: the sandbox, the only user of the copy, is Linux only.
        }
        if (
          !now.isFile() ||
          now.ino !== st.ino ||
          now.dev !== st.dev ||
          now.size !== st.size ||
          at !== path
        ) {
          throw new Error(`${relative(dir, path)} changed while the review root was copied`);
        }
        const out = openSync(join(copy, relative(dir, path)), "wx", 0o444);
        try {
          for (let left = now.size; left > 0;) {
            const n = readSync(fd, chunk, 0, Math.min(left, chunk.length), null);
            if (n === 0) {
              throw new Error(`${relative(dir, path)} shrank while the review root was copied`);
            }
            for (let at = 0; at < n;) {
              const wrote = writeSync(out, chunk, at, n - at);
              if (wrote === 0) {
                throw new Error(`${relative(dir, path)} could not be written in full`);
              }
              at += wrote;
            }
            left -= n;
          }
        } finally {
          closeSync(out);
        }
      } finally {
        closeSync(fd);
      }
      if (++done % 64 === 0) {
        await new Promise((resume) => setImmediate(resume));
      }
    }
  } catch (e) {
    rmSync(copy, { recursive: true, force: true });
    throw e;
  }
  return { copy, files: copied.length, bytes };
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
 * The bubblewrap prefix: only SYSTEM, the name-resolution files under /etc and /run, each `mounts`
 * pair (a real source shown read-only at the path the seat knows it by) and the `shown` paths (real
 * paths, read-only), with private /tmp, /dev, /proc and an empty home.
 * @param {string} home the home folder
 * @param {string[]} shown
 * @param {[string, string][]} [mounts]
 */
export function sandboxArgs(home, shown, mounts = []) {
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
    ...mounts.flatMap(([from, to]) => ["--ro-bind", realpathSync(from), to]),
    ...real(shown).flatMap((p) => ["--ro-bind", p, p]),
  ];
}

/**
 * The read patterns the user's global OpenCode config denies or asks about. A missing file is
 * optional; one that exists and cannot be read or parsed here (comments need Bun) throws, so its denials
 * are never dropped silently.
 * @param {string} configDir
 */
export function userReadDenials(configDir) {
  /** @type {string[]} */
  const denied = [];
  let everything = false;
  const actions = new Set(["allow", "ask", "deny"]);
  const isAction = (/** @type {unknown} */ v) => typeof v === "string" && actions.has(v);
  const isRecord = (/** @type {unknown} */ v) =>
    typeof v === "object" && v !== null && !Array.isArray(v);
  /** @param {unknown} v @returns {[string, unknown][]} */
  const entriesOf = (v) => Object.entries(/** @type {Record<string, unknown>} */ (v));
  // OpenCode matches a tool name against a permission key as a glob, so every key that matches "read"
  // (`read`, `*`, `r*`, `?ead`) restricts reads.
  const forRead = (/** @type {string} */ key) => globRegex(key).test("read");
  // OpenCode loads both files when both exist, so the denials of each count; both are always read, so a
  // second file that cannot be used refuses the run even when the first already denies everything.
  for (const name of ["opencode.json", "opencode.jsonc"]) {
    const path = join(configDir, name);
    /** @type {any} */
    let config;
    try {
      const parse = /** @type {any} */ (globalThis).Bun?.JSONC?.parse ?? JSON.parse;
      config = parse(readFileSync(path, "utf8"));
    } catch (e) {
      // An absent file is optional. One that exists and cannot be read or parsed (JSONC comments under a
      // runtime without a JSONC parser) is refused: its denials would otherwise be dropped silently.
      if (
        /** @type {{ code?: string }} */ (e).code !== "ENOENT" &&
        /** @type {{ code?: string }} */ (e).code !== "ENOTDIR"
      ) {
        throw new Error(
          `${path} cannot be read or parsed here (comments in it need Bun): ${e instanceof Error ? e.message : String(e)}`,
          { cause: e },
        );
      }
      continue;
    }
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
        if (!forRead(key)) {
          continue;
        }
        if (isAction(value)) {
          everything ||= value !== "allow";
        } else if (isRecord(value)) {
          for (const [pattern, action] of entriesOf(value)) {
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
    collect(config?.permission, "permission");
    // The same keys elsewhere that restrict reads: agent definitions (any agent may be the seat's), the
    // older `tools` switches (a disabled read tool is a deny-all), and the native `permissions` list.
    if (config?.agent !== undefined) {
      if (!isRecord(config.agent)) {
        throw unsupported("agent");
      }
      for (const [agent, definition] of Object.entries(config.agent)) {
        if (isRecord(definition)) {
          collect(definition.permission, `agent.${agent}.permission`);
          if (isRecord(definition.tools)) {
            everything ||= Object.entries(definition.tools).some(
              ([key, value]) => forRead(key) && value === false,
            );
          }
        }
      }
    }
    if (config?.tools !== undefined) {
      if (!isRecord(config.tools)) {
        throw unsupported("tools");
      }
      everything ||= Object.entries(config.tools).some(
        ([key, value]) => forRead(key) && value === false,
      );
    }
    if (config?.permissions !== undefined) {
      if (!Array.isArray(config.permissions)) {
        throw unsupported("permissions");
      }
      for (const entry of config.permissions) {
        if (!isRecord(entry) || typeof entry.action !== "string") {
          throw unsupported("permissions[]");
        }
        if (forRead(entry.action) && entry.effect !== "allow") {
          if (typeof entry.resource === "string") {
            denied.push(entry.resource);
          } else {
            everything = true;
          }
        }
      }
    }
  }
  return everything ? ["*"] : denied;
}

// Where bubblewrap is looked for: system folders only, never the inherited PATH, because a checkout's
// own tooling (`node_modules/.bin`) is often first on it and the sandbox helper runs before any boundary.
const TRUSTED_BIN = ["/usr/bin", "/bin", "/usr/local/bin", "/run/current-system/sw/bin"];
/**
 * The bubblewrap executable: `override` (the `--bwrap` argument) when it is an absolute path to an
 * executable file, else the first `bwrap` in a trusted system folder, else undefined. No environment
 * variable chooses it: Bun reads a `.env` file from the working directory, the checkout, into the
 * environment before this script runs.
 * @param {string | undefined} override
 * @param {string[]} [trusted]
 */
export function findBwrap(override, trusted = TRUSTED_BIN) {
  const usable = (/** @type {string} */ path) => {
    try {
      accessSync(path, fsConstants.X_OK);
      return statSync(path).isFile();
    } catch {
      return false;
    }
  };
  if (override !== undefined) {
    return isAbsolute(override) && usable(override) ? override : undefined;
  }
  return trusted.map((d) => join(d, "bwrap")).find(usable);
}
/**
 * The bytes of the prompt file at its real path, read from one verified descriptor: opened without
 * following a link, a regular file whose `/proc/self/fd` path is that path, and not a file the rules
 * deny. A swap after the check changes nothing, because the open descriptor is what is read.
 * @param {string} prompt real path
 * @param {(path: string) => boolean} denies
 * @param {number} [limit]
 */
export function readPrompt(prompt, denies, limit = 16 * 1024 * 1024) {
  const fd = openSync(
    prompt,
    fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
  );
  try {
    const st = fstatSync(fd);
    let at = prompt;
    try {
      at = readlinkSync(`/proc/self/fd/${fd}`);
    } catch {
      // No /proc: the sandbox, the only user of this, is Linux only.
    }
    if (!st.isFile() || at !== prompt) {
      throw new Error(`the prompt file ${prompt} is not a regular file at that path`);
    }
    if (denies(at)) {
      throw new Error(`the prompt file ${prompt} is a file the read rules deny`);
    }
    if (st.size > limit) {
      throw new Error(`the prompt file ${prompt} is over ${limit} bytes`);
    }
    const buffer = Buffer.alloc(st.size);
    for (let got = 0; got < buffer.length;) {
      const n = readSync(fd, buffer, got, buffer.length - got, null);
      if (n === 0) {
        throw new Error(`the prompt file ${prompt} shrank while it was read`);
      }
      got += n;
    }
    return buffer;
  } finally {
    closeSync(fd);
  }
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  // After the three required arguments: an optional title and `--bwrap PATH` (the bubblewrap executable,
  // an absolute path) and `--root DIR` (the review checkout). They are arguments, not environment
  // variables, which a checkout's `.env` could set. Launch this script from a folder you trust and name
  // the checkout with `--root`: Bun reads `.env` and `bunfig.toml` (a `preload` runs code) from the
  // launch folder before the script starts, and with no `--root` that folder is the checkout.
  const [model, effort, promptFile, ...rest] = process.argv.slice(2);
  /** @type {string | undefined} */
  let title;
  /** @type {string | undefined} */
  let bwrapOverride;
  /** @type {string | undefined} */
  let rootArg;
  let bad = !model || !effort || !promptFile;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i] ?? "";
    if (arg === "--bwrap" || arg === "--root") {
      const value = rest[++i];
      if (value === undefined || value === "" || (arg === "--bwrap" ? bwrapOverride : rootArg)) {
        bad = true;
      } else if (arg === "--bwrap") {
        bwrapOverride = value;
      } else {
        rootArg = value;
      }
    } else if (title === undefined) {
      title = arg;
    } else {
      bad = true;
    }
  }
  if (bad || !model || !effort || !promptFile) {
    console.error(
      "usage: bun opencode-seat.mjs <model-id> <effort> <prompt-file> [title] [--root CHECKOUT] [--bwrap ABSOLUTE-PATH]",
    );
    process.exit(2);
  }
  title ??= "panel-seat";
  const dir = realpathSync(rootArg ?? process.cwd());
  if (dir === realpathSync(process.cwd())) {
    console.error(
      "[opencode-seat] warning: the launch folder is the checkout, so Bun read its .env and bunfig.toml; launch from a trusted folder with --root",
    );
  }
  const home = homedir();
  const config = process.env.XDG_CONFIG_HOME || join(home, ".config");
  /** @type {string[]} */
  let denials;
  try {
    denials = userReadDenials(join(config, "opencode"));
  } catch (e) {
    console.error(`[opencode-seat] ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  }
  const env = openCodeEnv(process.env, dir, denials);
  // Host-side programs (bubblewrap, OpenCode before the sandbox) run with a PATH of canonical absolute
  // folders outside the checkout, so a `#!/usr/bin/env` line in them does not pick the checkout's tool.
  env.PATH = cleanPath(env.PATH, reviewBase(dir));
  // OpenCode is found outside the review checkout on every system, and that file is what runs.
  const opencode = pathExecutable("opencode", envPath(process.env), reviewBase(dir));
  if (!opencode) {
    console.error("[opencode-seat] opencode is not on PATH outside the review root");
    process.exit(127);
  }
  let cmd = [opencode, ...runArgs(model, effort, promptFile, title)];
  // The copy the seat runs on (Linux), removed on every way out, a stop included.
  /** @type {string | undefined} */
  let sandboxCopy;
  process.on("exit", () => {
    if (sandboxCopy !== undefined) {
      rmSync(sandboxCopy, { recursive: true, force: true });
    }
  });
  /** @type {import("node:child_process").ChildProcess | undefined} */
  let child;
  // A stop sent to this wrapper (a runner's deadline) goes to OpenCode too, with a forced kill after
  // 5 s, so the model request does not outlive the seat; before OpenCode starts it ends the wrapper.
  for (const sig of /** @type {const} */ (["SIGTERM", "SIGINT", "SIGHUP"])) {
    process.on(sig, () => {
      if (child === undefined) {
        process.exit(128 + constants.signals[sig]);
      }
      child.kill(sig);
      setTimeout(() => child?.kill("SIGKILL"), 5000).unref();
    });
  }
  if (process.platform === "linux") {
    const which = opencode;
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
    let bwrap = findBwrap(bwrapOverride);
    if (bwrap === undefined) {
      console.error(
        `[opencode-seat] bwrap is not in a system folder (${TRUSTED_BIN.join(", ")}) and --bwrap is not an absolute path to it`,
      );
      process.exit(127);
    }
    // Same rule as for every helper: not a program of the checkout (a link out of it is fine).
    // Resolved once: the canonical path is what is checked and what runs, so a link swapped in the
    // meantime changes nothing.
    bwrap = realpathSync(bwrap);
    if (rootCovers(reviewBase(dir), [bwrap]) !== undefined) {
      console.error(`[opencode-seat] bwrap ${bwrap} is inside the review root`);
      process.exit(127);
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
    // The prompt file by its real path: the sandbox shows that path, not a link to it. Neither the
    // name it was given nor the file it resolves to may be one the read rules deny.
    const given = resolve(promptFile);
    let prompt = given;
    try {
      prompt = realpathSync(given);
    } catch {
      // OpenCode reports a missing prompt file itself.
    }
    const denies = deniedBy(dir, denials, home);
    if (denies(given) || denies(prompt)) {
      console.error(`[opencode-seat] the prompt file ${given} is a file the read rules deny`);
      process.exit(2);
    }
    // The prompt is one regular file: a folder or a device would put more than the task in view.
    try {
      if (!statSync(prompt).isFile()) {
        console.error(`[opencode-seat] the prompt file ${given} is not a regular file`);
        process.exit(2);
      }
    } catch {
      console.error(`[opencode-seat] the prompt file ${given} cannot be read`);
      process.exit(2);
    }
    // Inside the checkout the prompt is the copy's own file; one outside it is copied into the copy.
    const promptOutside = rootCovers(dir, [prompt]) === undefined;
    let seatPrompt = prompt;
    // The seat runs on a sanitized copy of the checkout, shown at the checkout's own path. The copy
    // lives outside the checkout, where a writer there cannot swap it.
    const parent = realpathSync(tmpdir());
    if (rootCovers(dir, [parent]) !== undefined) {
      console.error(`[opencode-seat] the temporary folder ${parent} is inside the review root`);
      process.exit(2);
    }
    try {
      await copyReviewRoot(dir, parent, denials, home, [prompt], {
        onCreate: (made) => {
          sandboxCopy = made;
        },
      });
      if (promptOutside) {
        // A snapshot in the copy, so no outside path is mounted and a later swap changes nothing.
        const name = `.panel-seat-prompt-${randomBytes(6).toString("hex")}.md`;
        writeFileSync(join(String(sandboxCopy), name), readPrompt(prompt, denies), {
          flag: "wx",
          mode: 0o444,
        });
        seatPrompt = join(dir, name);
      }
    } catch (e) {
      console.error(`[opencode-seat] ${e instanceof Error ? e.message : String(e)}`);
      process.exit(2);
    }
    cmd = [
      bwrap,
      ...sandboxArgs(
        home,
        [
          // The binary alone (a self-contained executable); its folder could be the home folder.
          binary,
        ],
        [[String(sandboxCopy), dir]],
      ).slice(1),
      "--chdir",
      dir,
      "--setenv",
      "TMPDIR",
      "/tmp",
      "--",
      binary,
      ...runArgs(model, effort, seatPrompt, title),
    ];
  }
  child = spawn(cmd[0] ?? "", cmd.slice(1), {
    cwd: sandboxCopy ?? dir,
    env,
    stdio: ["ignore", "inherit", "inherit"],
  });
  child.on("error", (e) => {
    console.error(`[opencode-seat] cannot start ${cmd[0]}: ${e.message}`);
    process.exit(127);
  });
  child.on("close", (code, signal) =>
    process.exit(code ?? (signal ? 128 + constants.signals[signal] : 1)),
  );
}
