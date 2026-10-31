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
 *   racingFetch?: boolean, baseCurrent?: boolean, errexitOff?: boolean, advanceHead?: boolean,
 *   sharing?: string[], sharingFails?: boolean, upstream?: boolean, originUrl?: string,
 *   botReviews?: number, alias?: boolean, silentReviewFailure?: boolean }} [options]
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
  // Other open PRs (their URLs) that have the head branch as their head, as the GraphQL lookup
  // names them; the stub adds the PR under merge itself, as GitHub does.
  sharing = [],
  // The lookup of those PRs fails.
  sharingFails = false,
  // A fork checkout: a second remote for another repository, and a `gh repo view` that answers
  // with that repository, as the shared upstream remote makes it do in every checkout of a fork.
  upstream = false,
  // How the checkout's remote for this repository is spelled; it reaches the bare remote below.
  originUrl = `git@github.com:${repo}.git`,
  // Git rewrites an https URL of GitHub to its ssh form, as a `url.<base>.insteadOf` rule does.
  alias = false,
  // Reviews by bot accounts already posted on the pull request.
  botReviews = 0,
  // The review checker refuses with exit status 1 and no line --explain can sort.
  silentReviewFailure = false,
} = {}) {
  const root = mkdtempSync(join(process.env.HOUSE_RULES_TEST_TMP ?? tmpdir(), "merge-pr-"));
  roots.push(root);
  const remote = join(root, "remote.git");
  sh(root, "git", "-c", "init.defaultBranch=main", "init", "--bare", remote);
  const work = join(root, "work");
  sh(root, "git", "clone", remote, work);
  // The remote is spelled as a GitHub URL, as in a real checkout, and ssh reaches the bare
  // repository: a stand-in ssh command runs the server side of git against it.
  const ssh = join(root, "fake-ssh");
  writeFileSync(
    ssh,
    `#!/usr/bin/env bash
exec bash -c "$(printf '%s' "\${@: -1}" | sed -e "s#^git-#git #" -e "s#'[^']*'#'${remote}'#")"
`,
  );
  chmodSync(ssh, 0o755);
  sh(work, "git", "config", "core.sshCommand", ssh);
  sh(work, "git", "config", "ssh.variant", "ssh");
  if (alias) {
    sh(work, "git", "config", "url.git@github.com:.insteadOf", "https://github.com/");
  }
  sh(work, "git", "remote", "set-url", "origin", originUrl);
  if (upstream) {
    sh(work, "git", "remote", "add", "upstream", "https://github.com/pingdotgg/t3code.git");
  }
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
  "repo view"*) echo "${upstream ? "pingdotgg/t3code" : repo}";;
  "api repos"*reviews*) echo "${botReviews}";;
  "api graphql"*associatedPullRequests*) ${sharingFails ? "exit 1" : `printf '%s\\n' ${[`https://github.com/${repo}/pull/7`, ...sharing].map((url) => `'${url}'`).join(" ")}`};;
  "api graphql"*) printf '%s' '${JSON.stringify({ data: { viewer: { __typename: "User", login: "maintainer" }, repository: { viewerPermission: "ADMIN", pullRequest: { headRefOid: oid, baseRef: { branchProtectionRule: null, rules: { pageInfo: { hasNextPage: false }, nodes: [] } }, reviewThreads: { nodes: threads, pageInfo: { hasNextPage: false, endCursor: null } }, reviews: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } }, comments: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } }, commits: { nodes: [{ commit: { oid, committedDate: "2026-10-01T00:00:00Z", tree: { entries: [] }, statusCheckRollup: null } }] } } } } })}';;
esac
`,
  );
  if (silentReviewFailure) {
    const bun = Bun.which("bun");
    stub(bin, "bun", `case "$1" in *check-pr-review.ts) exit 1;; esac\nexec "${bun}" "$@"\n`);
  }
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

test("a failing pre-push hook in the checkout does not stop the remote head's deletion", () => {
  const { remote, work, run } = fixture();
  writeFileSync(join(work, ".git", "hooks", "pre-push"), "#!/bin/sh\necho hook ran >&2\nexit 1\n");
  chmodSync(join(work, ".git", "hooks", "pre-push"), 0o755);
  const r = run();
  expect(r.err).toBe("");
  expect(r.code).toBe(0);
  expect(r.out).toContain("deleted: origin/feature");
  expect(sh(remote, "git", "branch", "--list", "feature")).toBe("");
});

test("a rejected delete still runs the landing checks, then exits 1 for the leftover branch", () => {
  const { remote, work, squash, run } = fixture({ staleDefault: true });
  sh(remote, "git", "config", "receive.denyDeletes", "true");
  expect(sh(work, "git", "rev-parse", "main")).not.toBe(squash);
  const r = run();
  expect(r.code).toBe(1);
  expect(r.err).toContain("delete failed: origin/feature");
  expect(r.err).toContain("leftover branch: origin/feature still exists after merge");
  expect(sh(remote, "git", "branch", "--list", "feature")).not.toBe("");
  // verify-landed.sh ran: the primary's main was fast-forwarded to the merge commit.
  expect(sh(work, "git", "rev-parse", "main")).toBe(squash);
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

test("another open PR with the same head keeps the branch, and the landing still succeeds", () => {
  const upstream = "https://github.com/upstream/app/pull/9";
  const { remote, log, run } = fixture({ sharing: [upstream] });
  const r = run();
  expect(r.code).toBe(0);
  expect(r.err).toContain(`kept: origin/feature is the head of open PRs (${upstream})`);
  expect(r.err).not.toContain("leftover");
  expect(readFileSync(log, "utf8")).toContain("pr merge 7 --squash");
  expect(sh(remote, "git", "branch", "--list", "feature")).toContain("feature");
});

test("a fast-forward landing keeps a head that another open PR uses", () => {
  const upstream = "https://github.com/upstream/app/pull/9";
  const { remote, oid, run } = fixture({
    repo: "bompus/house-rules",
    baseCurrent: true,
    sharing: [upstream],
  });
  const r = run();
  expect(r.code).toBe(0);
  expect(r.out).toContain(`landed: PR 7 as ${oid} by fast-forward push to main`);
  expect(r.out).not.toContain("deleted:");
  expect(r.err).toContain(`kept: origin/feature is the head of open PRs (${upstream})`);
  expect(sh(remote, "git", "rev-parse", "main")).toBe(oid);
  expect(sh(remote, "git", "rev-parse", "feature")).toBe(oid);
});

test("a head moved after the checks refuses a fast-forward landing that keeps the branch", () => {
  const fx = fixture({
    repo: "bompus/house-rules",
    baseCurrent: true,
    advanceHead: true,
    sharing: ["https://github.com/upstream/app/pull/9"],
  });
  const before = sh(fx.remote, "git", "rev-parse", "main");
  const r = fx.run();
  expect(r.code).toBe(1);
  expect(r.err).toContain("fast-forward push of");
  expect(sh(fx.remote, "git", "rev-parse", "main")).toBe(before);
});

test("a failed lookup of the PRs that share the head refuses before any merge", () => {
  const { remote, log, run } = fixture({ sharingFails: true });
  const r = run();
  expect(r.code).toBe(1);
  expect(r.err).toContain("could not list the open PRs that use feature as their head");
  expect(readFileSync(log, "utf8")).not.toContain("pr merge");
  expect(sh(remote, "git", "branch", "--list", "feature")).toContain("feature");
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

test("a pull request of a repository the checkout has no remote for is refused", () => {
  const { log, remote, runTarget } = fixture({ repo: "bompus/house-rules" });
  const before = sh(remote, "git", "rev-parse", "main");
  const r = runTarget("owner/other#7");
  expect(r.code).toBe(1);
  expect(r.err).toContain("this checkout has no remote for owner/other");
  expect(existsSync(log)).toBe(false);
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

// A fork checkout also has the upstream remote, so `gh repo view` names the upstream in every
// checkout of the fork. The repository comes from the argument and the remote from its URL.
test("a fork checkout lands its own repository's pull request, whatever gh repo view names", () => {
  const { remote, log, run } = fixture({ repo: "bompus/t3code", upstream: true });
  const r = run();
  expect(r.err).toBe("");
  expect(r.code).toBe(0);
  const calls = readFileSync(log, "utf8");
  expect(calls).not.toContain("repo view");
  expect(calls).toContain("pr merge 7 --squash");
  expect(calls).toContain("--repo bompus/t3code");
  expect(sh(remote, "git", "branch", "--list", "feature")).toBe("");
});

test("the remote is matched to the repository by URL, whatever the case or the scheme", () => {
  for (const originUrl of [
    "git@github.com:Owner/App.git",
    "ssh://git@github.com/owner/app",
    "ssh://git@GitHub.com:22/OWNER/app/",
  ]) {
    const fx = fixture({ originUrl });
    const r = fx.run();
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
  }
  const rewritten = fixture({ originUrl: "https://github.com/owner/app.git", alias: true });
  expect(rewritten.run().code).toBe(0);
});

// The matcher normalises https, ssh and scp-style URLs alike; a path or another host is not a match.
test("remote_slug names host, owner and repository, ignoring case, credentials, ports and .git", () => {
  const text = readFileSync(script, "utf8");
  const fn = /^remote_slug\(\) \{\n[\s\S]*?^\}$/m.exec(text)?.[0] ?? "";
  const urls = [
    "https://github.com/Owner/App.git",
    "http://github.com/owner/app",
    "git@github.com:owner/app",
    "ssh://git@github.com:22/owner/app.git",
    "https://user:tok@github.com:443/owner/app/",
    "/srv/git/owner/app.git",
    "https://gitlab.com/owner/app",
  ];
  const run = Bun.spawnSync([
    "bash",
    "-c",
    `${fn}\nfor u in "$@"; do remote_slug "$u"; echo; done`,
    "slug",
    ...urls,
  ]);
  expect(run.stdout.toString().split("\n").slice(0, urls.length)).toEqual([
    "github.com/owner/app",
    "github.com/owner/app",
    "github.com/owner/app",
    "github.com/owner/app",
    "github.com/owner/app",
    "",
    "gitlab.com/owner/app",
  ]);
});

test("--remote names the remote without a URL match", () => {
  const unmatched = "git@gitlab.com:unrelated/mirror.git";
  const fx = fixture({ originUrl: unmatched });
  expect(fx.run().code).toBe(1);
  const r = fx.run("--remote", "origin");
  expect(r.err).toBe("");
  expect(r.code).toBe(0);
});

// Git fetches a remote's first URL and pushes to all of them, so a second URL for another
// repository would land the change there too.
test("a remote with a URL for another repository is not used", () => {
  const fx = fixture({ repo: "bompus/house-rules", baseCurrent: true });
  const other = join(dirname(fx.remote), "other.git");
  sh(dirname(fx.remote), "git", "-c", "init.defaultBranch=main", "init", "--bare", other);
  const mainBefore = sh(fx.remote, "git", "rev-parse", "main");
  sh(
    fx.work,
    "git",
    "config",
    "--add",
    "remote.origin.url",
    "https://github.com/unrelated/mirror.git",
  );
  let r = fx.run();
  expect(r.code).toBe(1);
  expect(r.err).toContain("this checkout has no remote for bompus/house-rules");
  sh(fx.work, "git", "config", "--unset-all", "remote.origin.url", "unrelated");
  sh(fx.work, "git", "config", "remote.origin.pushurl", other);
  r = fx.run();
  expect(r.code).toBe(1);
  expect(r.err).toContain("this checkout has no remote for bompus/house-rules");
  expect(sh(fx.remote, "git", "rev-parse", "main")).toBe(mainBefore);
  expect(sh(other, "git", "branch", "--list")).toBe("");
  expect(existsSync(fx.log)).toBe(false);
});

// Git rewrites the push URL after the config is read, so the URL in the config is not the one used.
test("a remote whose push URL is rewritten to another repository is not used", () => {
  const fx = fixture({ repo: "bompus/house-rules", baseCurrent: true });
  sh(
    fx.work,
    "git",
    "config",
    "url.git@github.com:other/app.git.pushInsteadOf",
    "git@github.com:bompus/house-rules.git",
  );
  const r = fx.run();
  expect(r.code).toBe(1);
  expect(r.err).toContain("this checkout has no remote for bompus/house-rules");
  expect(existsSync(fx.log)).toBe(false);
});

test("a repository named in another case still lands by fast-forward push", () => {
  const { remote, oid, runTarget } = fixture({ repo: "bompus/house-rules", baseCurrent: true });
  const r = runTarget("Bompus/House-Rules#7");
  expect(r.err).toBe("");
  expect(r.code).toBe(0);
  expect(r.out).toContain(`landed: PR 7 as ${oid} by fast-forward push to main`);
  expect(sh(remote, "git", "rev-parse", "main")).toBe(oid);
});

// --explain runs the landing conditions read-only and says which hold.
test("--explain reports every condition met, lands nothing and exits 0", () => {
  const { remote, log, run } = fixture({ repo: "bompus/house-rules", baseCurrent: true });
  const mainBefore = sh(remote, "git", "rev-parse", "main");
  const r = run("--explain");
  expect(r.code).toBe(0);
  for (const line of [
    "met    PR is open",
    "met    no open PR targets the head branch",
    "met    review threads and review-body findings are resolved",
    "met    bot review of the current head is in place or not required",
    "met    bot review rounds: 0 of 6",
    "met    other checks on the head commit have passed",
    "met    PR head equals the fetched commit",
    "met    repository check passed: bun run check",
    "met    base is an ancestor of the head",
    "met    head branch is still at the reviewed commit",
  ]) {
    expect(r.out).toContain(line);
  }
  expect(r.out).toContain("all conditions met");
  expect(r.out).not.toContain("UNMET");
  // One line for each condition.
  expect(r.out.split("bot review rounds").length).toBe(2);
  expect(r.out.split("met    ").length).toBe(13);
  expect(readFileSync(log, "utf8")).not.toContain("pr merge");
  expect(sh(remote, "git", "rev-parse", "main")).toBe(mainBefore);
  expect(sh(remote, "git", "branch", "--list", "feature")).toContain("feature");
});

test("--explain names each unmet condition, exits 1 and still lands nothing", () => {
  const threads = [
    { isResolved: false, comments: { nodes: [{ url: "https://example.test/t1" }] } },
  ];
  const fx = fixture({
    repo: "bompus/house-rules",
    dependents: "8\n",
    threads,
    check: "exit 7",
    botReviews: 7,
  });
  const mainBefore = sh(fx.remote, "git", "rev-parse", "main");
  const r = fx.run("--explain");
  expect(r.code).toBe(1);
  expect(r.out).toContain("UNMET  no open PR targets the head branch: open PRs target feature: 8");
  expect(r.out).toContain("UNMET  review threads and review-body findings are resolved");
  expect(r.out).toContain("unresolved thread: https://example.test/t1");
  expect(r.out).toContain("UNMET  bot review rounds: 7 of 6");
  expect(r.out).toContain("UNMET  repository check passed: refused: `bun run check` exited 7");
  expect(r.out).toContain("UNMET  base is an ancestor of the head");
  expect(r.out).not.toContain("all conditions met");
  expect(readFileSync(fx.log, "utf8")).not.toContain("pr merge");
  expect(sh(fx.remote, "git", "rev-parse", "main")).toBe(mainBefore);
});

test("--explain reads a review checker refusal it cannot sort as unmet", () => {
  const fx = fixture({ silentReviewFailure: true });
  const r = fx.run("--explain");
  expect(r.code).toBe(1);
  expect(r.out).toContain("UNMET  no other review feedback is open: check-pr-review.ts exited 1");
  expect(r.out).not.toContain("all conditions met");
});

test("--explain reports a head branch pushed after the review as a broken lease", () => {
  const fx = fixture({ repo: "bompus/house-rules", baseCurrent: true });
  sh(fx.wt, "git", "commit", "--allow-empty", "-m", "later work");
  sh(fx.wt, "git", "push", "origin", "feature");
  const r = fx.run("--explain");
  expect(r.code).toBe(1);
  expect(r.out).toContain("UNMET  head branch is still at the reviewed commit");
  expect(r.out).not.toContain("UNMET  PR head equals the fetched commit");
});

test("--explain in a repository that merges through GitHub reports the pinned merge", () => {
  const { log, run } = fixture();
  const r = run("--explain");
  expect(r.code).toBe(0);
  expect(r.out).toContain("met    landing is a GitHub merge pinned to the head commit");
  expect(readFileSync(log, "utf8")).not.toContain("pr merge");
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

test.skipIf(process.getuid?.() === 0)(
  "permission preflight skip propagates exit 3 after landing",
  () => {
    const fx = fixture({ staleDefault: true, fromTask: true });
    const before = sh(fx.work, "git", "rev-parse", "HEAD");
    const index = readFileSync(join(fx.work, ".git", "index"));
    const refs = join(fx.work, ".git", "refs", "heads");
    chmodSync(refs, 0o555);
    try {
      const r = fx.run();
      expectLandedSyncPending(fx, r, "Git metadata refs/heads/main: not writable: " + refs);
      expect(sh(fx.work, "git", "rev-parse", "HEAD")).toBe(before);
      expect(readFileSync(join(fx.work, ".git", "index"))).toEqual(index);
      expect(existsSync(join(fx.work, "package.json"))).toBe(false);
      expect(sh(fx.remote, "git", "rev-parse", "main")).toBe(fx.squash);
    } finally {
      chmodSync(refs, 0o755);
    }
  },
);
