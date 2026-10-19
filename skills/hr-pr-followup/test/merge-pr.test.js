import { afterEach, expect, test as base } from "bun:test";

// These drive bash scripts and POSIX git behavior.
const test = process.platform === "win32" ? base.skip : base;
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const script = new URL("../scripts/merge-pr.sh", import.meta.url).pathname;
/** @type {string[]} */
const roots = [];
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

const gitEnv = {
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@example.com",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
};

/**
 * @param {string} cwd
 * @param {...string} args
 */
function sh(cwd, ...args) {
  const run = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv } });
  if (run.exitCode !== 0) {
    throw new Error(args.join(" ") + " failed: " + run.stderr.toString().slice(0, 500));
  }
  return run.stdout.toString().trim();
}

/**
 * Writes an executable stub script named `name` into `bin`.
 * @param {string} bin
 * @param {string} name
 * @param {string} body
 */
function stub(bin, name, body) {
  writeFileSync(join(bin, name), `#!/usr/bin/env bash\n${body}`);
  chmodSync(join(bin, name), 0o755);
}

// A pushed `feature` head checked out in a linked worktree, and a squash commit already on main
// standing in for the one GitHub makes; gh is a stub that answers from env and logs its calls.
/**
 * @param {{ dependents?: string, threads?: object[], repo?: string, staleDefault?: boolean,
 *   fromTask?: boolean, queued?: boolean, history?: number, check?: string | null,
 *   packageJson?: string | null, pnpmInstallExit?: number, files?: Record<string, string>,
 *   racingFetch?: boolean, baseCurrent?: boolean, errexitOff?: boolean, advanceHead?: boolean }} [options]
 */
function fixture({
  dependents = "",
  threads = [],
  repo = "owner/app",
  staleDefault = false,
  fromTask = false,
  queued = false,
  history = 0,
  // The head's package.json check script; null leaves package.json out of the head.
  check = "exit 0",
  // Raw package.json text for the head, in place of the one built from `check`.
  packageJson = null,
  // Exit status of the stub pnpm's install; its `run check` always passes.
  pnpmInstallExit = 0,
  // More files to commit in the head, by name.
  files = {},
  // Another fetch in the checkout rewrites FETCH_HEAD right after this script fetches the head.
  racingFetch = false,
  // Leaves main at the head's parent, as a repository that lands by fast-forward push needs.
  baseCurrent = false,
  // Runs a copy of the scripts with `set -euo pipefail` removed, as a shell that ignores it would.
  errexitOff = false,
  // Someone pushes to the head branch after the checks pass, just before the landing push.
  advanceHead = false,
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
  if (check !== null || packageJson !== null) {
    writeFileSync(
      join(wt, "package.json"),
      packageJson ?? JSON.stringify({ name: "app", packageManager: "bun@1", scripts: { check } }),
    );
    sh(wt, "git", "add", "package.json");
  }
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(wt, name), text);
    sh(wt, "git", "add", name);
  }
  sh(wt, "git", "commit", "--allow-empty", "-m", "work");
  sh(wt, "git", "push", "origin", "feature", "feature:refs/pull/7/head");
  const oid = sh(wt, "git", "rev-parse", "HEAD");
  const writer = staleDefault ? join(root, "writer") : work;
  if (staleDefault) {
    sh(root, "git", "clone", remote, writer);
  }
  if (!baseCurrent) {
    sh(writer, "git", "commit", "--allow-empty", "-m", "squash");
    sh(writer, "git", "push", "origin", "main");
  }
  const squash = sh(writer, "git", "rev-parse", "HEAD");
  const log = join(root, "gh.log");
  const bin = join(root, "bin");
  sh(root, "mkdir", bin);
  stub(
    bin,
    "gh",
    `echo "$*" >> "${log}"
case "$*" in
  *mergeCommit*) echo "${queued ? "" : squash}";;
  "pr view"*) printf 'feature\\t${oid}\\tmain\\tOPEN\\tfalse\\n';;
  "pr list"*) printf '%s' "${dependents}";;
  "repo view"*) echo "${repo}";;
  "api graphql"*) printf '%s' '${JSON.stringify({ data: { viewer: { __typename: "User", login: "maintainer" }, repository: { viewerPermission: "ADMIN", pullRequest: { headRefOid: oid, reviewThreads: { nodes: threads, pageInfo: { hasNextPage: false, endCursor: null } }, reviews: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } }, comments: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } }, commits: { nodes: [{ commit: { oid, tree: { entries: [] }, statusCheckRollup: null } }] } } } } })}';;
esac
`,
  );
  const pmLog = join(root, "pnpm.log");
  stub(
    bin,
    "pnpm",
    `echo "$*" >> "${pmLog}"\n[ "$1" = install ] && exit ${pnpmInstallExit}\nexit 0\n`,
  );
  stub(bin, "npm", `echo "$*" >> "${pmLog}"\n`);
  stub(bin, "yarn", `echo "$*" >> "${pmLog}"\n`);
  if (advanceHead) {
    const git = Bun.which("git");
    const remoteGit = `"${git}" --git-dir="${remote}"`;
    stub(
      bin,
      "git",
      `"${git}" "$@"; code=$?
case "$*" in *"merge-base --is-ancestor"*)
  next=$(${remoteGit} commit-tree -p ${oid} -m later "${oid}^{tree}")
  ${remoteGit} update-ref refs/heads/feature "$next"
  ${remoteGit} update-ref refs/pull/7/head "$next";;
esac
exit $code
`,
    );
  }
  if (racingFetch) {
    const git = Bun.which("git");
    const base = sh(work, "git", "rev-parse", "main~1");
    const fetchHead = `"$("${git}" rev-parse --git-dir)/FETCH_HEAD"`;
    stub(
      bin,
      "git",
      `"${git}" "$@"; code=$?
case "$*" in *refs/pull/*) printf '%s\\t\\tbranch main of other\\n' "${base}" > ${fetchHead};; esac
exit $code
`,
    );
  }
  let target = script;
  if (errexitOff) {
    const copy = join(root, "scripts");
    cpSync(dirname(script), copy, { recursive: true });
    target = join(copy, "merge-pr.sh");
    const text = readFileSync(target, "utf8");
    if (!text.includes("set -euo pipefail\n")) {
      throw new Error("merge-pr.sh no longer sets -euo pipefail; update this fixture");
    }
    writeFileSync(target, text.replace("set -euo pipefail\n", ""));
  }
  /**
   * @param {string} pr
   * @param {...string} args
   */
  const runTarget = (pr, ...args) => {
    const r = Bun.spawnSync(["bash", target, pr, ...args], {
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
  /** @param {...string} args */
  const run = (...args) => runTarget(`${repo}#7`, ...args);
  return { remote, work, wt, oid, squash, log, pmLog, run, runTarget };
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

test("a repository that lands by fast-forward push gets its checked head pushed to the base", () => {
  const { remote, oid, log, run } = fixture({ repo: "bompus/house-rules", baseCurrent: true });
  const r = run();
  expect(r.err).toBe("");
  expect(r.code).toBe(0);
  expect(r.out).toContain(`landed: PR 7 as ${oid} by fast-forward push to main`);
  expect(sh(remote, "git", "rev-parse", "main")).toBe(oid);
  expect(sh(remote, "git", "branch", "--list", "feature")).toBe("");
  expect(readFileSync(log, "utf8")).not.toContain("pr merge");
});

test("a fast-forward landing refuses when the base moved past the head's parent", () => {
  const { remote, squash, log, run } = fixture({ repo: "bompus/house-rules" });
  const r = run();
  expect(r.code).toBe(1);
  expect(r.err).toContain("main is not an ancestor of");
  expect(sh(remote, "git", "rev-parse", "main")).toBe(squash);
  expect(sh(remote, "git", "branch", "--list", "feature")).toContain("feature");
  expect(readFileSync(log, "utf8")).not.toContain("pr merge");
});

test("a fast-forward landing refuses when the head moved after the checks", () => {
  const fx = fixture({ repo: "bompus/house-rules", baseCurrent: true, advanceHead: true });
  const before = sh(fx.remote, "git", "rev-parse", "main");
  const r = fx.run();
  expect(r.code).toBe(1);
  expect(r.err).toContain("fast-forward push of");
  expect(sh(fx.remote, "git", "rev-parse", "main")).toBe(before);
  expect(sh(fx.remote, "git", "rev-parse", "feature")).not.toBe(fx.oid);
});

// A shell that does not stop on a failing command must not carry a refusal into a merge or push.
for (const repo of ["bompus/house-rules", "owner/app"]) {
  test(`with set -e removed, a review refusal still stops ${repo} before any merge or push`, () => {
    const thread = { isResolved: false, comments: { nodes: [{ url: "https://example.test/t1" }] } };
    const fx = fixture({ repo, threads: [thread], baseCurrent: true, errexitOff: true });
    const before = sh(fx.remote, "git", "rev-parse", "main");
    const r = fx.run();
    expect(r.code).toBe(1);
    expect(r.err).toContain("refused: review feedback is open");
    expect(readFileSync(fx.log, "utf8")).not.toContain("pr merge");
    expect(sh(fx.remote, "git", "rev-parse", "main")).toBe(before);
    expect(sh(fx.remote, "git", "branch", "--list", "feature")).toContain("feature");
  });
}

// gh resolves a bare number against the current directory's repository, so the same number in
// another repository would be merged. The pull request must name its repository, and the current
// directory must be a checkout of it.
test("a bare pull request number is refused before gh is asked about any pull request", () => {
  const { log, runTarget } = fixture();
  const r = runTarget("7");
  expect(r.code).toBe(2);
  expect(r.err).toContain("owner/repo#7");
  expect(existsSync(log)).toBe(false);
});

test("a pull request of another repository is refused from this checkout", () => {
  const { log, remote, runTarget } = fixture({ repo: "bompus/house-rules" });
  const before = sh(remote, "git", "rev-parse", "main");
  const r = runTarget("owner/other#7");
  expect(r.code).toBe(1);
  expect(r.err).toContain("run this from a checkout of owner/other");
  expect(readFileSync(log, "utf8")).not.toContain("pr ");
  expect(sh(remote, "git", "rev-parse", "main")).toBe(before);
});

test("the URL form and --repo name the repository, and every gh pr call carries it", () => {
  const byUrl = fixture();
  const r = byUrl.runTarget("https://github.com/owner/app/pull/7");
  expect(r.err).toBe("");
  expect(r.code).toBe(0);
  const calls = readFileSync(byUrl.log, "utf8")
    .split("\n")
    .filter((line) => line.startsWith("pr "));
  expect(calls.length).toBeGreaterThan(2);
  for (const line of calls) {
    expect(line).toContain("--repo owner/app");
  }
  const byFlag = fixture();
  expect(byFlag.runTarget("7", "--repo", "Owner/App").code).toBe(0);
  const mixed = fixture();
  const conflict = mixed.runTarget("owner/app#7", "--repo", "owner/other");
  expect(conflict.code).toBe(2);
  expect(existsSync(mixed.log)).toBe(false);
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
/**
 * @param {ReturnType<typeof fixture>} fx
 * @param {ReturnType<ReturnType<typeof fixture>["run"]>} r
 * @param {string} reason
 */
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
  // An empty head commit, so the paused merge leaves nothing staged.
  const fx = fixture({ staleDefault: true, fromTask: true, check: null });
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

test("the removed --idle-primary flag is an unknown argument and merges nothing", () => {
  const { log, run } = fixture({ staleDefault: true, fromTask: true });
  const r = run("--idle-primary", "/nonexistent");
  expect(r.code).toBe(2);
  expect(r.err).toContain("unknown argument: --idle-primary");
  expect(existsSync(log) ? readFileSync(log, "utf8") : "").not.toContain("pr merge");
});

// The scratch worktree the check ran in, if one is still registered.
/** @param {string} work */
const checkWorktrees = (work) =>
  sh(work, "git", "worktree", "list", "--porcelain")
    .split("\n")
    .filter((line) => line.includes("hr-merge-check"));

test("a passing check at the head merges and removes its scratch worktree", () => {
  const { work, log, oid, run } = fixture({ check: "echo checked-at-head" });
  const r = run();
  expect(r.code).toBe(0);
  expect(r.out).toContain("checked-at-head");
  expect(r.out).toContain(`check passed: bun run check at ${oid.slice(0, 12)}`);
  expect(readFileSync(log, "utf8")).toContain("pr merge 7");
  expect(checkWorktrees(work)).toEqual([]);
});

test("a failing check refuses without merging, deleting the head or moving any checkout", () => {
  const { work, wt, remote, log, oid, run } = fixture({ check: "exit 7", staleDefault: true });
  const before = [sh(work, "git", "rev-parse", "HEAD"), sh(wt, "git", "rev-parse", "HEAD")];
  const r = run();
  expect(r.code).toBe(1);
  expect(r.err).toContain(
    `refused: \`bun run check\` exited 7 at ${oid.slice(0, 12)}; PR 7 is not merged`,
  );
  expect(readFileSync(log, "utf8")).not.toContain("pr merge");
  expect(sh(remote, "git", "branch", "--list", "feature")).toContain("feature");
  expect([sh(work, "git", "rev-parse", "HEAD"), sh(wt, "git", "rev-parse", "HEAD")]).toEqual(
    before,
  );
  expect(checkWorktrees(work)).toEqual([]);
});

test("a head with no check command warns and merges", () => {
  const { log, run } = fixture({ check: null });
  const r = run();
  expect(r.code).toBe(0);
  expect(r.err).toContain("warning: no check command at");
  expect(r.err).toContain("A later release will refuse this.");
  expect(readFileSync(log, "utf8")).toContain("pr merge 7");
});

test("the check runs at the pushed head, so a local edit cannot make it pass", () => {
  const { wt, log, run } = fixture({ check: "exit 7", fromTask: true });
  writeFileSync(join(wt, "package.json"), JSON.stringify({ scripts: { check: "exit 0" } }));
  const r = run();
  expect(r.code).toBe(1);
  expect(r.err).toContain("exited 7");
  expect(readFileSync(log, "utf8")).not.toContain("pr merge");
});

test("an invalid package.json at the head refuses the merge", () => {
  const { log, run } = fixture({ check: null, packageJson: "{ not json" });
  const r = run();
  expect(r.code).toBe(1);
  expect(r.err).toContain("is not valid JSON; PR 7 is not merged");
  expect(readFileSync(log, "utf8")).not.toContain("pr merge");
});

test("a head pushed after the review was read refuses instead of checking the new commit", () => {
  const { wt, log, run } = fixture();
  sh(wt, "git", "commit", "--allow-empty", "-m", "pushed after review");
  sh(wt, "git", "push", "--force", "origin", "+feature:refs/pull/7/head");
  const r = run();
  expect(r.code).toBe(1);
  expect(r.err).toContain("head moved to");
  expect(readFileSync(log, "utf8")).not.toContain("pr merge");
});

/** @param {object} [extra] */
const pnpmPackage = (extra) =>
  JSON.stringify({ name: "app", packageManager: "pnpm@9", scripts: { check: "lint" }, ...extra });

test("a package with dependencies installs with a frozen lockfile before the check", () => {
  const { log, pmLog, run } = fixture({
    packageJson: pnpmPackage({ devDependencies: { x: "1" } }),
  });
  const r = run();
  expect(r.code).toBe(0);
  expect(readFileSync(pmLog, "utf8")).toBe(
    "install --frozen-lockfile --ignore-scripts\nrun check\n",
  );
  expect(readFileSync(log, "utf8")).toContain("pr merge 7");
});

test("a workspace root with no dependencies of its own still installs", () => {
  const { pmLog, run } = fixture({ packageJson: pnpmPackage({ workspaces: ["packages/*"] }) });
  expect(run().code).toBe(0);
  expect(readFileSync(pmLog, "utf8")).toBe(
    "install --frozen-lockfile --ignore-scripts\nrun check\n",
  );
});

test("a failing install refuses before the check, without merging, and removes its worktree", () => {
  const { work, log, pmLog, run } = fixture({
    packageJson: pnpmPackage({ dependencies: { x: "1" } }),
    pnpmInstallExit: 5,
  });
  const r = run();
  expect(r.code).toBe(1);
  expect(r.err).toContain("`pnpm install --frozen-lockfile --ignore-scripts` exited 5");
  expect(readFileSync(pmLog, "utf8")).toBe("install --frozen-lockfile --ignore-scripts\n");
  expect(readFileSync(log, "utf8")).not.toContain("pr merge");
  expect(checkWorktrees(work)).toEqual([]);
});

test("a run leaves another run's check directory alone", () => {
  const { work, run } = fixture();
  const other = join(work, ".git", "hr-merge-check", "pr-7");
  sh(work, "mkdir", "-p", other);
  writeFileSync(join(other, "in-use"), "another run\n");
  expect(run().code).toBe(0);
  expect(readFileSync(join(other, "in-use"), "utf8")).toBe("another run\n");
});

test("npm-shrinkwrap.json counts as a lockfile, so npm installs with npm ci", () => {
  const { pmLog, run } = fixture({
    packageJson: JSON.stringify({ name: "app", scripts: { check: "lint" } }),
    files: { "npm-shrinkwrap.json": "{}\n" },
  });
  expect(run().code).toBe(0);
  expect(readFileSync(pmLog, "utf8")).toBe("ci --ignore-scripts\nrun check\n");
});

test("another fetch rewriting FETCH_HEAD does not read as a moved head", () => {
  const { work, log, oid, run } = fixture({ racingFetch: true });
  const r = run();
  expect(r.err).not.toContain("head moved");
  expect(r.code).toBe(0);
  expect(readFileSync(log, "utf8")).toContain(`pr merge 7 --squash --match-head-commit ${oid}`);
  expect(sh(work, "git", "for-each-ref", "refs/hr-merge-check")).toBe("");
});

// The check is static analysis. A repository's install scripts can be production setup, so the
// install before it must not run them.
test("the install before the check runs no package lifecycle scripts", () => {
  const outside = mkdtempSync(join(tmpdir(), "merge-pr-marker-"));
  roots.push(outside);
  const marker = join(outside, "postinstall-ran");
  const { log, run } = fixture({
    packageJson: JSON.stringify({
      name: "app",
      packageManager: "bun@1",
      workspaces: [],
      scripts: { check: "exit 0", postinstall: `echo ran > "${marker}"` },
    }),
  });
  const r = run();
  expect(r.code).toBe(0);
  expect(existsSync(marker)).toBe(false);
  expect(readFileSync(log, "utf8")).toContain("pr merge 7");
});

test("Yarn 1 installs with --ignore-scripts and Yarn 2 or later skips builds", () => {
  /** @param {string} version */
  const yarn = (version) =>
    JSON.stringify({
      name: "app",
      packageManager: `yarn@${version}`,
      scripts: { check: "lint" },
      devDependencies: { x: "1" },
    });
  const classic = fixture({ packageJson: yarn("1.22.22") });
  expect(classic.run().code).toBe(0);
  expect(readFileSync(classic.pmLog, "utf8")).toBe(
    "install --frozen-lockfile --ignore-scripts\nrun check\n",
  );
  const berry = fixture({ packageJson: yarn("4.5.0") });
  expect(berry.run().code).toBe(0);
  expect(readFileSync(berry.pmLog, "utf8")).toBe(
    "install --immutable --mode=skip-build\nrun check\n",
  );
  const unnamed = fixture({
    packageJson: JSON.stringify({ name: "app", scripts: { check: "lint" } }),
    files: { "yarn.lock": "", ".yarnrc.yml": "nodeLinker: node-modules\n" },
  });
  expect(unnamed.run().code).toBe(0);
  expect(readFileSync(unnamed.pmLog, "utf8")).toBe(
    "install --immutable --mode=skip-build\nrun check\n",
  );
});
