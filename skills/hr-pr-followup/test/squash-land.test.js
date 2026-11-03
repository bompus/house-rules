import { afterEach, expect, test as base } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// These drive a bash script and POSIX git behavior.
const test = process.platform === "win32" ? base.skip : base;
const script = new URL("../scripts/squash-land.sh", import.meta.url).pathname;
/** @type {string[]} */
const roots = [];
afterEach(() => {
  for (const path of roots.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

// A runner has no Git identity configured; the squash commit needs one.
const identity = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_CONFIG_")),
  ),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
};
/**
 * @param {string} cwd
 * @param {string[]} args
 */
function git(cwd, ...args) {
  const r = Bun.spawnSync(["git", ...args], { cwd, env: identity });
  if (r.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
  }
  return r.stdout.toString().trim();
}
/** @param {string} [ignore] lines of .gitignore */
function repo(ignore = "local.env\n") {
  const root = mkdtempSync(join(tmpdir(), "squash-land-"));
  roots.push(root);
  git(root, "init", "-q", "-b", "main");
  writeFileSync(join(root, ".gitignore"), ignore);
  writeFileSync(join(root, "a.txt"), "base\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "base");
  git(root, "branch", "task");
  return root;
}
/**
 * @param {string} root
 * @param {string} branch
 * @param {(root: string) => void} change
 */
function commitChange(root, branch, change) {
  git(root, "switch", "-q", branch);
  change(root);
  git(root, "add", "-A", "-f");
  git(root, "commit", "-qm", `${branch}: change`);
}
/** Task branch changes `change`; main then moves on with b.txt, so the two have diverged. */
const diverge = (/** @type {string} */ root, /** @type {(root: string) => void} */ change) => {
  commitChange(root, "task", change);
  commitChange(root, "main", (r) => writeFileSync(join(r, "b.txt"), "main moved\n"));
};
/** @param {string} root @param {string} ref @param {string} [cwd] */
const run = (root, ref, cwd = root) => {
  const r = Bun.spawnSync(["bash", script, ref, "Squash the task"], { cwd, env: identity });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
};
const read = (/** @type {string} */ root, /** @type {string} */ file) =>
  readFileSync(join(root, file), "utf8");

test("a diverged branch is squashed into one commit on the base, whatever the branch history", () => {
  const root = repo();
  commitChange(root, "task", (r) => writeFileSync(join(r, "c.txt"), "one\n"));
  commitChange(root, "task", (r) => writeFileSync(join(r, "d.txt"), "two\n"));
  commitChange(root, "main", (r) => writeFileSync(join(r, "b.txt"), "main moved\n"));
  const before = git(root, "rev-parse", "HEAD");
  const r = run(root, "task");
  expect(r.code).toBe(0);
  expect(git(root, "rev-parse", "HEAD")).toBe(r.out.trim());
  expect(git(root, "rev-list", "--parents", "-n", "1", "HEAD")).toBe(`${r.out.trim()} ${before}`);
  expect(git(root, "log", "-1", "--format=%s")).toBe("Squash the task");
  expect([read(root, "b.txt"), read(root, "c.txt"), read(root, "d.txt")]).toEqual([
    "main moved\n",
    "one\n",
    "two\n",
  ]);
});

test("an ignored local file the squash would replace is kept and nothing moves", () => {
  const root = repo();
  diverge(root, (r) => writeFileSync(join(r, "local.env"), "FROM-BRANCH\n"));
  writeFileSync(join(root, "local.env"), "MY-LOCAL-SECRET\n");
  const before = git(root, "rev-parse", "HEAD");
  const r = run(root, "task");
  expect(r.code).toBe(1);
  expect(read(root, "local.env")).toBe("MY-LOCAL-SECRET\n");
  expect(git(root, "rev-parse", "HEAD")).toBe(before);
});

test("an untracked file the squash would replace is kept", () => {
  const root = repo();
  diverge(root, (r) => writeFileSync(join(r, "notes.txt"), "from branch\n"));
  writeFileSync(join(root, "notes.txt"), "mine\n");
  expect(run(root, "task").code).toBe(1);
  expect(read(root, "notes.txt")).toBe("mine\n");
});

test("an ignored file or symlink where the result needs a directory is kept", () => {
  const root = repo("local.env\nbuild\nvendor\n");
  diverge(root, (r) => {
    mkdirSync(join(r, "build"));
    writeFileSync(join(r, "build", "x"), "FROM-BRANCH\n");
    mkdirSync(join(r, "vendor"));
    writeFileSync(join(r, "vendor", "lib.js"), "lib\n");
  });
  writeFileSync(join(root, "build"), "MY-LOCAL-SECRET\n");
  symlinkSync(tmpdir(), join(root, "vendor"));
  expect(run(root, "task").code).toBe(1);
  expect(read(root, "build")).toBe("MY-LOCAL-SECRET\n");
});

test("a tracked directory that becomes a file keeps the ignored files inside it", () => {
  const root = repo("local.env\n*.secret\n");
  mkdirSync(join(root, "d"));
  writeFileSync(join(root, "d", "x"), "tracked\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "dir d");
  git(root, "branch", "-f", "task");
  diverge(root, (r) => {
    rmSync(join(r, "d"), { recursive: true });
    writeFileSync(join(r, "d"), "NOW-A-FILE\n");
  });
  writeFileSync(join(root, "d", "hidden.secret"), "MY-LOCAL-SECRET\n");
  expect(run(root, "task").code).toBe(1);
  expect(read(root, "d/hidden.secret")).toBe("MY-LOCAL-SECRET\n");
});

test("it works from a subdirectory of the checkout", () => {
  const root = repo();
  mkdirSync(join(root, "sub"));
  writeFileSync(join(root, "sub", "s.txt"), "s\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "sub");
  git(root, "branch", "-f", "task");
  diverge(root, (r) => writeFileSync(join(r, "c.txt"), "new\n"));
  expect(run(root, "task", join(root, "sub")).code).toBe(0);
  expect(read(root, "c.txt")).toBe("new\n");
});

test("a conflict, a branch already contained, a bad ref and a missing ref change nothing", () => {
  const root = repo();
  diverge(root, (r) => writeFileSync(join(r, "a.txt"), "task edit\n"));
  commitChange(root, "main", (r) => writeFileSync(join(r, "a.txt"), "main edit\n"));
  const before = git(root, "rev-parse", "HEAD");
  const conflict = run(root, "task");
  expect(conflict.code).toBe(2);
  expect(conflict.err).toContain("conflict");
  expect(git(root, "rev-parse", "HEAD")).toBe(before);
  expect(run(root, "no-such-branch").code).toBe(2);
  expect(Bun.spawnSync(["bash", script], { cwd: root }).exitCode).toBe(2);
  // The base itself: nothing to squash.
  const same = run(root, "main");
  expect(same.code).toBe(0);
  expect(git(root, "rev-parse", "HEAD")).toBe(before);
});

test("a checkout with no commit says so", () => {
  const root = mkdtempSync(join(tmpdir(), "squash-land-"));
  roots.push(root);
  git(root, "init", "-q", "-b", "main");
  const r = run(root, "main");
  expect(r.code).toBe(2);
  expect(r.err).toContain("no commit");
});

/** @param {string} root @param {string} name @param {string} body */
function hook(root, name, body) {
  const path = join(root, ".git", "hooks", name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

test("the repository's commit hooks run for the squash and a rejecting hook stops it", () => {
  const root = repo();
  diverge(root, (r) => writeFileSync(join(r, "c.txt"), "new\n"));
  hook(root, "pre-commit", "echo no >&2; exit 1");
  const before = git(root, "rev-parse", "HEAD");
  const r = run(root, "task");
  expect(r.code).toBe(1);
  expect(r.err).toContain("refused");
  expect(git(root, "rev-parse", "HEAD")).toBe(before);
  expect(existsSync(join(root, "c.txt"))).toBe(false);
  // The throwaway worktree is gone.
  expect(git(root, "worktree", "list").split("\n")).toHaveLength(1);
});

test("a commit-msg hook can rewrite the message of the squash", () => {
  const root = repo();
  diverge(root, (r) => writeFileSync(join(r, "c.txt"), "new\n"));
  hook(root, "commit-msg", 'printf "\\nChecked by hook\\n" >> "$1"');
  expect(run(root, "task").code).toBe(0);
  expect(git(root, "log", "-1", "--format=%B")).toContain("Checked by hook");
});

test("a merge.ff setting does not turn the squash into a conflict", () => {
  for (const value of ["false", "only"]) {
    const root = repo();
    diverge(root, (r) => writeFileSync(join(r, "c.txt"), "new\n"));
    git(root, "config", "merge.ff", value);
    const r = run(root, "task");
    expect(r.code).toBe(0);
    expect(read(root, "c.txt")).toBe("new\n");
  }
});

test("a failure that is not a conflict says what Git reported", () => {
  const root = repo();
  diverge(root, (r) => writeFileSync(join(r, "c.txt"), "new\n"));
  // A broken smudge filter makes the throwaway worktree fail to check out.
  git(root, "config", "filter.boom.clean", "cat");
  git(root, "config", "filter.boom.smudge", "false");
  git(root, "config", "filter.boom.required", "true");
  writeFileSync(join(root, ".gitattributes"), "a.txt filter=boom\n");
  git(root, "add", ".gitattributes");
  git(root, "commit", "-qm", "attrs");
  const before = git(root, "rev-parse", "HEAD");
  const r = run(root, "task");
  expect(r.code).toBe(1);
  expect(r.err).toContain("squash-land:");
  expect(git(root, "rev-parse", "HEAD")).toBe(before);
  expect(git(root, "worktree", "list").split("\n")).toHaveLength(1);
});

test("hooks in an ignored core.hooksPath directory still run", () => {
  const root = repo(".githooks/\nlocal.env\n");
  diverge(root, (r) => writeFileSync(join(r, "c.txt"), "new\n"));
  // Created after the setup commits, which add ignored files too; the directory stays untracked.
  mkdirSync(join(root, ".githooks"));
  writeFileSync(join(root, ".githooks", "pre-commit"), "#!/bin/sh\necho no >&2; exit 1\n", {
    mode: 0o755,
  });
  git(root, "config", "core.hooksPath", ".githooks");
  const before = git(root, "rev-parse", "HEAD");
  const r = run(root, "task", root);
  expect(r.code).toBe(1);
  expect(git(root, "rev-parse", "HEAD")).toBe(before);
  // From a subdirectory too.
  mkdirSync(join(root, "sub"), { recursive: true });
  expect(run(root, "task", join(root, "sub")).code).toBe(1);
});

test("an exported GIT_DIR and GIT_WORK_TREE do not send the squash to the checkout", () => {
  const root = repo();
  diverge(root, (r) => writeFileSync(join(r, "local.env"), "FROM-BRANCH\n"));
  writeFileSync(join(root, "local.env"), "MINE\n");
  const before = git(root, "rev-parse", "HEAD");
  const r = Bun.spawnSync(["bash", script, "task", "Squash the task"], {
    cwd: root,
    env: { ...identity, GIT_DIR: join(root, ".git"), GIT_WORK_TREE: root },
  });
  expect(r.exitCode).toBe(1);
  expect(read(root, "local.env")).toBe("MINE\n");
  expect(git(root, "rev-parse", "HEAD")).toBe(before);
});

test("a branch-configured squash or autostash does not change what lands", () => {
  const root = repo();
  diverge(root, (r) => writeFileSync(join(r, "c.txt"), "new\n"));
  git(root, "config", "branch.main.mergeOptions", "--squash");
  git(root, "config", "merge.autoStash", "true");
  const r = run(root, "task");
  expect(r.code).toBe(0);
  expect(git(root, "rev-parse", "HEAD")).toBe(r.out.trim());
  expect(git(root, "stash", "list")).toBe("");
});

test("a relative hooks path inside .git still runs the hook", () => {
  const root = repo();
  diverge(root, (r) => writeFileSync(join(r, "c.txt"), "new\n"));
  git(root, "config", "core.hooksPath", ".git/hooks");
  hook(root, "pre-commit", "echo no >&2; exit 1");
  const before = git(root, "rev-parse", "HEAD");
  expect(run(root, "task").code).toBe(1);
  expect(git(root, "rev-parse", "HEAD")).toBe(before);
});

test("it refuses when the checkout moves to another branch while the squash is built", () => {
  const root = repo();
  diverge(root, (r) => writeFileSync(join(r, "c.txt"), "new\n"));
  git(root, "branch", "other");
  // A hook runs mid-squash and switches the main checkout to a branch at the same commit.
  hook(
    root,
    "pre-commit",
    `env -u GIT_DIR -u GIT_INDEX_FILE -u GIT_WORK_TREE git -C '${root}' switch -q other`,
  );
  const r = run(root, "task");
  expect(r.code).toBe(1);
  expect(r.err).toContain("another branch");
  expect(git(root, "rev-parse", "main")).toBe(git(root, "rev-parse", "other"));
  expect(existsSync(join(root, "c.txt"))).toBe(false);
});

test("a detached checkout is refused before anything is built", () => {
  const root = repo();
  diverge(root, (r) => writeFileSync(join(r, "c.txt"), "new\n"));
  git(root, "switch", "-q", "--detach");
  const r = run(root, "task");
  expect(r.code).toBe(2);
  expect(r.err).toContain("detached");
  expect(git(root, "worktree", "list").split("\n")).toHaveLength(1);
});

test("uncommitted changes to a tracked file stop the landing and stay as they are", () => {
  const root = repo();
  diverge(root, (r) => writeFileSync(join(r, "c.txt"), "new\n"));
  writeFileSync(join(root, "a.txt"), "my edit\n");
  const before = git(root, "rev-parse", "HEAD");
  const r = run(root, "task");
  expect(r.code).toBe(1);
  expect(r.err).toContain("uncommitted");
  expect(read(root, "a.txt")).toBe("my edit\n");
  expect(git(root, "rev-parse", "HEAD")).toBe(before);
});

test("a task that changes a tracked hook is checked by its own version", () => {
  const root = repo();
  mkdirSync(join(root, ".githooks"));
  writeFileSync(join(root, ".githooks", "pre-commit"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  git(root, "add", ".githooks");
  git(root, "commit", "-qm", "hook");
  git(root, "branch", "-f", "task");
  commitChange(root, "task", (r) => {
    writeFileSync(join(r, ".githooks", "pre-commit"), "#!/bin/sh\necho no >&2; exit 1\n", {
      mode: 0o755,
    });
  });
  commitChange(root, "main", (r) => writeFileSync(join(r, "b.txt"), "main moved\n"));
  git(root, "config", "core.hooksPath", ".githooks");
  const before = git(root, "rev-parse", "HEAD");
  expect(run(root, "task").code).toBe(1);
  expect(git(root, "rev-parse", "HEAD")).toBe(before);
});

test("branch-conditional identity of the checkout is used for the squash commit", () => {
  const root = repo();
  diverge(root, (r) => writeFileSync(join(r, "c.txt"), "new\n"));
  writeFileSync(
    join(root, ".git", "onmain.cfg"),
    "[user]\n\tname = On Main\n\temail = main@example.com\n",
  );
  git(root, "config", "includeIf.onbranch:main.path", join(root, ".git", "onmain.cfg"));
  const { GIT_AUTHOR_NAME, GIT_AUTHOR_EMAIL, GIT_COMMITTER_NAME, GIT_COMMITTER_EMAIL, ...rest } =
    identity;
  void [GIT_AUTHOR_NAME, GIT_AUTHOR_EMAIL, GIT_COMMITTER_NAME, GIT_COMMITTER_EMAIL];
  const r = Bun.spawnSync(["bash", script, "task", "Squash the task"], { cwd: root, env: rest });
  expect(r.exitCode).toBe(0);
  expect(git(root, "log", "-1", "--format=%an <%ae>")).toBe("On Main <main@example.com>");
});

test("a branch that verifies signatures is refused, however the setting reaches it", () => {
  for (const setup of [
    (/** @type {string} */ root) =>
      git(root, "config", "branch.main.mergeOptions", "--verify-signatures"),
    (/** @type {string} */ root) => {
      writeFileSync(join(root, ".git", "sig.cfg"), "[merge]\n\tverifySignatures = true\n");
      git(root, "config", "includeIf.onbranch:main.path", join(root, ".git", "sig.cfg"));
    },
    (/** @type {string} */ root) => {
      git(root, "config", "--add", "branch.main.mergeOptions", "--ff");
      git(root, "config", "--add", "branch.main.mergeOptions", "--verify-signatures");
    },
  ]) {
    const root = repo();
    diverge(root, (r) => writeFileSync(join(r, "c.txt"), "new\n"));
    setup(root);
    const before = git(root, "rev-parse", "HEAD");
    const r = run(root, "task");
    expect(r.code).toBe(2);
    expect(r.err).toContain("pull request");
    expect(git(root, "rev-parse", "HEAD")).toBe(before);
    expect(git(root, "worktree", "list").split("\n")).toHaveLength(1);
  }
  // --no-verify-signatures later in mergeOptions turns the setting off again.
  const root = repo();
  diverge(root, (r) => writeFileSync(join(r, "c.txt"), "new\n"));
  git(root, "config", "merge.verifySignatures", "true");
  git(root, "config", "branch.main.mergeOptions", "--no-verify-signatures");
  expect(run(root, "task").code).toBe(0);
});

test("an absolute hooks path inside the checkout uses the squash's own tracked hooks", () => {
  const root = repo();
  mkdirSync(join(root, ".githooks"));
  writeFileSync(join(root, ".githooks", "pre-commit"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  git(root, "add", ".githooks");
  git(root, "commit", "-qm", "hook");
  git(root, "branch", "-f", "task");
  commitChange(root, "task", (r) => {
    writeFileSync(join(r, ".githooks", "pre-commit"), "#!/bin/sh\necho no >&2; exit 1\n", {
      mode: 0o755,
    });
  });
  commitChange(root, "main", (r) => writeFileSync(join(r, "b.txt"), "main moved\n"));
  git(root, "config", "core.hooksPath", join(root, ".githooks"));
  const before = git(root, "rev-parse", "HEAD");
  expect(run(root, "task").code).toBe(1);
  expect(git(root, "rev-parse", "HEAD")).toBe(before);
});

test("a hooks directory the task adds is used for the commit", () => {
  const root = repo();
  diverge(root, (r) => {
    mkdirSync(join(r, ".githooks"));
    writeFileSync(join(r, ".githooks", "pre-commit"), "#!/bin/sh\necho no >&2; exit 1\n", {
      mode: 0o755,
    });
  });
  git(root, "config", "core.hooksPath", ".githooks");
  const before = git(root, "rev-parse", "HEAD");
  expect(run(root, "task").code).toBe(1);
  expect(git(root, "rev-parse", "HEAD")).toBe(before);
});

test("an exported GIT_INDEX_FILE does not break an ordinary landing", () => {
  const root = repo();
  diverge(root, (r) => writeFileSync(join(r, "c.txt"), "new\n"));
  const r = Bun.spawnSync(["bash", script, "task", "Squash the task"], {
    cwd: root,
    env: { ...identity, GIT_INDEX_FILE: join(root, ".git", "index") },
  });
  expect(r.exitCode).toBe(0);
  expect(read(root, "c.txt")).toBe("new\n");
});

test("mergeOptions is read the way Git reads it: quotes and abbreviations", () => {
  const cases = [
    // [merge.verifySignatures, mergeOptions, expected exit]
    ["true", "'--no-verify-signatures'", 0],
    ["true", '"--no-verify-s"', 0],
    ["false", "'--verify-signatures'", 2],
    ["false", "--verify-sign", 2],
    ["false", "--ff --verify-sign", 2],
    // --verify is the hooks option, not signatures.
    ["false", "--verify", 0],
  ];
  for (const [verify, options, code] of cases) {
    const root = repo();
    diverge(root, (r) => writeFileSync(join(r, "c.txt"), "new\n"));
    git(root, "config", "merge.verifySignatures", String(verify));
    git(root, "config", "branch.main.mergeOptions", String(options));
    expect([options, run(root, "task").code]).toEqual([options, code]);
  }
});

test("only the last mergeOptions value counts, as in Git", () => {
  const root = repo();
  diverge(root, (r) => writeFileSync(join(r, "c.txt"), "new\n"));
  git(root, "config", "--add", "branch.main.mergeOptions", "--verify-signatures");
  git(root, "config", "--add", "branch.main.mergeOptions", "--ff");
  expect(run(root, "task").code).toBe(0);
});

test("a branch-conditional OpenPGP signer is used for the squash commit", () => {
  const root = repo();
  diverge(root, (r) => writeFileSync(join(r, "c.txt"), "new\n"));
  const signer = join(root, ".git", "signer");
  writeFileSync(
    signer,
    "#!/bin/sh\ncat >/dev/null\necho '[GNUPG:] SIG_CREATED D 1 10 00 0 ABCDEF' >&2\n" +
      "printf '%s\\n' '-----BEGIN PGP SIGNATURE-----' stub '-----END PGP SIGNATURE-----'\n",
    { mode: 0o755 },
  );
  writeFileSync(
    join(root, ".git", "onmain.cfg"),
    `[commit]\n\tgpgSign = true\n[gpg]\n\tformat = openpgp\n[gpg "openpgp"]\n\tprogram = ${signer}\n`,
  );
  git(root, "config", "includeIf.onbranch:main.path", join(root, ".git", "onmain.cfg"));
  const r = run(root, "task");
  expect(r.code).toBe(0);
  expect(git(root, "cat-file", "-p", "HEAD")).toContain("BEGIN PGP SIGNATURE");
});

test("a hooks path at the top of the checkout uses the hooks the task adds there", () => {
  const root = repo();
  diverge(root, (r) =>
    writeFileSync(join(r, "pre-commit"), "#!/bin/sh\necho no >&2; exit 1\n", { mode: 0o755 }),
  );
  git(root, "config", "core.hooksPath", ".");
  const before = git(root, "rev-parse", "HEAD");
  expect(run(root, "task").code).toBe(1);
  expect(git(root, "rev-parse", "HEAD")).toBe(before);
});

test("mergeOptions is split with Git's escapes and its option arguments are skipped", () => {
  const cases = [
    ["true", "\\--no-verify-signatures", 0],
    ["false", "-m '--verify-signatures'", 0],
    ["false", "--message '--verify-signatures'", 0],
    ["true", "-m x --no-verify-signatures", 0],
    ["false", "-m x --verify-signatures", 2],
    ["false", "--message=x --verify-signatures", 2],
  ];
  for (const [verify, options, code] of cases) {
    const root = repo();
    diverge(root, (r) => writeFileSync(join(r, "c.txt"), "new\n"));
    git(root, "config", "merge.verifySignatures", String(verify));
    git(root, "config", "branch.main.mergeOptions", String(options));
    expect([options, run(root, "task").code]).toEqual([options, code]);
  }
});

/** A repository whose base commit has a submodule at mod/. */
function repoWithSubmodule() {
  const root = repo();
  const sub = mkdtempSync(join(tmpdir(), "squash-land-sub-"));
  roots.push(sub);
  git(sub, "init", "-q", "-b", "main");
  writeFileSync(join(sub, "s.txt"), "s\n");
  git(sub, "add", "-A");
  git(sub, "commit", "-qm", "sub");
  git(root, "-c", "protocol.file.allow=always", "submodule", "add", "-q", sub, "mod");
  git(root, "commit", "-qm", "add submodule");
  git(root, "branch", "-f", "task");
  return root;
}

test("a checkout with a submodule is out of scope, whatever the squash touches", () => {
  for (const initialized of [true, false]) {
    const root = repoWithSubmodule();
    // The squash changes nothing near the submodule.
    diverge(root, (r) => writeFileSync(join(r, "c.txt"), "new\n"));
    if (!initialized) {
      git(root, "submodule", "deinit", "-q", "-f", "mod");
    }
    const before = git(root, "rev-parse", "HEAD");
    const r = run(root, "task");
    expect(r.code).toBe(1);
    expect(r.err).toContain("submodule");
    expect(r.err).toContain("pull request");
    expect(git(root, "rev-parse", "HEAD")).toBe(before);
    expect(existsSync(join(root, "c.txt"))).toBe(false);
    expect(git(root, "worktree", "list").split("\n")).toHaveLength(1);
  }
});

test("a squash that adds a submodule is refused too, and a local directory there is kept", () => {
  const root = repo();
  const sub = mkdtempSync(join(tmpdir(), "squash-land-sub-"));
  roots.push(sub);
  git(sub, "init", "-q", "-b", "main");
  writeFileSync(join(sub, "s.txt"), "s\n");
  git(sub, "add", "-A");
  git(sub, "commit", "-qm", "sub");
  git(root, "switch", "-q", "task");
  git(root, "-c", "protocol.file.allow=always", "submodule", "add", "-q", sub, "lib");
  git(root, "commit", "-qm", "add submodule");
  git(root, "switch", "-q", "main");
  rmSync(join(root, "lib"), { recursive: true, force: true });
  writeFileSync(join(root, "b.txt"), "main moved\n");
  git(root, "add", "b.txt");
  git(root, "commit", "-qm", "main moved");
  mkdirSync(join(root, "lib"));
  writeFileSync(join(root, "lib", "mine.txt"), "MINE\n");
  const before = git(root, "rev-parse", "HEAD");
  const r = run(root, "task");
  expect(r.code).toBe(1);
  expect(read(root, "lib/mine.txt")).toBe("MINE\n");
  expect(git(root, "rev-parse", "HEAD")).toBe(before);
});

test("a relative GIT_DIR from a subdirectory does not hide a submodule", () => {
  const root = repoWithSubmodule();
  // The task replaces the submodule with a file, so only a scan of the checkout itself can see it.
  git(root, "switch", "-q", "task");
  git(root, "rm", "-q", "-f", "mod");
  rmSync(join(root, "mod"), { recursive: true, force: true });
  writeFileSync(join(root, "mod"), "NOW A FILE\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "replace submodule");
  git(root, "switch", "-q", "main");
  rmSync(join(root, "mod"), { recursive: true, force: true });
  writeFileSync(join(root, "b.txt"), "main moved\n");
  git(root, "add", "b.txt");
  git(root, "commit", "-qm", "main moved");
  mkdirSync(join(root, "run"));
  git(root, "-c", "protocol.file.allow=always", "submodule", "update", "--init");
  writeFileSync(join(root, "mod", "note.txt"), "MINE\n");
  const before = git(root, "rev-parse", "HEAD");
  const r = Bun.spawnSync(["bash", script, "task", "Squash the task"], {
    cwd: join(root, "run"),
    env: { ...identity, GIT_DIR: "../.git", GIT_WORK_TREE: root },
  });
  expect(r.exitCode).toBe(1);
  expect(r.stderr.toString()).toContain("submodule");
  expect(read(root, "mod/note.txt")).toBe("MINE\n");
  expect(git(root, "rev-parse", "HEAD")).toBe(before);
});
