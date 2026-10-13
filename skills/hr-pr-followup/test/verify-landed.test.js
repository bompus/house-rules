import { afterEach, expect, test as base } from "bun:test";

// These drive bash scripts and POSIX git behavior.
const test = process.platform === "win32" ? base.skip : base;
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = new URL("../scripts/verify-landed.sh", import.meta.url).pathname;
const roots = [];
const dir = () => {
  const path = mkdtempSync(join(tmpdir(), "verify-landed-"));
  roots.push(path);
  return path;
};
afterEach(() => {
  for (const path of roots.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

const env = {
  ...process.env,
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@example.com",
  GIT_CONFIG_NOSYSTEM: "1",
  // The host's global init.templateDir installs a pre-push hook that rejects the merge commits these fixtures push.
  GIT_CONFIG_GLOBAL: "/dev/null",
};

function sh(cwd, ...args) {
  const run = Bun.spawnSync(args, { cwd, env });
  if (run.exitCode !== 0) {
    throw new Error(args.join(" ") + " failed: " + run.stderr.toString().slice(0, 500));
  }
  return run.stdout.toString().trim();
}

function fixture() {
  const root = dir();
  const remote = join(root, "remote.git");
  sh(root, "git", "-c", "init.defaultBranch=main", "init", "--bare", remote);
  const work = join(root, "work");
  sh(root, "git", "clone", remote, work);
  writeFileSync(join(work, "tracked.txt"), "base\n");
  sh(work, "git", "add", "tracked.txt");
  sh(work, "git", "commit", "--allow-empty", "-m", "base");
  sh(work, "git", "push", "origin", "main");
  return { root, remote, work };
}

function runScript(cwd, ...args) {
  const run = Bun.spawnSync(["bash", script, ...args], { cwd, env });
  return { code: run.exitCode, out: run.stdout.toString(), err: run.stderr.toString() };
}

test("merged commit with no corpse passes", () => {
  const { work } = fixture();
  sh(work, "git", "checkout", "-b", "feature");
  sh(work, "git", "commit", "--allow-empty", "-m", "work");
  const sha = sh(work, "git", "rev-parse", "HEAD");
  sh(work, "git", "checkout", "main");
  sh(work, "git", "merge", "--no-ff", "feature", "-m", "merge");
  sh(work, "git", "push", "origin", "main");
  sh(work, "git", "push", "origin", "feature");
  sh(work, "git", "push", "origin", "--delete", "feature");
  const r = runScript(work, "--commit", sha, "--branch", "feature");
  expect(r.code).toBe(0);
  expect(r.out).toContain("contained:");
  expect(r.out).toContain("local main: current");
  expect(r.out).toContain("no leftover branch:");
});

test("unmerged commit fails containment", () => {
  const { work } = fixture();
  sh(work, "git", "checkout", "-b", "feature");
  sh(work, "git", "commit", "--allow-empty", "-m", "unmerged");
  const sha = sh(work, "git", "rev-parse", "HEAD");
  const r = runScript(work, "--commit", sha);
  expect(r.code).toBe(1);
  expect(r.err).toContain("NOT CONTAINED");
});

test("leftover remote branch fails as corpse", () => {
  const { work } = fixture();
  sh(work, "git", "checkout", "-b", "feature");
  sh(work, "git", "commit", "--allow-empty", "-m", "work");
  const sha = sh(work, "git", "rev-parse", "HEAD");
  sh(work, "git", "push", "origin", "feature");
  sh(work, "git", "checkout", "main");
  sh(work, "git", "merge", "--no-ff", "feature", "-m", "merge");
  sh(work, "git", "push", "origin", "main");
  const r = runScript(work, "--commit", sha, "--branch", "feature");
  expect(r.code).toBe(1);
  expect(r.err).toContain("leftover branch:");
});

for (const output of ["", "partial response\n"]) {
  test(`failed remote branch lookup with ${output ? "partial" : "empty"} output fails verification`, () => {
    const { work } = fixture();
    const sha = sh(work, "git", "rev-parse", "HEAD");
    sh(work, "git", "push", "origin", "HEAD:feature");
    const bin = join(dir(), "bin");
    mkdirSync(bin);
    const wrapper = join(bin, "git");
    writeFileSync(
      wrapper,
      `#!/bin/sh
if [ "$1" = ls-remote ]; then
  printf '%s' "$VERIFY_LANDED_TEST_OUTPUT"
  echo 'fixture branch lookup failure' >&2
  exit 128
fi
exec "$VERIFY_LANDED_TEST_GIT" "$@"
`,
    );
    chmodSync(wrapper, 0o755);
    const run = Bun.spawnSync(
      ["bash", script, "--commit", sha, "--default", "main", "--branch", "feature"],
      {
        cwd: work,
        env: {
          ...env,
          PATH: `${bin}:${env.PATH}`,
          VERIFY_LANDED_TEST_GIT: Bun.which("git"),
          VERIFY_LANDED_TEST_OUTPUT: output,
        },
      },
    );
    expect(run.exitCode).toBe(1);
    expect(run.stderr.toString()).toContain("remote branch lookup failed: origin feature");
    expect(run.stdout.toString()).not.toContain("no leftover branch:");
    expect(sh(work, "git", "rev-parse", "HEAD")).toBe(sha);
  });
}

test("behind default checked out in another worktree is reported, not touched", () => {
  const { root, remote, work } = fixture();
  sh(work, "git", "checkout", "-b", "feature");
  const wt = join(root, "wt");
  sh(work, "git", "worktree", "add", wt, "main");
  const other = join(root, "other");
  sh(root, "git", "clone", remote, other);
  writeFileSync(join(other, "tracked.txt"), "upstream\n");
  sh(other, "git", "commit", "-am", "upstream");
  sh(other, "git", "push", "origin", "main");
  const sha = sh(other, "git", "rev-parse", "HEAD");
  const r = runScript(work, "--commit", sha);
  expect(r.code).toBe(1);
  expect(r.out).toContain("contained:");
  expect(r.out).toContain("checked out at");
  expect(r.out).toContain("leave for its owner");
  expect(r.out).toContain(`git -C ${wt} merge --ff-only `);
  expect(r.out).toContain(wt);
  expect(sh(wt, "git", "rev-parse", "HEAD")).not.toBe(sha);
});

// main one commit behind origin/main; `onMain` leaves main checked out in `work`, else `work` is on feature.
function behind({ onMain }) {
  const { root, remote, work } = fixture();
  if (!onMain) {
    sh(work, "git", "checkout", "-b", "feature");
  }
  const other = join(root, "other");
  sh(root, "git", "clone", remote, other);
  sh(other, "git", "commit", "--allow-empty", "-m", "upstream");
  sh(other, "git", "push", "origin", "main");
  return { work, sha: sh(other, "git", "rev-parse", "HEAD") };
}

test("--ff fast-forwards a default branch checked out nowhere; without it nothing moves", () => {
  const { work, sha } = behind({ onMain: false });
  const before = sh(work, "git", "rev-parse", "main");
  expect(runScript(work, "--commit", sha).out).toContain("safe: git fetch origin main:main");
  expect(sh(work, "git", "rev-parse", "main")).toBe(before);
  const r = runScript(work, "--commit", sha, "--ff");
  expect(r.code).toBe(0);
  expect(r.out).toContain("local main: fast-forwarded 1 commit(s)");
  expect(sh(work, "git", "rev-parse", "main")).toBe(sha);
});

test("--ff fast-forwards a clean default branch checked out here", () => {
  const { work, sha } = behind({ onMain: true });
  const r = runScript(work, "--commit", sha, "--ff");
  expect(r.code).toBe(0);
  expect(r.out).toContain("(checked out here)");
  expect(sh(work, "git", "rev-parse", "HEAD")).toBe(sha);
});

test("--ff leaves a dirty checkout of the default branch alone", () => {
  const { work, sha } = behind({ onMain: true });
  const before = sh(work, "git", "rev-parse", "HEAD");
  writeFileSync(join(work, "notes.txt"), "work in progress\n");
  const r = runScript(work, "--commit", sha, "--ff");
  expect(r.code).toBe(1);
  expect(r.out).toContain("working tree dirty");
  expect(sh(work, "git", "rev-parse", "HEAD")).toBe(before);
});

test("--idle-primary updates the confirmed primary from a task worktree and is repeatable", () => {
  const { work, sha } = behind({ onMain: true });
  const wt = join(dir(), "task");
  sh(work, "git", "worktree", "add", "-b", "task", wt);
  const taskHead = sh(wt, "git", "rev-parse", "HEAD");
  writeFileSync(join(work, "notes.txt"), "unrelated notes\n");
  const r = runScript(wt, "--commit", sha, "--ff", "--idle-primary", work);
  expect(r.code).toBe(0);
  expect(sh(work, "git", "rev-parse", "HEAD")).toBe(sha);
  expect(sh(wt, "git", "rev-parse", "HEAD")).toBe(taskHead);
  expect(sh(work, "git", "status", "--porcelain")).toBe("?? notes.txt");
  const again = runScript(wt, "--commit", sha, "--ff", "--idle-primary", work);
  expect(again.code).toBe(0);
  expect(again.out).toContain("local main: current");
});

test("--idle-primary cannot authorize updating a different linked checkout", () => {
  const { work, sha } = behind({ onMain: false });
  const holder = join(dir(), "holder");
  sh(work, "git", "worktree", "add", holder, "main");
  const before = sh(holder, "git", "rev-parse", "HEAD");
  const r = runScript(work, "--commit", sha, "--ff", "--idle-primary", holder);
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("not this repository's primary checkout");
  expect(sh(holder, "git", "rev-parse", "HEAD")).toBe(before);
});

test("--idle-primary refuses a fast-forward that would overwrite a local edit", () => {
  const { root, remote, work } = fixture();
  const wt = join(root, "task");
  sh(work, "git", "worktree", "add", "-b", "task", wt);
  const other = join(root, "other");
  sh(root, "git", "clone", remote, other);
  writeFileSync(join(other, "tracked.txt"), "upstream\n");
  sh(other, "git", "commit", "-am", "upstream");
  sh(other, "git", "push", "origin", "main");
  const sha = sh(other, "git", "rev-parse", "HEAD");
  const before = sh(work, "git", "rev-parse", "HEAD");
  writeFileSync(join(work, "tracked.txt"), "local edit\n");
  const r = runScript(wt, "--commit", sha, "--ff", "--idle-primary", work);
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("would be overwritten");
  expect(sh(work, "git", "rev-parse", "HEAD")).toBe(before);
  expect(sh(work, "git", "diff")).toContain("+local edit");
});

test("--ff reports a diverged default as a failed landing without changing it", () => {
  const { work, sha } = behind({ onMain: true });
  sh(work, "git", "commit", "--allow-empty", "-m", "local work");
  const before = sh(work, "git", "rev-parse", "HEAD");
  const r = runScript(work, "--commit", sha, "--ff");
  expect(r.code).toBe(1);
  expect(r.out).toContain("diverged");
  expect(sh(work, "git", "rev-parse", "HEAD")).toBe(before);
});
