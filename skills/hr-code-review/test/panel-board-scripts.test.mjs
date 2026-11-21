// The weekly refresh's two shell scripts, against a bare remote and a copy of the committed references: the
// publish script never rewrites work that is not the job's own, and the refresh script never discards other edits.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const refs = "skills/hr-code-review/references";
const BOT = "41898282+github-actions[bot]@users.noreply.github.com";
// These scripts live in the house-rules repository, not in the skill: an installed copy of the skill has neither the
// root scripts nor the repository layout the fixtures copy, so the tests run only inside the repository.
const inRepository = [
  "scripts/publish-panel-board.sh",
  "scripts/refresh-panel-board.sh",
  `${refs}/panel-board-snapshot.json`,
].every((path) => existsSync(join(root, path)));
const skip =
  process.platform === "win32"
    ? "needs bash, git and jq"
    : inRepository
      ? false
      : "runs only in the house-rules repository";

/** @param {string} cwd @param {string} cmd @param {string[]} args @param {Record<string, string>} [env] */
function run(cwd, cmd, args, env = {}) {
  const out = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", ...env },
  });
  return { code: out.status, text: `${out.stdout}${out.stderr}` };
}
/** @param {string} cwd @param {string[]} args */
const git = (cwd, ...args) => {
  const out = run(cwd, "git", args);
  assert.equal(out.code, 0, `git ${args.join(" ")}: ${out.text}`);
  return out.text.trim();
};

/**
 * A bare remote, a clone of it on main that holds the scripts and the committed references, and a second clone
 * for a maintainer.
 * @param {(ctx: { dir: string, work: string, other: string, remote: string }) => void} fn
 */
function inRepo(fn) {
  const dir = mkdtempSync(join(tmpdir(), "panel-board-"));
  try {
    const remote = join(dir, "origin.git");
    git(dir, "init", "-q", "--bare", "-b", "main", remote);
    const work = join(dir, "work");
    git(dir, "clone", "-q", remote, work);
    git(work, "checkout", "-q", "-b", "main");
    git(work, "config", "user.name", "Maintainer");
    git(work, "config", "user.email", "maintainer@example.org");
    for (const path of [
      "scripts/publish-panel-board.sh",
      "scripts/refresh-panel-board.sh",
      "skills/hr-code-review/scripts/refresh-recommendations.mjs",
      "skills/hr-code-review/scripts/refresh-files.mjs",
      refs,
    ]) {
      mkdirSync(dirname(join(work, path)), { recursive: true });
      cpSync(join(root, path), join(work, path), { recursive: true });
    }
    git(work, "add", "-A");
    git(work, "commit", "-q", "-m", "base");
    git(work, "push", "-q", "-u", "origin", "main");
    const other = join(dir, "other");
    git(dir, "clone", "-q", remote, other);
    git(other, "config", "user.name", "Maintainer");
    git(other, "config", "user.email", "maintainer@example.org");
    fn({ dir, work, other, remote });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Change a row of the snapshot, as a refetch of a changed board would, and stamp a new fetch date. */
function changeBoard(/** @type {string} */ work, /** @type {number} */ bump, date = "2026-12-01") {
  const path = join(work, refs, "panel-board-snapshot.json");
  const snapshot = JSON.parse(readFileSync(path, "utf8"));
  snapshot.rows[0].fixed += bump;
  snapshot.fetched = date;
  writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`);
}
const publish = (/** @type {string} */ work, /** @type {string} */ branch) => {
  const output = join(work, "..", "output.txt");
  writeFileSync(output, "");
  const out = run(work, "bash", ["scripts/publish-panel-board.sh"], {
    BRANCH: branch,
    GITHUB_OUTPUT: output,
  });
  return { ...out, output: readFileSync(output, "utf8") };
};
const tipOf = (/** @type {string} */ work, /** @type {string} */ branch) =>
  git(work, "ls-remote", "origin", `refs/heads/${branch}`).split(/\s/)[0];

test(
  "publish: a new board is pushed once; the same board again, with only a new date, pushes nothing",
  { skip },
  () => {
    inRepo(({ work }) => {
      changeBoard(work, 1);
      const first = publish(work, "board-refresh");
      assert.equal(first.code, 0, first.text);
      assert.match(first.output, /ready=true/);
      const tip = tipOf(work, "board-refresh");
      assert.equal(git(work, "log", "-1", "--format=%ae", "board-refresh"), BOT);
      // The next week: the same board, a later fetch date, a fresh checkout of main.
      git(work, "checkout", "-q", "main");
      changeBoard(work, 1, "2026-12-08");
      const second = publish(work, "board-refresh");
      assert.equal(second.code, 0, second.text);
      assert.match(second.output, /ready=true/);
      assert.match(second.text, /nothing pushed/);
      assert.equal(tipOf(work, "board-refresh"), tip);
      // A board that changed again replaces the job's own commit, with a lease on what was read.
      git(work, "checkout", "-q", "main");
      changeBoard(work, 2, "2026-12-15");
      const third = publish(work, "board-refresh");
      assert.equal(third.code, 0, third.text);
      assert.notEqual(tipOf(work, "board-refresh"), tip);
    });
  },
);

test(
  "publish: a commit on the branch that is not the job's, or touches another file, is never overwritten",
  { skip },
  () => {
    inRepo(({ work, other }) => {
      changeBoard(work, 1);
      assert.match(publish(work, "board-refresh").output, /ready=true/);
      // A maintainer adds a commit to the branch.
      git(other, "fetch", "-q", "origin", "board-refresh");
      git(other, "checkout", "-q", "-b", "board-refresh", "origin/board-refresh");
      appendFileSync(join(other, refs, "panel-recommendations.md"), "\nA maintainer's note.\n");
      git(other, "commit", "-q", "-am", "note");
      git(other, "push", "-q", "origin", "board-refresh");
      const kept = tipOf(work, "board-refresh");
      git(work, "checkout", "-q", "main");
      changeBoard(work, 5, "2026-12-08");
      const refused = publish(work, "board-refresh");
      assert.equal(refused.code, 1, refused.text);
      assert.match(refused.output, /ready=false/);
      assert.match(refused.text, /not the workflow's, or is a merge/);
      assert.equal(tipOf(work, "board-refresh"), kept);
      // A commit made as the bot but touching another file is refused as well.
      git(other, "checkout", "-q", "-b", "bot-work", "origin/main");
      appendFileSync(join(other, refs, "panel-recommendations.md"), "\nBot-made text.\n");
      git(
        other,
        "-c",
        "user.name=github-actions[bot]",
        "-c",
        `user.email=${BOT}`,
        "commit",
        "-q",
        "-am",
        "bot",
      );
      git(other, "push", "-q", "origin", "bot-work");
      git(work, "checkout", "-q", "main");
      changeBoard(work, 5, "2026-12-08");
      const second = publish(work, "bot-work");
      assert.match(second.output, /ready=false/);
      assert.match(second.text, /touches .*panel-recommendations\.md/);
    });
  },
);

test(
  "refresh: when only the dates would change, nothing but the two files is touched and they come back byte for byte",
  { skip },
  () => {
    inRepo(({ dir, work }) => {
      // A saved board that reduces to the committed snapshot.
      const snapshot = JSON.parse(
        readFileSync(join(work, refs, "panel-board-snapshot.json"), "utf8"),
      );
      const board = {
        meta: { planted_total: snapshot.plantedTotal, updated: snapshot.boardUpdated },
        runs: snapshot.rows.map((/** @type {any} */ r) => ({
          model: r.model,
          vendor: "v",
          harness: r.harness,
          effort: r.effort,
          n_runs: r.runs,
          fixed: r.fixed,
          wall_min: r.wallMinutes,
          cost_usd: r.costUsd,
          cost_kind: r.costUsd === null ? "unknown" : "list",
          date: r.date,
          superseded: null,
        })),
      };
      mkdirSync(join(dir, "outside"));
      const saved = join(dir, "outside", "board.json");
      writeFileSync(saved, JSON.stringify(board));
      // Uncommitted work: a result imported into the catalog, and a note in another reference file.
      writeFileSync(
        join(dir, "outside", "own.json"),
        JSON.stringify({
          version: 1,
          results: [
            {
              model: "gpt-6.2-astra",
              harness: "Codex CLI",
              effort: "medium",
              found: 80,
              of: 141,
              falseSharePercent: 0.2,
              wallMinutesPerReview: 2.7,
              cases: 46,
              caseSet: "held-out",
              judging: "one-model",
              checked: "2026-11-21",
            },
          ],
        }),
      );
      writeFileSync(join(dir, "outside", "deny.txt"), "unrelated-name\n");
      const imported = run(work, "bun", [
        "skills/hr-code-review/scripts/refresh-recommendations.mjs",
        "--from-file",
        join(dir, "outside", "own.json"),
        "--deny-file",
        join(dir, "outside", "deny.txt"),
      ]);
      assert.equal(imported.code, 0, imported.text);
      appendFileSync(join(work, refs, "panel-recommendations.md"), "\nAn uncommitted note.\n");
      const files = [
        "panel-board-snapshot.json",
        "panel-recommendations.json",
        "panel-recommendations.md",
      ];
      const before = files.map((f) => readFileSync(join(work, refs, f), "utf8"));
      const output = join(dir, "output.txt");
      writeFileSync(output, "");
      const out = run(work, "bash", ["scripts/refresh-panel-board.sh"], {
        PANEL_BOARD_FILE: saved,
        GITHUB_OUTPUT: output,
      });
      assert.equal(out.code, 0, out.text);
      assert.match(readFileSync(output, "utf8"), /changed=false/);
      assert.deepEqual(
        files.map((f) => readFileSync(join(work, refs, f), "utf8")),
        before,
      );
      assert.match(before[1] ?? "", /own-gpt-6\.2-astra-medium-held-out/);
    });
  },
);

test(
  "publish: a merge commit on the branch is never the job's, and the push is leased, never forced",
  { skip },
  () => {
    inRepo(({ work, other }) => {
      changeBoard(work, 1);
      assert.match(publish(work, "board-refresh").output, /ready=true/);
      // Someone updates the branch with a merge of main (as GitHub's "Update branch" does).
      git(other, "fetch", "-q", "origin", "board-refresh");
      git(other, "checkout", "-q", "-b", "board-refresh", "origin/board-refresh");
      git(other, "checkout", "-q", "main");
      git(other, "commit", "-q", "--allow-empty", "-m", "main moves on");
      git(other, "push", "-q", "origin", "main");
      git(other, "checkout", "-q", "board-refresh");
      git(
        other,
        "-c",
        "user.name=github-actions[bot]",
        "-c",
        `user.email=${BOT}`,
        "merge",
        "-q",
        "--no-ff",
        "-m",
        "Update branch",
        "main",
      );
      git(other, "push", "-q", "origin", "board-refresh");
      git(work, "checkout", "-q", "main");
      git(work, "pull", "-q", "origin", "main");
      changeBoard(work, 7, "2026-12-08");
      const refused = publish(work, "board-refresh");
      assert.equal(refused.code, 1, refused.text);
      assert.match(refused.output, /ready=false/);
      assert.match(refused.text, /is a merge/);
    });
    const script = readFileSync(join(root, "scripts", "publish-panel-board.sh"), "utf8");
    assert.match(script, /--force-with-lease=/);
    assert.doesNotMatch(script, /--force(?!-with-lease)/);
  },
);
