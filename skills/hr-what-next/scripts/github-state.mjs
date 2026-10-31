// Asks GitHub, through `gh`, whether pull requests and issues are finished. check-open-work.mjs and
// consolidate-ledger.mjs share it.
import { spawn } from "node:child_process";

// What GitHub said about a reference, kept for the life of the process so a second question about it
// (check-open-work.mjs asks twice about a reference both of its checks name) gets the same answer.
/** @type {Map<string, { state: string, unmerged: boolean, pull: boolean, when?: string }>} */
const known = new Map();

/**
 * @param {...string} args
 * @returns {Promise<{ stdout?: string, error?: string }>}
 */
function gh(...args) {
  return new Promise((done) => {
    let stdout = "";
    let stderr = "";
    const child = spawn("gh", args, { timeout: 30_000 });
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) =>
      done({
        error:
          /** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT"
            ? "gh not found"
            : error.message,
      }),
    );
    child.on("close", (code) =>
      done(code === 0 ? { stdout } : { error: stderr.trim() || `gh exit ${code}` }),
    );
  });
}

// "merged", "closed", "open" or "unknown" (not found) per reference; null when GitHub cannot be asked.
/**
 * @param {string[]} refs
 * @param {boolean} offline
 * @returns {Promise<{ states: Map<string, string>, unmerged: Set<string>, pulls: Set<string>, when: Map<string, string>, skipped?: string }>}
 */
export async function githubStates(refs, offline) {
  /** @type {Map<string, string>} */
  const states = new Map();
  // Pull requests that were closed without being merged: "closed", but not finished work.
  /** @type {Set<string>} */
  const unmerged = new Set();
  // References that are pull requests, and when a merged or closed one finished.
  /** @type {Set<string>} */
  const pulls = new Set();
  /** @type {Map<string, string>} */
  const when = new Map();
  if (!refs.length) {
    return { states, unmerged, pulls, when };
  }
  if (offline) {
    return { states, unmerged, pulls, when, skipped: "GitHub check skipped: --offline" };
  }
  /** @param {string} ref */
  const lookup = async (ref) => {
    const [, owner, name, number] = /** @type {RegExpMatchArray} */ (
      ref.match(/^(.+)\/(.+)#(\d+)$/)
    );
    const recorded = known.get(ref);
    if (recorded) {
      states.set(ref, recorded.state);
      if (recorded.unmerged) {
        unmerged.add(ref);
      }
      if (recorded.pull) {
        pulls.add(ref);
      }
      if (recorded.when) {
        when.set(ref, recorded.when);
      }
      return;
    }
    const result = await gh("api", `repos/${owner}/${name}/issues/${number}`);
    if (result.error) {
      if (/\b404\b|not found/i.test(result.error) && result.error !== "gh not found") {
        return states.set(ref, "unknown");
      }
      throw new Error(result.error.split("\n")[0]);
    }
    const issue = JSON.parse(/** @type {string} */ (result.stdout));
    const state = issue.pull_request?.merged_at ? "merged" : issue.state;
    const finished = issue.pull_request?.merged_at ?? issue.closed_at;
    const record = {
      state,
      unmerged: Boolean(
        issue.pull_request && !issue.pull_request.merged_at && issue.state === "closed",
      ),
      pull: Boolean(issue.pull_request),
      ...(finished ? { when: finished } : {}),
    };
    known.set(ref, record);
    states.set(ref, state);
    if (record.unmerged) {
      unmerged.add(ref);
    }
    if (record.pull) {
      pulls.add(ref);
    }
    if (finished) {
      when.set(ref, finished);
    }
  };
  try {
    // The first lookup runs alone, so an offline host or a missing gh costs one call, not one per item.
    await lookup(/** @type {string} */ (refs[0]));
    const queue = refs.slice(1);
    await Promise.all(
      Array.from({ length: 8 }, async () => {
        while (queue.length) {
          await lookup(/** @type {string} */ (queue.shift()));
        }
      }),
    );
  } catch (error) {
    return {
      states: new Map(),
      unmerged: new Set(),
      pulls: new Set(),
      when: new Map(),
      skipped: `GitHub check skipped: ${/** @type {Error} */ (error).message}`,
    };
  }
  return { states, unmerged, pulls, when };
}
