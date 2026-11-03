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
  ...process.env,
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
