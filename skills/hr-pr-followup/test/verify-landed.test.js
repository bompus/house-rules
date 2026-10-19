import { afterEach, expect, test as base } from "bun:test";

// These drive bash scripts and POSIX git behavior.
const test = process.platform === "win32" ? base.skip : base;
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = new URL("../scripts/verify-landed.sh", import.meta.url).pathname;
/** @type {string[]} */
const roots = [];
const dir = () => {
  const path = mkdtempSync(join(tmpdir(), "verify-landed-"));
  roots.push(path);
  return path;
};
/** @type {Bun.Subprocess[]} */
const residents = [];
// A live process whose working directory is in `cwd`, as an agent session in a primary checkout is.
/** @param {string} cwd */
function resident(cwd) {
  const child = Bun.spawn(["sleep", "30"], { cwd });
  residents.push(child);
  return child;
}
afterEach(() => {
  for (const child of residents.splice(0)) {
    child.kill();
  }
  for (const path of roots.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

/** @type {Record<string, string | undefined>} */
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

/**
 * @param {string} cwd
 * @param {...string} args
 */
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

/**
 * @param {string} cwd
 * @param {...string} args
 */
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
          VERIFY_LANDED_TEST_GIT: /** @type {string} */ (Bun.which("git")),
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

// main one commit behind origin/main; `onMain` leaves main checked out in `work`, else `work` is on feature.
/** @param {{ onMain: boolean }} options */
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

// The primary holds main, one commit behind; a task worktree is where the script runs.
function primaryBehind() {
  const { work, sha } = behind({ onMain: true });
  const wt = join(dir(), "task");
  sh(work, "git", "worktree", "add", "-b", "task", wt);
  return { work, wt, sha, taskHead: sh(wt, "git", "rev-parse", "HEAD") };
}

test("a default checkout held by another worktree is reported without --ff and updated with it", () => {
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
  const report = runScript(work, "--commit", sha);
  expect(report.code).toBe(1);
  expect(report.out).toContain("contained:");
  expect(report.out).toContain(`checked out at ${wt}; not updated without --ff`);
  expect(sh(wt, "git", "rev-parse", "HEAD")).not.toBe(sha);
  const r = runScript(work, "--commit", sha, "--ff");
  expect(r.code).toBe(0);
  expect(r.out).toContain(`fast-forwarded 1 commit(s) to ${sha} in ${wt}`);
  expect(sh(wt, "git", "rev-parse", "HEAD")).toBe(sha);
});

test("--ff fast-forwards a default branch checked out nowhere; without it nothing moves", () => {
  const { work, sha } = behind({ onMain: false });
  const before = sh(work, "git", "rev-parse", "main");
  expect(runScript(work, "--commit", sha).out).toContain("Safe: git fetch origin main:main");
  expect(sh(work, "git", "rev-parse", "main")).toBe(before);
  const r = runScript(work, "--commit", sha, "--ff");
  expect(r.code).toBe(0);
  expect(r.out).toContain("local main: fast-forwarded 1 commit(s)");
  expect(sh(work, "git", "rev-parse", "main")).toBe(sha);
});

test("a failed landing check with --ff does not offer the safe-fetch hint and moves nothing", () => {
  const { work } = behind({ onMain: false });
  sh(work, "git", "commit", "--allow-empty", "-m", "unmerged");
  const unmerged = sh(work, "git", "rev-parse", "HEAD");
  const before = sh(work, "git", "rev-parse", "main");
  const r = runScript(work, "--commit", unmerged, "--ff");
  expect(r.code).toBe(1);
  expect(r.err).toContain("NOT CONTAINED");
  expect(r.out).toContain("not checked out anywhere; not updated: the landing check failed");
  expect(r.out).not.toContain("Safe:");
  expect(sh(work, "git", "rev-parse", "main")).toBe(before);
});

test("a worktree whose Git state cannot be read counts as holding the default and is skipped", () => {
  const { work, sha } = behind({ onMain: false });
  const broken = join(dir(), "broken");
  sh(work, "git", "worktree", "add", "-b", "other-task", broken);
  writeFileSync(join(broken, ".git"), "gitdir: /nonexistent/worktrees/broken\n");
  const before = sh(work, "git", "rev-parse", "main");
  const r = runScript(work, "--commit", sha, "--ff");
  expect(r.code).toBe(3);
  expect(r.out).toContain(`sync skipped at ${broken}: cannot inspect Git state`);
  expect(r.out).toContain("landed; local sync pending");
  expect(sh(work, "git", "rev-parse", "main")).toBe(before);
});

test("--ff fast-forwards a clean default branch checked out here", () => {
  const { work, sha } = behind({ onMain: true });
  const r = runScript(work, "--commit", sha, "--ff");
  expect(r.code).toBe(0);
  expect(r.out).toContain("(checked out here)");
  expect(sh(work, "git", "rev-parse", "HEAD")).toBe(sha);
});

test("--ff fast-forwards the primary from a task worktree while a process runs in it, and is repeatable", () => {
  const { work, wt, sha, taskHead } = primaryBehind();
  resident(work);
  const r = runScript(wt, "--commit", sha, "--ff");
  expect(r.code).toBe(0);
  expect(r.err).toBe("");
  expect(r.out).toContain(`in ${work}`);
  expect(sh(work, "git", "rev-parse", "HEAD")).toBe(sha);
  expect(sh(wt, "git", "rev-parse", "HEAD")).toBe(taskHead);
  const again = runScript(wt, "--commit", sha, "--ff");
  expect(again.code).toBe(0);
  expect(again.out).toContain("local main: current");
});

test("a primary with uncommitted tracked edits is skipped and reported with exit 3, untouched", () => {
  const { work, wt, sha } = primaryBehind();
  const before = sh(work, "git", "rev-parse", "HEAD");
  writeFileSync(join(work, "tracked.txt"), "work in progress\n");
  const r = runScript(wt, "--commit", sha, "--ff");
  expect(r.code).toBe(3);
  expect(r.out).toContain("contained:");
  expect(r.out).toContain(`sync skipped at ${work}: working tree dirty`);
  expect(r.out).toContain("landed; local sync pending");
  expect(sh(work, "git", "rev-parse", "HEAD")).toBe(before);
  expect(sh(work, "git", "diff")).toContain("+work in progress");
});

test("untracked files in the primary do not block the fast-forward and survive it", () => {
  const { work, wt, sha } = primaryBehind();
  writeFileSync(join(work, "notes.txt"), "scratch\n");
  const r = runScript(wt, "--commit", sha, "--ff");
  expect(r.code).toBe(0);
  expect(sh(work, "git", "rev-parse", "HEAD")).toBe(sha);
  expect(sh(work, "git", "status", "--porcelain")).toBe("?? notes.txt");
});

test("a diverged primary is skipped and reported with exit 3, untouched", () => {
  const { work, sha } = behind({ onMain: true });
  sh(work, "git", "commit", "--allow-empty", "-m", "local work");
  const before = sh(work, "git", "rev-parse", "HEAD");
  const r = runScript(work, "--commit", sha, "--ff");
  expect(r.code).toBe(3);
  expect(r.out).toContain(`sync skipped at ${work}: diverged from origin/main`);
  expect(sh(work, "git", "rev-parse", "HEAD")).toBe(before);
});

test("a primary on another branch keeps its checkout; the default ref still moves", () => {
  const { work, sha } = behind({ onMain: false });
  resident(work);
  writeFileSync(join(work, "notes.txt"), "work in progress\n");
  const r = runScript(work, "--commit", sha, "--ff");
  expect(r.code).toBe(0);
  expect(sh(work, "git", "branch", "--show-current")).toBe("feature");
  expect(sh(work, "git", "rev-parse", "main")).toBe(sha);
  expect(sh(work, "git", "status", "--porcelain")).toBe("?? notes.txt");
});

test("a primary with an unfinished merge is skipped even when status reports a clean tree", () => {
  const { work, wt, sha } = primaryBehind();
  sh(work, "git", "checkout", "-b", "side");
  sh(work, "git", "commit", "--allow-empty", "-m", "side work");
  sh(work, "git", "checkout", "main");
  sh(work, "git", "merge", "--no-commit", "--no-ff", "side");
  expect(sh(work, "git", "status", "--porcelain")).toBe("");
  const before = sh(work, "git", "rev-parse", "HEAD");
  const r = runScript(wt, "--commit", sha, "--ff");
  expect(r.code).toBe(3);
  expect(r.out).toContain(`sync skipped at ${work}: unfinished Git operation: MERGE_HEAD`);
  expect(sh(work, "git", "rev-parse", "HEAD")).toBe(before);
  expect(existsSync(join(work, ".git", "MERGE_HEAD"))).toBe(true);
});

test("a primary paused in a rebase of the default is skipped while HEAD is detached", () => {
  const { work, wt, sha } = primaryBehind();
  const rebase = Bun.spawnSync(["git", "rebase", "--force-rebase", "--exec", "false", "--root"], {
    cwd: work,
    env,
  });
  expect(rebase.exitCode).toBe(1);
  expect(sh(work, "git", "branch", "--show-current")).toBe("");
  const before = sh(work, "git", "rev-parse", "HEAD");
  const r = runScript(wt, "--commit", sha, "--ff");
  expect(r.code).toBe(3);
  expect(r.out).toContain(`sync skipped at ${work}: unfinished Git operation: rebase-merge`);
  expect(sh(work, "git", "rev-parse", "HEAD")).toBe(before);
  expect(sh(work, "git", "rev-parse", "main")).not.toBe(sha);
});

test("a primary in a bisect of the default is skipped while HEAD is detached", () => {
  const { root, remote, work } = fixture();
  for (const n of [1, 2, 3]) {
    sh(work, "git", "commit", "--allow-empty", "-m", `history ${n}`);
  }
  sh(work, "git", "push", "origin", "main");
  const wt = join(dir(), "task");
  sh(work, "git", "worktree", "add", "-b", "task", wt);
  const other = join(root, "other");
  sh(root, "git", "clone", remote, other);
  sh(other, "git", "commit", "--allow-empty", "-m", "upstream");
  sh(other, "git", "push", "origin", "main");
  const sha = sh(other, "git", "rev-parse", "HEAD");
  sh(
    work,
    "git",
    "bisect",
    "start",
    "HEAD",
    sh(work, "git", "rev-list", "--max-parents=0", "HEAD"),
  );
  expect(sh(work, "git", "branch", "--show-current")).toBe("");
  const before = sh(work, "git", "rev-parse", "HEAD");
  const r = runScript(wt, "--commit", sha, "--ff");
  expect(r.code).toBe(3);
  expect(r.out).toContain(`sync skipped at ${work}: unfinished Git operation: BISECT_START`);
  expect(sh(work, "git", "rev-parse", "HEAD")).toBe(before);
});

test("a fast-forward that would overwrite an untracked file is refused by Git and skipped", () => {
  const { root, remote, work } = fixture();
  const other = join(root, "other");
  sh(root, "git", "clone", remote, other);
  writeFileSync(join(other, "added.txt"), "upstream\n");
  sh(other, "git", "add", "added.txt");
  sh(other, "git", "commit", "-m", "upstream adds a file");
  sh(other, "git", "push", "origin", "main");
  const sha = sh(other, "git", "rev-parse", "HEAD");
  const before = sh(work, "git", "rev-parse", "HEAD");
  writeFileSync(join(work, "added.txt"), "local scratch\n");
  const r = runScript(work, "--commit", sha, "--ff");
  expect(r.code).toBe(3);
  expect(r.out).toContain(`sync skipped at ${work}: fast-forward refused: `);
  expect(sh(work, "git", "rev-parse", "HEAD")).toBe(before);
  expect(sh(work, "git", "status", "--porcelain")).toBe("?? added.txt");
});

for (const flag of ["--idle-primary", "--preflight"]) {
  test(`the removed ${flag} flag is an unknown argument and moves nothing`, () => {
    const { work, wt, sha } = primaryBehind();
    const before = sh(work, "git", "rev-parse", "HEAD");
    const r = runScript(wt, "--commit", sha, "--ff", flag);
    expect(r.code).toBe(2);
    expect(r.err).toContain(`unknown argument: ${flag}`);
    expect(sh(work, "git", "rev-parse", "HEAD")).toBe(before);
  });
}
