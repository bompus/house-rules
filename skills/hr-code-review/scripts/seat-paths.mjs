// Where a seat's programs come from and where paths may point, for acp-panel-client.mjs and
// opencode-seat.mjs. Nothing here reads PATH: the client builds the list of folders a program may come
// from, resolves each program itself, and starts it by absolute path. See ../references/acp-client.md.
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { delimiter, dirname, isAbsolute, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const WINDOWS = process.platform === "win32";

/**
 * The checkout a review root belongs to: the outermost parent holding `.git` or `.jj`, so a launch below
 * the repository root still keeps the whole checkout's tooling out of reach; the review root itself when
 * there is none, or when that parent is the home folder or above it (a dotfiles repository).
 * @param {string} dir
 */
export function reviewBase(dir) {
  let home = "";
  try {
    home = process.env.HOME ? realpathSync.native(process.env.HOME) : "";
  } catch {
    // No such home folder: nothing is excused as the home folder.
  }
  const start = realpathSync.native(dir);
  // The outermost parent with a marker, so a nested `.jj` or `.git` (a tracked file, a submodule) cannot
  // hide the checkout around it; the home folder and its parents never count.
  let top = start;
  for (let d = start; ; d = dirname(d)) {
    const excused = home === d || (home !== "" && home.startsWith(d + sep));
    if (!excused && (existsSync(join(d, ".git")) || existsSync(join(d, ".jj")))) {
      top = d;
    }
    if (dirname(d) === d) {
      return top;
    }
  }
}

/**
 * Whether `path`, links followed the way the system follows them, is `base` or below it. The deepest
 * part that exists is resolved and the rest is appended, so a path that does not exist yet below a link
 * into the checkout counts as inside it. The cut is on separators, not with `dirname` or `resolve`, which
 * would drop a `..` that follows a link. The system's own resolution (`realpathSync.native`) is the one
 * used: the runtime's own would read `link/..` as the folder above the link's name. A bind mount of the
 * checkout under another name has the same device and inode, so each folder above the path is also
 * compared with the checkout by device and inode.
 * @param {string} base a canonical path
 * @param {string} path
 */
export function inside(base, path) {
  let head = path;
  /** @type {string[]} */
  const rest = [];
  for (;;) {
    try {
      head = realpathSync.native(head);
      break;
    } catch {
      const cut = head.lastIndexOf(sep);
      if (cut <= 0) {
        break;
      }
      rest.unshift(head.slice(cut + 1));
      head = head.slice(0, cut);
    }
  }
  const real = join(head, ...rest);
  if (real === base || real.startsWith(base.endsWith(sep) ? base : base + sep)) {
    return true;
  }
  if (WINDOWS) {
    return false;
  }
  try {
    const checkout = statSync(base);
    for (let d = head; ; d = dirname(d)) {
      const here = statSync(d, { throwIfNoEntry: false });
      if (here && here.ino === checkout.ino && here.dev === checkout.dev) {
        return true;
      }
      if (dirname(d) === d) {
        return false;
      }
    }
  } catch {
    return false;
  }
}

/**
 * The folders a program may come from when the caller names none of its own: the system's.
 * On Windows, the system folder and Git for Windows' folders under Program Files (an installation an
 * administrator makes), so the client still finds `git` to compare the checkout before and after.
 */
export const SYSTEM_DIRS = WINDOWS
  ? [
      process.env.SystemRoot ? join(process.env.SystemRoot, "System32") : "",
      ...[process.env.ProgramFiles, process.env.ProgramW6432].flatMap((programs) =>
        programs ? [join(programs, "Git", "cmd"), join(programs, "Git", "bin")] : [],
      ),
    ].filter(Boolean)
  : [
      "/usr/local/sbin",
      "/usr/local/bin",
      "/usr/sbin",
      "/usr/bin",
      "/sbin",
      "/bin",
      "/run/current-system/sw/bin",
    ];

/**
 * The folders a program may come from: the system's folders that exist and the absolute folders the
 * caller named, each as a canonical path. A named folder that is not absolute, does not exist or is
 * inside the checkout is a refusal, so the list holds nothing the checkout can supply.
 * @param {string[]} named the caller's own folders (`--bin-dir`)
 * @param {string} root the review root
 * @param {(message: string) => never} refuse
 * @returns {string[]}
 */
export function trustedDirs(named, root, refuse) {
  const base = reviewBase(root);
  /** @type {string[]} */
  const out = [];
  for (const dir of named) {
    if (!isAbsolute(dir)) {
      refuse(`--bin-dir ${dir} is not an absolute path`);
    }
    let real;
    try {
      real = realpathSync.native(dir);
    } catch {
      return refuse(`--bin-dir ${dir} does not exist`);
    }
    if (!statSync(real).isDirectory()) {
      refuse(`--bin-dir ${dir} is not a folder`);
    }
    if (inside(base, real)) {
      refuse(`--bin-dir ${dir} is inside the review checkout (${base})`);
    }
    if (real.includes(delimiter)) {
      refuse(`--bin-dir ${dir} has a "${delimiter}" in its name, which would split a PATH entry`);
    }
    out.push(real);
  }
  for (const dir of SYSTEM_DIRS) {
    try {
      const real = realpathSync.native(dir);
      if (!inside(base, real)) {
        out.push(real);
      }
    } catch {
      // A system folder this machine does not have.
    }
  }
  return [...new Set(out)];
}

/**
 * A regular executable file by absolute path, or a bare name found in `dirs` (the first match, the way
 * `execvp` finds it, but over this list only). The path returned is the canonical one that was checked
 * (outside the checkout), so a link changed afterwards changes nothing; a caller that needs the name it
 * was found by (a program that dispatches on it) passes that as the process's own argv[0].
 * Returns undefined for a bare name no folder holds. A relative path with a separator is a refusal.
 * @param {string} name
 * @param {string[]} dirs
 * @param {string} root the review root
 * @param {(message: string) => never} refuse
 * @returns {string | undefined}
 */
export function resolveProgram(name, dirs, root, refuse) {
  const base = reviewBase(root);
  const hasSeparator = WINDOWS ? /[\\/]/.test(name) : name.includes("/");
  if (hasSeparator && !isAbsolute(name)) {
    return refuse(`${name} is a relative path; give an absolute path or a bare name`);
  }
  // On Windows a bare name is a program with its suffix (`git` is `git.exe`); only `.exe` and `.com` run
  // directly, a script (`.cmd`, `.bat`) needs a shell and is not looked for.
  const suffixed = (/** @type {string} */ file) =>
    WINDOWS && !/\.[^\\/.]+$/.test(file) ? [file, `${file}.exe`, `${file}.com`] : [file];
  const candidates = (isAbsolute(name) ? [name] : dirs.map((dir) => join(dir, name))).flatMap(
    suffixed,
  );
  for (const candidate of candidates) {
    /** @type {string | undefined} */
    let real;
    try {
      real = realpathSync.native(candidate);
      accessSync(real, constants.X_OK);
      if (!statSync(real).isFile()) {
        real = undefined;
      }
    } catch {
      real = undefined; // Not there, or not runnable: the next folder.
    }
    if (real === undefined) {
      continue;
    }
    if (inside(base, real)) {
      return refuse(`${candidate} resolves inside the review checkout (${real})`);
    }
    return real;
  }
  return undefined;
}

/**
 * A folder of links for the server's PATH: one link per program the trusted folders hold, named as the
 * folder names it and pointing at its canonical file, the first folder winning. A program whose file is
 * inside the checkout (a link from a tool folder into it) is left out, so no lookup the server or a
 * helper makes can reach the checkout through a folder entry. Not made on Windows, where links need a
 * privilege: there PATH is the trusted folders themselves.
 * @param {string[]} dirs the trusted folders (trustedDirs)
 * @param {string} root the review root
 * @param {string} into the folder to make (must not exist)
 * @param {(message: string) => never} refuse
 * @returns {string} the folder the server's PATH names
 */
export function programFolder(dirs, root, into, refuse) {
  if (WINDOWS) {
    return dirs.join(delimiter);
  }
  // PATH is split on the separator: a `:` in the folder's own path (TMPDIR=/x/stem:/tail) would make
  // `/x/stem` an entry of its own, and that can be a link into the checkout.
  if (into.includes(delimiter)) {
    return refuse(
      `${into} has a "${delimiter}" in its name, which would split a PATH entry; set TMPDIR to another folder`,
    );
  }
  const base = reviewBase(root);
  mkdirSync(into, { mode: 0o700 });
  const checkout = statSync(base);
  const taken = new Set();
  for (const dir of dirs) {
    for (const name of readdirSync(dir)) {
      if (taken.has(name) || name.includes("\0")) {
        continue;
      }
      try {
        const real = realpathSync.native(join(dir, name));
        accessSync(real, constants.X_OK);
        const file = statSync(real);
        if (
          !file.isFile() ||
          inside(base, real) ||
          (file.ino === checkout.ino && file.dev === checkout.dev)
        ) {
          continue;
        }
        symlinkSync(real, join(into, name));
        taken.add(name);
      } catch {
        // A broken link, a folder or a file that does not run: not a program.
      }
    }
  }
  return into;
}

// Variables whose values are paths (or lists of them): a relative one is refused, since the server does
// not start where the caller did, and so is one that points into the checkout.
const PATH_VALUED = new Set(
  "HOME APPDATA LOCALAPPDATA USERPROFILE COMSPEC PROGRAMDATA SYSTEMROOT WINDIR PROGRAMFILES PROGRAMFILES(X86) PROGRAMW6432 TMPDIR TEMP TMP XDG_CONFIG_HOME XDG_DATA_HOME XDG_CACHE_HOME XDG_STATE_HOME XDG_RUNTIME_DIR BUN_INSTALL BUN_INSTALL_CACHE_DIR BUN_INSTALL_BIN BUN_INSTALL_GLOBAL_DIR SSL_CERT_FILE SSL_CERT_DIR NODE_EXTRA_CA_CERTS REQUESTS_CA_BUNDLE CURL_CA_BUNDLE SHELL".split(
    " ",
  ),
);
// The one list among them; a `:` in a single path is part of its name.
const PATH_LISTS = new Set(["SSL_CERT_DIR"]);
// Names that hold a path by their ending, as the agents' own settings do (`CODEX_HOME`,
// `CLAUDE_CONFIG_DIR`, `GOOGLE_APPLICATION_CREDENTIALS`, `AWS_SHARED_CREDENTIALS_FILE`, `*_PATH`).
const PATH_SUFFIX = /(_HOME|_DIR|_DIRS|_PATH|_FILE|_ROOT|_CREDENTIALS|_BUNDLE|_CERTS?)$/i;
// Names that hold one path, not a list, so a `:` in the value is part of it.
const SINGLE_PATH = /(_HOME|_DIR|_FILE|_ROOT|_CREDENTIALS|_BUNDLE|_CERTS?)$/i;
// A network URL (`file:` is not one) held by a variable that is named for a URL.
const URL_NAME = /(^|_)(proxy|url|uri|endpoint)$/i;
// A name that holds a program: absolute, or a bare name the server looks up on its own PATH (the trusted
// folders). A relative path with a separator is read from the server's working directory, the review root.
const PROGRAM_NAME = /_(EXECUTABLE|EXE|BINARY|BIN|PROGRAM|SHELL)$/i;
const NETWORK_URL = /^(?!file:)[a-z][a-z0-9+.-]+:\/\//i;

/**
 * The program-named variables (`CLAUDE_CODE_EXECUTABLE`, `CLAUDE_CODE_SHELL`, `GROK_SHELL`) in `env`, as the
 * seat gets them: an absolute path to an executable outside the checkout becomes its canonical path (a link
 * changed afterwards changes nothing), a path in the checkout is a refusal, and anything else is dropped. A
 * bare name is never forwarded: a runtime reads `claude.js` as `node claude.js` in the server's working
 * folder, and Windows looks a bare `claude.exe` up there before PATH. A relative path with a separator is
 * left for checkEnvPaths to refuse.
 * @param {Record<string, string | undefined>} env changed in place
 * @param {string} root the review root
 * @param {(message: string) => never} refuse
 * @returns {string[]} the names dropped
 */
export function forwardPrograms(env, root, refuse) {
  /** @type {string[]} */
  const dropped = [];
  for (const [name, value] of Object.entries(env)) {
    if (!PROGRAM_NAME.test(name) || value === undefined || value === "") {
      continue;
    }
    if (!(WINDOWS ? /[\\/]/ : /\//).test(value)) {
      delete env[name];
      dropped.push(name);
    } else if (isAbsolute(value)) {
      if (inside(reviewBase(root), value)) {
        refuse(`${name} is inside the review checkout; point it outside`);
      }
      const real = resolveProgram(value, [], root, refuse);
      if (real === undefined) {
        delete env[name];
        dropped.push(name);
      } else {
        env[name] = real;
      }
    }
  }
  return dropped;
}

/**
 * Refuses an environment value that names a relative path, or a path inside the checkout, where a
 * server could be steered by the checkout or resolve it against a folder other than the caller's.
 * Path-valued names must hold absolute paths outside the checkout; any other value must not carry an
 * element that starts with `./` or `../`, or an absolute path inside the checkout.
 * @param {Record<string, string | undefined>} env
 * @param {string} root the review root
 * @param {(message: string) => never} refuse
 */
export function checkEnvPaths(env, root, refuse) {
  const base = reviewBase(root);
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined || value === "") {
      continue;
    }
    const upper = WINDOWS ? name.toUpperCase() : name;
    if (PATH_VALUED.has(upper) || PATH_SUFFIX.test(name)) {
      const parts =
        PATH_LISTS.has(upper) || /_DIRS$/i.test(name) ? value.split(delimiter) : [value];
      for (const part of parts.filter((p) => p !== "")) {
        if (!isAbsolute(part)) {
          refuse(`${name} holds a relative path; give absolute paths outside the review checkout`);
        }
        if (inside(base, part)) {
          refuse(`${name} is inside the review checkout; point it outside`);
        }
      }
    } else if (/^file:/i.test(value)) {
      // Read the way a program reads it (`file://localhost/x` and `file:/x` are `/x`), not by cutting a prefix.
      /** @type {string} */
      let target;
      try {
        target = fileURLToPath(value);
      } catch {
        return refuse(
          `${name} is not a file URL it can read; give an absolute path outside the review checkout`,
        );
      }
      if (inside(base, target)) {
        refuse(`${name} is inside the review checkout; point it outside`);
      }
    } else {
      // Any other name can hold a path too (`CLAUDE_CODE_EXECUTABLE` picks the program an adapter runs), and
      // the agents' prefixes pass whatever they hold, so the value is read: an element that is an absolute
      // path must be outside the checkout, whatever the name says.
      if (value.split(delimiter).some((part) => /^\.\.?([\\/]|$)/.test(part))) {
        refuse(`${name} holds a relative path; give absolute paths outside the review checkout`);
      }
    }
    // Whatever the form (a `*_PATH` list, a `file:` value that is really a list), an element that is an
    // absolute path inside the checkout is refused. Two kinds of value are not read as a list: a name known
    // to hold one path (`HOME`, `*_DIR`: a `:` in it is part of its name), and a network URL held by a
    // URL-named variable (`HTTP_PROXY=http://app:8080` holds the host `app`, not the path `//app`; the
    // scheme has two letters or more, since `C://x` is a Windows path).
    if (PROGRAM_NAME.test(name) && (WINDOWS ? /[\\/]/ : /\//).test(value) && !isAbsolute(value)) {
      refuse(
        `${name} holds a relative path; give an absolute path outside the review checkout, or a bare program name`,
      );
    }
    const singlePath = PATH_VALUED.has(upper) || SINGLE_PATH.test(name);
    const networkUrl = URL_NAME.test(name) && NETWORK_URL.test(value);
    if (
      !singlePath &&
      !networkUrl &&
      [value, ...value.split(delimiter)].some((part) => isAbsolute(part) && inside(base, part))
    ) {
      refuse(`${name} is inside the review checkout; point it outside`);
    }
  }
}
