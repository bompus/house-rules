import { afterEach, expect, test as base } from "bun:test";

// These drive bash scripts and POSIX git behavior.
const test = process.platform === "win32" ? base.skip : base;
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = new URL("../scripts/merge-pr.sh", import.meta.url).pathname;
const roots = [];
afterEach(() => {
  for (const path of roots.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

const gitEnv = {
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@example.com",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
};

function sh(cwd, ...args) {
  const run = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv } });
  if (run.exitCode !== 0) {
    throw new Error(args.join(" ") + " failed: " + run.stderr.toString().slice(0, 500));
  }
  return run.stdout.toString().trim();
}

// A pushed `feature` head checked out in a linked worktree, and a squash commit already on main
// standing in for the one GitHub makes; gh is a stub that answers from env and logs its calls.
function fixture({
  dependents = "",
  threads = [],
  repo = "owner/app",
  staleDefault = false,
  fromTask = false,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "merge-pr-"));
  roots.push(root);
  const remote = join(root, "remote.git");
  sh(root, "git", "-c", "init.defaultBranch=main", "init", "--bare", remote);
  const work = join(root, "work");
  sh(root, "git", "clone", remote, work);
  sh(work, "git", "commit", "--allow-empty", "-m", "base");
  sh(work, "git", "push", "origin", "main");
  const wt = join(root, "feature-wt");
  sh(work, "git", "worktree", "add", "-b", "feature", wt);
  sh(wt, "git", "commit", "--allow-empty", "-m", "work");
  sh(wt, "git", "push", "origin", "feature");
  const oid = sh(wt, "git", "rev-parse", "HEAD");
  const writer = staleDefault ? join(root, "writer") : work;
  if (staleDefault) {
    sh(root, "git", "clone", remote, writer);
  }
  sh(writer, "git", "commit", "--allow-empty", "-m", "squash");
  sh(writer, "git", "push", "origin", "main");
  const squash = sh(writer, "git", "rev-parse", "HEAD");
  const log = join(root, "gh.log");
  const bin = join(root, "bin");
  sh(root, "mkdir", bin);
  writeFileSync(
    join(bin, "gh"),
    `#!/usr/bin/env bash
echo "$*" >> "${log}"
case "$*" in
  *mergeCommit*) echo "${squash}";;
  "pr view"*) printf 'feature\\t${oid}\\tmain\\tOPEN\\tfalse\\n';;
  "pr list"*) printf '%s' "${dependents}";;
  "repo view"*) echo "${repo}";;
  "api graphql"*) printf '%s' '${JSON.stringify({ data: { viewer: { __typename: "User", login: "maintainer" }, repository: { viewerPermission: "ADMIN", pullRequest: { headRefOid: oid, reviewThreads: { nodes: threads, pageInfo: { hasNextPage: false, endCursor: null } }, reviews: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } }, comments: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } }, commits: { nodes: [{ commit: { oid, tree: { entries: [] }, statusCheckRollup: null } }] } } } } })}';;
esac
`,
  );
  chmodSync(join(bin, "gh"), 0o755);
  const run = (...args) => {
    const r = Bun.spawnSync(["bash", script, "7", ...args], {
      cwd: fromTask ? wt : work,
      env: {
        ...process.env,
        ...gitEnv,
        HR_PUSH_LANDED: "bompus/house-rules",
        PATH: `${bin}:${process.env.PATH}`,
      },
    });
    return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
  };
  return { remote, work, wt, oid, squash, log, run };
}

test("merges without --delete-branch, deletes only the remote head and names the worktree", () => {
  const { remote, wt, oid, log, run } = fixture();
  const r = run();
  expect(r.err).toBe("");
  expect(r.code).toBe(0);
  const calls = readFileSync(log, "utf8");
  expect(calls).toContain(`pr merge 7 --squash --match-head-commit ${oid}`);
  expect(calls).not.toContain("--delete-branch");
  expect(sh(remote, "git", "branch", "--list", "feature")).toBe("");
  expect(existsSync(wt)).toBe(true);
  expect(r.out).toContain(`still on feature: ${wt}`);
});

test("--merge lands with a merge commit instead of a squash", () => {
  const { oid, log, run } = fixture();
  const r = run("--merge");
  expect(r.err).toBe("");
  expect(r.code).toBe(0);
  const calls = readFileSync(log, "utf8");
  expect(calls).toContain(`pr merge 7 --merge --match-head-commit ${oid}`);
  expect(calls).not.toContain("--squash");
});

test("refuses while another open PR targets the head", () => {
  const { remote, log, run } = fixture({ dependents: "8\n" });
  const r = run();
  expect(r.code).toBe(1);
  expect(r.err).toContain("open PRs target feature: 8");
  expect(readFileSync(log, "utf8")).not.toContain("pr merge");
  expect(sh(remote, "git", "branch", "--list", "feature")).toContain("feature");
});

test("refuses while review feedback is open", () => {
  const thread = { isResolved: false, comments: { nodes: [{ url: "https://example.test/t1" }] } };
  const { remote, log, run } = fixture({ threads: [thread] });
  const r = run();
  expect(r.code).toBe(1);
  expect(r.err).toContain("unresolved thread: https://example.test/t1");
  expect(readFileSync(log, "utf8")).not.toContain("pr merge");
  expect(sh(remote, "git", "branch", "--list", "feature")).toContain("feature");
});

test("refuses a repository that lands by fast-forward push and prints the push", () => {
  const { remote, log, run } = fixture({ repo: "bompus/house-rules" });
  const r = run();
  expect(r.code).toBe(1);
  expect(r.err).toContain("git push origin feature:main && git push origin --delete feature");
  expect(readFileSync(log, "utf8")).not.toContain("pr merge");
  expect(sh(remote, "git", "branch", "--list", "feature")).toContain("feature");
});

test("landing from a task updates the confirmed idle primary without moving the task", () => {
  const { work, wt, oid, squash, run } = fixture({ staleDefault: true, fromTask: true });
  const r = run("--idle-primary", work);
  expect(r.code).toBe(0);
  expect(sh(work, "git", "rev-parse", "HEAD")).toBe(squash);
  expect(sh(wt, "git", "rev-parse", "HEAD")).toBe(oid);
});

for (const staleDefault of [false, true]) {
  test(`task merge requires primary ownership before merging (stale=${staleDefault})`, () => {
    const { remote, work, log, run } = fixture({ staleDefault, fromTask: true });
    const before = sh(work, "git", "rev-parse", "HEAD");
    const r = run();
    expect(r.code).toBe(1);
    expect(readFileSync(log, "utf8")).not.toContain("pr merge");
    expect(r.err).toContain("If nothing is using it, rerun with --idle-primary <primary-path>");
    expect(sh(work, "git", "rev-parse", "HEAD")).toBe(before);
    expect(sh(remote, "git", "branch", "--list", "feature")).toContain("feature");
  });
}

test("a dirty confirmed primary blocks the merge before any remote change", () => {
  const { remote, work, log, run } = fixture({ staleDefault: true, fromTask: true });
  writeFileSync(join(work, "notes.txt"), "ongoing work\n");
  const before = sh(work, "git", "rev-parse", "HEAD");
  const r = run("--idle-primary", work);
  expect(r.code).toBe(1);
  expect(r.err).toContain("working tree dirty");
  expect(readFileSync(log, "utf8")).not.toContain("pr merge");
  expect(sh(work, "git", "rev-parse", "HEAD")).toBe(before);
  expect(sh(work, "git", "status", "--porcelain")).toBe("?? notes.txt");
  expect(sh(remote, "git", "branch", "--list", "feature")).toContain("feature");
});

test("an invalid primary path is rejected before merging", () => {
  const { remote, work, wt, log, run } = fixture({ fromTask: true });
  const before = sh(work, "git", "rev-parse", "HEAD");
  const r = run("--idle-primary", wt);
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("not this repository's primary checkout");
  expect(readFileSync(log, "utf8")).not.toContain("pr merge");
  expect(sh(work, "git", "rev-parse", "HEAD")).toBe(before);
  expect(sh(remote, "git", "branch", "--list", "feature")).toContain("feature");
});

test("a failed primary status check blocks the merge instead of assuming a clean tree", () => {
  const { remote, work, log, run } = fixture({ staleDefault: true, fromTask: true });
  writeFileSync(join(work, ".git", "index"), "corrupt index\n");
  const before = sh(work, "git", "rev-parse", "HEAD");
  const r = run("--idle-primary", work);
  expect(r.code).toBe(1);
  expect(r.err).toContain("cannot inspect working tree");
  expect(readFileSync(log, "utf8")).not.toContain("pr merge");
  expect(sh(work, "git", "rev-parse", "HEAD")).toBe(before);
  expect(sh(remote, "git", "branch", "--list", "feature")).toContain("feature");
});

test("a diverged primary blocks the merge before deleting the remote head", () => {
  const { remote, work, log, run } = fixture({ staleDefault: true, fromTask: true });
  sh(work, "git", "commit", "--allow-empty", "-m", "local work");
  const before = sh(work, "git", "rev-parse", "HEAD");
  const r = run("--idle-primary", work);
  expect(r.code).toBe(1);
  expect(r.err).toContain("cannot fast-forward");
  expect(readFileSync(log, "utf8")).not.toContain("pr merge");
  expect(sh(work, "git", "rev-parse", "HEAD")).toBe(before);
  expect(sh(remote, "git", "branch", "--list", "feature")).toContain("feature");
});

test("an unfinished merge blocks landing even when status reports a clean tree", () => {
  const { remote, work, log, run } = fixture({ staleDefault: true, fromTask: true });
  sh(work, "git", "merge", "--no-commit", "--no-ff", "feature");
  expect(sh(work, "git", "status", "--porcelain")).toBe("");
  expect(existsSync(join(work, ".git", "MERGE_HEAD"))).toBe(true);
  const before = sh(work, "git", "rev-parse", "HEAD");
  const r = run("--idle-primary", work);
  expect(readFileSync(log, "utf8")).not.toContain("pr merge");
  expect(r.code).toBe(1);
  expect(r.err).toContain("unfinished Git operation: MERGE_HEAD");
  expect(sh(work, "git", "rev-parse", "HEAD")).toBe(before);
  expect(existsSync(join(work, ".git", "MERGE_HEAD"))).toBe(true);
  expect(sh(remote, "git", "branch", "--list", "feature")).toContain("feature");
});

test("landing from a clean primary fast-forwards it without an additional command", () => {
  const { work, squash, run } = fixture({ staleDefault: true });
  const r = run();
  expect(r.code).toBe(0);
  expect(sh(work, "git", "rev-parse", "HEAD")).toBe(squash);
});

test("a paused rebase of the default blocks landing while HEAD is detached and status is clean", () => {
  const { remote, work, log, run } = fixture({ fromTask: true });
  const rebase = Bun.spawnSync(["git", "rebase", "--force-rebase", "--exec", "false", "HEAD~1"], {
    cwd: work,
    env: { ...process.env, ...gitEnv },
  });
  expect(rebase.exitCode).toBe(1);
  expect(sh(work, "git", "branch", "--show-current")).toBe("");
  expect(sh(work, "git", "status", "--porcelain")).toBe("");
  const before = sh(work, "git", "rev-parse", "HEAD");
  const r = run("--idle-primary", work);
  expect(readFileSync(log, "utf8")).not.toContain("pr merge");
  expect(r.code).toBe(1);
  expect(r.err).toContain("unfinished Git operation: rebase-merge");
  expect(sh(work, "git", "rev-parse", "HEAD")).toBe(before);
  expect(sh(remote, "git", "branch", "--list", "feature")).toContain("feature");
});

test("a bisect of the default blocks landing while HEAD is detached", () => {
  const { remote, work, log, run } = fixture({ fromTask: true });
  sh(work, "git", "commit", "--allow-empty", "-m", "bisect history");
  sh(work, "git", "push", "origin", "main");
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
  const r = run("--idle-primary", work);
  expect(readFileSync(log, "utf8")).not.toContain("pr merge");
  expect(r.code).toBe(1);
  expect(r.err).toContain("unfinished Git operation: BISECT_START");
  expect(sh(work, "git", "rev-parse", "HEAD")).toBe(before);
  expect(sh(remote, "git", "branch", "--list", "feature")).toContain("feature");
});
