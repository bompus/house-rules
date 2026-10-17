import { afterEach, expect, test as base } from "bun:test";

// These drive bash scripts and POSIX git behavior.
const test = process.platform === "win32" ? base.skip : base;
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = new URL("../scripts/merge-pr.sh", import.meta.url).pathname;
const roots = [];
const residents = [];
// A live process whose working directory is in `cwd`, as an agent session in a primary checkout is.
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
  queued = false,
  history = 0,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "merge-pr-"));
  roots.push(root);
  const remote = join(root, "remote.git");
  sh(root, "git", "-c", "init.defaultBranch=main", "init", "--bare", remote);
  const work = join(root, "work");
  sh(root, "git", "clone", remote, work);
  sh(work, "git", "commit", "--allow-empty", "-m", "base");
  for (let n = 0; n < history; n++) {
    sh(work, "git", "commit", "--allow-empty", "-m", `history ${n}`);
  }
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
  *mergeCommit*) echo "${queued ? "" : squash}";;
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

test("a merge still queued has no merge commit and keeps the remote head", () => {
  const { remote, run } = fixture({ queued: true });
  const r = run();
  expect(r.code).toBe(1);
  expect(r.err).toContain("no merge commit yet");
  expect(sh(remote, "git", "branch", "--list", "feature")).not.toBe("");
});

test("a same-named branch at another commit is not deleted", () => {
  const { remote, wt, run } = fixture();
  sh(wt, "git", "commit", "--allow-empty", "-m", "unrelated work");
  sh(wt, "git", "push", "origin", "feature");
  const r = run();
  // The final verification reports the surviving remote branch, so the run exits 1.
  expect(r.err).toContain("kept: origin/feature is at");
  expect(sh(remote, "git", "branch", "--list", "feature")).not.toBe("");
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

test("landing from a task fast-forwards the primary with no flag, even with a session running in it", () => {
  const { work, wt, oid, squash, remote, run } = fixture({ staleDefault: true, fromTask: true });
  resident(work);
  const r = run();
  expect(r.err).toBe("");
  expect(r.code).toBe(0);
  expect(sh(work, "git", "rev-parse", "HEAD")).toBe(squash);
  expect(sh(wt, "git", "rev-parse", "HEAD")).toBe(oid);
  expect(sh(remote, "git", "branch", "--list", "feature")).toBe("");
});

test("landing from a task with a current primary merges without asking about the primary", () => {
  const { work, log, squash, run } = fixture({ fromTask: true });
  const r = run();
  expect(r.code).toBe(0);
  expect(readFileSync(log, "utf8")).toContain("pr merge 7");
  expect(sh(work, "git", "rev-parse", "HEAD")).toBe(squash);
});

test("landing from a clean primary fast-forwards it without an additional command", () => {
  const { work, squash, run } = fixture({ staleDefault: true });
  const r = run();
  expect(r.code).toBe(0);
  expect(sh(work, "git", "rev-parse", "HEAD")).toBe(squash);
});

// The remote merge always completes; a primary that cannot be fast-forwarded is skipped with exit 3.
function expectLandedSyncPending(fx, r, reason) {
  const { remote, work, log, wt } = fx;
  expect(readFileSync(log, "utf8")).toContain("pr merge 7");
  expect(sh(remote, "git", "branch", "--list", "feature")).toBe("");
  expect(r.code).toBe(3);
  expect(r.out).toContain(`sync skipped at ${work}: ${reason}`);
  expect(r.out).toContain("landed; local sync pending");
  expect(r.out).toContain(`still on feature: ${wt}`);
}

test("a primary with staged changes does not block the merge: it is skipped, untouched, with exit 3", () => {
  const fx = fixture({ staleDefault: true, fromTask: true });
  writeFileSync(join(fx.work, "notes.txt"), "ongoing work\n");
  sh(fx.work, "git", "add", "notes.txt");
  const before = sh(fx.work, "git", "rev-parse", "HEAD");
  const r = fx.run();
  expectLandedSyncPending(fx, r, "working tree dirty");
  expect(sh(fx.work, "git", "rev-parse", "HEAD")).toBe(before);
  expect(sh(fx.work, "git", "status", "--porcelain")).toBe("A  notes.txt");
});

test("an untracked file in the primary does not block the merge or the fast-forward", () => {
  const { work, squash, run } = fixture({ staleDefault: true, fromTask: true });
  writeFileSync(join(work, "notes.txt"), "scratch\n");
  const r = run();
  expect(r.code).toBe(0);
  expect(sh(work, "git", "rev-parse", "HEAD")).toBe(squash);
  expect(sh(work, "git", "status", "--porcelain")).toBe("?? notes.txt");
});

test("a failed primary status check is skipped, not assumed clean", () => {
  const fx = fixture({ staleDefault: true, fromTask: true });
  writeFileSync(join(fx.work, ".git", "index"), "corrupt index\n");
  const before = sh(fx.work, "git", "rev-parse", "HEAD");
  const r = fx.run();
  expectLandedSyncPending(fx, r, "cannot inspect working tree");
  expect(sh(fx.work, "git", "rev-parse", "HEAD")).toBe(before);
});

test("a diverged primary does not block the merge: it is skipped, untouched, with exit 3", () => {
  const fx = fixture({ staleDefault: true, fromTask: true });
  sh(fx.work, "git", "commit", "--allow-empty", "-m", "local work");
  const before = sh(fx.work, "git", "rev-parse", "HEAD");
  const r = fx.run();
  expectLandedSyncPending(fx, r, "diverged from origin/main");
  expect(sh(fx.work, "git", "rev-parse", "HEAD")).toBe(before);
});

test("a primary on another branch is not switched or edited; the default ref moves", () => {
  const { work, wt, squash, run } = fixture({ staleDefault: true, fromTask: true });
  sh(work, "git", "switch", "-c", "other");
  writeFileSync(join(work, "notes.txt"), "ongoing work\n");
  const r = run();
  expect(r.code).toBe(0);
  expect(sh(work, "git", "branch", "--show-current")).toBe("other");
  expect(sh(work, "git", "rev-parse", "main")).toBe(squash);
  expect(sh(work, "git", "status", "--porcelain")).toBe("?? notes.txt");
  expect(existsSync(wt)).toBe(true);
});

test("an unfinished merge in the primary is skipped even when status reports a clean tree", () => {
  const fx = fixture({ staleDefault: true, fromTask: true });
  sh(fx.work, "git", "merge", "--no-commit", "--no-ff", "feature");
  expect(sh(fx.work, "git", "status", "--porcelain")).toBe("");
  const before = sh(fx.work, "git", "rev-parse", "HEAD");
  const r = fx.run();
  expectLandedSyncPending(fx, r, "unfinished Git operation: MERGE_HEAD");
  expect(sh(fx.work, "git", "rev-parse", "HEAD")).toBe(before);
  expect(existsSync(join(fx.work, ".git", "MERGE_HEAD"))).toBe(true);
});

test("a primary paused in a rebase of the default is skipped while HEAD is detached", () => {
  const fx = fixture({ staleDefault: true, fromTask: true, history: 2 });
  const rebase = Bun.spawnSync(["git", "rebase", "--force-rebase", "--exec", "false", "HEAD~1"], {
    cwd: fx.work,
    env: { ...process.env, ...gitEnv },
  });
  expect(rebase.exitCode).toBe(1);
  expect(sh(fx.work, "git", "branch", "--show-current")).toBe("");
  expect(sh(fx.work, "git", "status", "--porcelain")).toBe("");
  const before = sh(fx.work, "git", "rev-parse", "HEAD");
  const r = fx.run();
  expectLandedSyncPending(fx, r, "unfinished Git operation: rebase-merge");
  expect(sh(fx.work, "git", "rev-parse", "HEAD")).toBe(before);
});

test("a bisect of the default in the primary is skipped while HEAD is detached", () => {
  const fx = fixture({ staleDefault: true, fromTask: true, history: 3 });
  sh(
    fx.work,
    "git",
    "bisect",
    "start",
    "HEAD",
    sh(fx.work, "git", "rev-list", "--max-parents=0", "HEAD"),
  );
  expect(sh(fx.work, "git", "branch", "--show-current")).toBe("");
  const before = sh(fx.work, "git", "rev-parse", "HEAD");
  const r = fx.run();
  expectLandedSyncPending(fx, r, "unfinished Git operation: BISECT_START");
  expect(sh(fx.work, "git", "rev-parse", "HEAD")).toBe(before);
});

test("deprecated --idle-primary without a path does not swallow --merge", () => {
  const { log, run } = fixture({ staleDefault: true, fromTask: true });
  const r = run("--idle-primary", "--merge");
  expect(r.err).toContain("--idle-primary is ignored");
  expect(readFileSync(log, "utf8")).toMatch(/pr merge 7.*--merge/);
});

test("deprecated --idle-primary is accepted and ignored, even for a path that is not the primary", () => {
  const { work, wt, log, squash, run } = fixture({ staleDefault: true, fromTask: true });
  const r = run("--idle-primary", wt);
  expect(r.code).toBe(0);
  expect(r.err).toContain("--idle-primary is ignored");
  expect(readFileSync(log, "utf8")).toContain("pr merge 7");
  expect(sh(work, "git", "rev-parse", "HEAD")).toBe(squash);
});
