import { afterEach, expect, test as base } from "bun:test";

// These drive bash scripts and POSIX git behavior.
const test = process.platform === "win32" ? base.skip : base;
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const script = new URL("../scripts/verify-landed.sh", import.meta.url).pathname;
/** @type {string[]} */
const roots = [];
const dir = () => {
  const path = mkdtempSync(join(process.env.HOUSE_RULES_TEST_TMP ?? tmpdir(), "verify-landed-"));
  roots.push(path);
  return path;
};
/** @type {Bun.Subprocess[]} */
const residents = [];
/** @type {string[]} */
const deniedDirectories = [];
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
  for (const path of deniedDirectories.splice(0).reverse()) {
    chmodSync(path, 0o755);
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

// Root bypasses mode-based denial. These cases are run only by a genuinely unprivileged process.
const permissionTest = process.getuid?.() === 0 ? base.skip : test;

/** @param {string} path */
function denyDirectory(path) {
  chmodSync(path, 0o555);
  deniedDirectories.push(path);
}

/** @param {string} work */
function checkoutSnapshot(work) {
  /** @type {Record<string, {mode: number, bytes?: string, kind: string}>} */
  const files = {};
  /** @param {string} relative */
  function visit(relative) {
    for (const name of readdirSync(join(work, relative))) {
      if (!relative && name === ".git") {
        continue;
      }
      const path = join(relative, name);
      const stat = lstatSync(join(work, path));
      files[path] = { mode: stat.mode, kind: stat.isDirectory() ? "directory" : "file" };
      if (stat.isDirectory()) {
        visit(path);
      } else {
        files[path].bytes = stat.isSymbolicLink()
          ? readlinkSync(join(work, path))
          : readFileSync(join(work, path)).toString("base64");
      }
    }
  }
  visit("");
  return {
    head: sh(work, "git", "rev-parse", "HEAD"),
    index: readFileSync(
      resolve(work, sh(work, "git", "rev-parse", "--git-path", "index")),
    ).toString("base64"),
    headFile: readFileSync(
      resolve(work, sh(work, "git", "rev-parse", "--git-path", "HEAD")),
    ).toString("base64"),
    indexMode: lstatSync(resolve(work, sh(work, "git", "rev-parse", "--git-path", "index"))).mode,
    files,
  };
}

function permissionFixture() {
  const { root, remote, work } = fixture();
  for (const path of ["a writable", "z denied"]) {
    mkdirSync(join(work, path));
  }
  writeFileSync(join(work, "a writable", "existing"), "before\n");
  writeFileSync(join(work, "z denied", "existing"), "before\n");
  sh(work, "git", "add", ".");
  sh(work, "git", "commit", "-m", "directories");
  sh(work, "git", "push", "origin", "main");
  const other = join(root, "other");
  sh(root, "git", "clone", remote, other);
  return { root, work, other };
}

permissionTest("denied later parent skips before any checkout writes, repeatably", () => {
  expect(process.getuid?.()).not.toBe(0);
  const { work, other } = permissionFixture();
  writeFileSync(join(other, "a writable", "existing"), "after\n");
  writeFileSync(join(other, "a writable", "added"), "new\n");
  writeFileSync(join(other, "z denied", "added"), "new\n");
  sh(other, "git", "add", ".");
  sh(other, "git", "commit", "-m", "upstream");
  sh(other, "git", "push", "origin", "main");
  const sha = sh(other, "git", "rev-parse", "HEAD");
  writeFileSync(join(work, "notes"), "keep\n");
  denyDirectory(join(work, "z denied"));
  const before = checkoutSnapshot(work);
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = runScript(work, "--commit", sha, "--ff");
    expect(r.code).toBe(3);
    expect(checkoutSnapshot(work)).toEqual(before);
    expect(r.out).toContain("not writable: " + join(work, "z denied"));
    expect(existsSync(join(work, "z denied", "added"))).toBe(false);
    expect(r.out).not.toContain("fast-forward refused");
  }
});

/** @param {string} other */
function publishFixture(other) {
  sh(other, "git", "add", "-A");
  sh(other, "git", "commit", "-m", "upstream");
  sh(other, "git", "push", "origin", "main");
  return sh(other, "git", "rev-parse", "HEAD");
}

for (const action of [
  "modify",
  "delete",
  "nested addition",
  "rename source",
  "rename destination",
]) {
  permissionTest(`a denied parent prevents ${action} without changing the checkout`, () => {
    const { work, other } = permissionFixture();
    const denied = join(other, "z denied", "existing");
    writeFileSync(join(other, "a writable", "existing"), "after\n");
    if (action === "modify") {
      writeFileSync(denied, "after\n");
    } else if (action === "delete") {
      rmSync(denied);
    } else if (action === "rename source") {
      sh(other, "git", "mv", "z denied/existing", "a writable/renamed");
    } else if (action === "rename destination") {
      sh(other, "git", "mv", "a writable/existing", "z denied/renamed");
    } else {
      mkdirSync(join(other, "z denied", "new\nfolder", "nested space"), { recursive: true });
      writeFileSync(join(other, "z denied", "new\nfolder", "nested space", "file\nname"), "new\n");
    }
    const sha = publishFixture(other);
    denyDirectory(join(work, "z denied"));
    expect(lstatSync(join(work, "z denied", "existing")).mode & 0o200).toBe(0o200);
    const before = checkoutSnapshot(work);
    const r = runScript(work, "--commit", sha, "--ff");
    expect(r.code).toBe(3);
    expect(r.out).toContain("not writable: " + join(work, "z denied"));
    expect(checkoutSnapshot(work)).toEqual(before);
  });
}

permissionTest(
  "writable affected parents allow read-only file replacement and ignore unrelated denial",
  () => {
    const { work, other } = permissionFixture();
    writeFileSync(join(other, "a writable", "existing"), "after\n");
    mkdirSync(join(other, "a writable", "new\nfolder"));
    writeFileSync(join(other, "a writable", "new\nfolder", "file space"), "new\n");
    const sha = publishFixture(other);
    chmodSync(join(work, "a writable", "existing"), 0o444);
    denyDirectory(join(work, "z denied"));
    writeFileSync(join(work, "notes"), "keep\n");
    const r = runScript(work, "--commit", sha, "--ff");
    expect(r.code).toBe(0);
    expect(sh(work, "git", "rev-parse", "HEAD")).toBe(sha);
    expect(readFileSync(join(work, "a writable", "existing"), "utf8")).toBe("after\n");
    expect(readFileSync(join(work, "a writable", "new\nfolder", "file space"), "utf8")).toBe(
      "new\n",
    );
    expect(readFileSync(join(work, "notes"), "utf8")).toBe("keep\n");
  },
);

test("writable deletion and rename paths advance to the exact target tree", () => {
  const { work, other } = permissionFixture();
  rmSync(join(other, "a writable", "existing"));
  sh(other, "git", "mv", "z denied/existing", "z denied/renamed\nfile");
  const sha = publishFixture(other);
  const r = runScript(work, "--commit", sha, "--ff");
  expect(r.code).toBe(0);
  expect(sh(work, "git", "rev-parse", "HEAD")).toBe(sha);
  expect(sh(work, "git", "status", "--porcelain")).toBe("");
  expect(existsSync(join(work, "a writable", "existing"))).toBe(false);
  expect(readFileSync(join(work, "z denied", "renamed\nfile"), "utf8")).toBe("before\n");
});

for (const type of ["symlink", "file to directory", "directory to file"]) {
  test(`unsupported ${type} transition is skipped before any writes`, () => {
    const { work, other } = permissionFixture();
    writeFileSync(join(other, "a writable", "existing"), "after\n");
    if (type === "directory to file") {
      rmSync(join(other, "z denied"), { recursive: true });
      writeFileSync(join(other, "z denied"), "replacement\n");
    } else {
      rmSync(join(other, "z denied", "existing"));
      if (type === "symlink") {
        symlinkSync("../a writable/existing", join(other, "z denied", "existing"));
      } else {
        mkdirSync(join(other, "z denied", "existing"));
        writeFileSync(join(other, "z denied", "existing", "nested"), "new\n");
      }
    }
    const sha = publishFixture(other);
    const before = checkoutSnapshot(work);
    const r = runScript(work, "--commit", sha, "--ff");
    expect(r.code).toBe(3);
    expect(r.out).toContain("cannot inspect");
    expect(checkoutSnapshot(work)).toEqual(before);
  });
}

for (const metadata of ["refs/heads"]) {
  permissionTest(
    `denied Git metadata directory ${metadata} is skipped before checkout changes`,
    () => {
      const { work, other } = permissionFixture();
      writeFileSync(join(other, "a writable", "existing"), "after\n");
      const sha = publishFixture(other);
      denyDirectory(join(work, ".git", metadata));
      const before = checkoutSnapshot(work);
      const r = runScript(work, "--commit", sha, "--ff");
      expect(r.code).toBe(3);
      expect(r.out).toContain("Git metadata");
      expect(r.out).toContain("not writable: " + join(work, ".git", metadata));
      expect(checkoutSnapshot(work)).toEqual(before);
    },
  );
}

for (const output of ["failure", "malformed", "truncated"]) {
  test(`diff ${output} fails closed without changing the checkout`, () => {
    const { work, sha } = behind({ onMain: true });
    const bin = join(dir(), "bin");
    mkdirSync(bin);
    const git = sh(work, "which", "git");
    writeFileSync(
      join(bin, "git"),
      `#!/bin/bash
case " $* " in *" diff --raw "*)
  case "$VERIFY_DIFF_OUTPUT" in
    failure) exit 1 ;;
    malformed) printf 'invalid\\0' ;;
    truncated) printf ':100644 100644 aaaaaaa bbbbbbb M\\0' ;;
  esac
  exit 0 ;;
esac
exec "${git}" "$@"
`,
      { mode: 0o755 },
    );
    const before = checkoutSnapshot(work);
    const run = Bun.spawnSync(["bash", script, "--commit", sha, "--ff"], {
      cwd: work,
      env: { ...env, PATH: bin + ":" + env.PATH, VERIFY_DIFF_OUTPUT: output },
    });
    expect(run.exitCode).toBe(3);
    expect(run.stdout.toString()).toContain("cannot inspect checkout changes");
    expect(checkoutSnapshot(work)).toEqual(before);
  });
}

permissionTest("an unsearchable addition ancestor is skipped without creating nested paths", () => {
  const { work, other } = permissionFixture();
  mkdirSync(join(work, "opaque"));
  mkdirSync(join(other, "opaque", "nested"), { recursive: true });
  writeFileSync(join(other, "opaque", "nested", "new"), "new\n");
  const sha = publishFixture(other);
  const before = checkoutSnapshot(work);
  chmodSync(join(work, "opaque"), 0o444);
  deniedDirectories.push(join(work, "opaque"));
  const index = readFileSync(join(work, ".git", "index"));
  const r = runScript(work, "--commit", sha, "--ff");
  expect(r.code).toBe(3);
  expect(r.out).toContain("not searchable: " + join(work, "opaque"));
  expect(sh(work, "git", "rev-parse", "HEAD")).toBe(before.head);
  expect(readFileSync(join(work, ".git", "index"))).toEqual(index);
  chmodSync(join(work, "opaque"), 0o755);
  expect(checkoutSnapshot(work)).toEqual(before);
});

permissionTest("a non-writable reflog is skipped before tree changes", () => {
  const { work, other } = permissionFixture();
  writeFileSync(join(other, "a writable", "existing"), "after\n");
  const sha = publishFixture(other);
  chmodSync(join(work, ".git", "logs", "HEAD"), 0o444);
  const before = checkoutSnapshot(work);
  const r = runScript(work, "--commit", sha, "--ff");
  expect(r.code).toBe(3);
  expect(r.out).toContain("Git metadata not writable: logs/HEAD");
  expect(checkoutSnapshot(work)).toEqual(before);
});

permissionTest(
  "an existing writable reflog needs search but no creation access in its parent",
  () => {
    const { work, other } = permissionFixture();
    writeFileSync(join(other, "a writable", "existing"), "after\n");
    const sha = publishFixture(other);
    denyDirectory(join(work, ".git", "logs", "refs", "heads"));
    const r = runScript(work, "--commit", sha, "--ff");
    expect(r.code).toBe(0);
    expect(sh(work, "git", "rev-parse", "HEAD")).toBe(sha);
  },
);

test("an existing ref lock prevents checkout changes", () => {
  const { work, other } = permissionFixture();
  writeFileSync(join(other, "a writable", "existing"), "after\n");
  const sha = publishFixture(other);
  writeFileSync(join(work, ".git", "refs", "heads", "main.lock"), "other operation\n");
  const before = checkoutSnapshot(work);
  const r = runScript(work, "--commit", sha, "--ff");
  expect(r.code).toBe(3);
  expect(r.out).toContain("Git metadata lock exists: refs/heads/main.lock");
  expect(checkoutSnapshot(work)).toEqual(before);
});

test("a symlink ancestor is skipped without writing through it", () => {
  const { root, work, other } = permissionFixture();
  const outside = join(root, "outside");
  mkdirSync(outside);
  writeFileSync(join(outside, "keep"), "outside\n");
  symlinkSync(outside, join(work, "linked"));
  mkdirSync(join(other, "linked"));
  writeFileSync(join(other, "linked", "added"), "new\n");
  const sha = publishFixture(other);
  const before = checkoutSnapshot(work);
  const r = runScript(work, "--commit", sha, "--ff");
  expect(r.code).toBe(3);
  expect(r.out).toContain("cannot inspect symlink directory");
  expect(checkoutSnapshot(work)).toEqual(before);
  expect(readdirSync(outside)).toEqual(["keep"]);
});

test("gitlink changes are skipped before any checkout writes", () => {
  const { work, other } = permissionFixture();
  writeFileSync(join(other, "a writable", "existing"), "after\n");
  sh(other, "git", "add", "-A");
  sh(
    other,
    "git",
    "update-index",
    "--add",
    "--cacheinfo",
    "160000," + sh(other, "git", "rev-parse", "HEAD") + ",submodule",
  );
  sh(other, "git", "commit", "-m", "gitlink");
  sh(other, "git", "push", "origin", "main");
  const sha = sh(other, "git", "rev-parse", "HEAD");
  const before = checkoutSnapshot(work);
  const r = runScript(work, "--commit", sha, "--ff");
  expect(r.code).toBe(3);
  expect(r.out).toContain("cannot inspect checkout path type: submodule");
  expect(checkoutSnapshot(work)).toEqual(before);
});

test("a writable regular file mode change reaches the exact target", () => {
  const { work, other } = permissionFixture();
  chmodSync(join(other, "a writable", "existing"), 0o755);
  const sha = publishFixture(other);
  const r = runScript(work, "--commit", sha, "--ff");
  expect(r.code).toBe(0);
  expect(sh(work, "git", "rev-parse", "HEAD")).toBe(sha);
  expect(lstatSync(join(work, "a writable", "existing")).mode & 0o111).toBe(0o111);
});

test("diff config cannot hide a changed gitlink from the preflight", () => {
  const { work, other } = permissionFixture();
  sh(
    work,
    "git",
    "update-index",
    "--add",
    "--cacheinfo",
    "160000," + sh(work, "git", "rev-parse", "HEAD") + ",submodule",
  );
  sh(work, "git", "commit", "-m", "base gitlink");
  sh(work, "git", "push", "origin", "main");
  sh(other, "git", "fetch", "origin");
  sh(other, "git", "merge", "--ff-only", "origin/main");
  writeFileSync(join(other, "a writable", "existing"), "after\n");
  sh(other, "git", "add", "a writable/existing");
  sh(
    other,
    "git",
    "update-index",
    "--cacheinfo",
    "160000," + sh(other, "git", "rev-parse", "HEAD") + ",submodule",
  );
  sh(other, "git", "commit", "-m", "changed gitlink");
  sh(other, "git", "push", "origin", "main");
  const sha = sh(other, "git", "rev-parse", "HEAD");
  sh(work, "git", "config", "diff.ignoreSubmodules", "all");
  const before = checkoutSnapshot(work);
  const r = runScript(work, "--commit", sha, "--ff");
  expect(r.code).toBe(3);
  expect(r.out).toContain("cannot inspect checkout path type: submodule");
  expect(checkoutSnapshot(work)).toEqual(before);
});
