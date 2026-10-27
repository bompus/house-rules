#!/usr/bin/env node
// Lists open work before claiming "nothing remains" or archiving a plan. See ../SKILL.md and plan-files.
// Exit 0: nothing open; 1: invalid input; 2: open work remains or archiving refused.
// "awaiting your yes/no" lists the deferred items whose trigger is only the user's own action
// ("user selects", "user's decision", "user asks for the backlog"): they were deferred, not decided,
// so the user still owes a yes, a no or a trigger other than their own. The match is a heuristic on the
// trigger text, which must be the user plus a verb such as selects, picks, decides, asks or approves and
// at most a short object ("it", "the backlog"); a trigger with a date, event or another condition
// stays an ordinary deferred item. The group is a subset of `open` and does not change the exit code.
// "close-out due" prints when every open item is deferred and the plan is not completed: the session's work
// is finished, so the user owes a decision on each item and the reply offers All done or Pause. A plan whose
// Status is paused without a done line recording the user's Pause choice is a finding; with one, the pause
// stands and the prompt does not print. A line dropped by the user with no `asked in <where>` or offer ID warns.
// "possibly finished" lists open or deferred items whose every named pull request or issue is merged or
// closed on GitHub: done work left open, or a trigger that has fired. A named commit that a --checkout has
// outside its default branch keeps the item off the list. Bare numbers ("PR #4") are looked up only in
// --repo. The check needs `gh`; without it, offline, or with --offline it is skipped and "skipped" says so.
// "re-check due" lists items whose `recheck: YYYY-MM-DD` date is past or within 7 days.
// "possibly resolved by a later done line" lists open/deferred lines sharing a token with a later done line,
// regardless of recheck date. Close the original with close-ledger-line.mjs. Tokens name PRs/issues (bare
// numbers use --repo), commits, explicit mcp: threads, 3+ part offers or work IDs (docs-fix-20261016), not bare UUIDs.
// Tokens named by >8 lines are ignored. These groups run even if plan lint fails and never change exit codes.
// The ledger budget warns above 100 open or deferred lines or a plan over 256 KiB: see LEDGER_BUDGET.
// "unanswered offers" counts the open (`- [ ]`) ledger items that name an offer, one per offer ID, and warns at
// three or more, the point where the offers rule says to present no further offer. A line names an offer when
// an ID (capitals and digits joined by hyphens) follows the word "offer" directly ("Offer ABC-12 ...", "Pilot offer ABC-12").
// The offer is answered when any ledger line naming it is marked dropped, says it was selected, chosen,
// picked or answered, or says what happened to the other options (the DISPOSITION words). An ID after
// "by", "into" or "with" ("superseded by offer ABC-13") is the replacement, not the line's subject.
// Deferred and done items are never counted. The count is a text match like the groups above; it warns
// and does not change the exit code.
// A plan with a `Project: <name>` line is checked against <notes>/audits/<name>/last-audit.json, the record
// hr-forgotten-work-audit writes: a missing, unreadable or older-than-30-days record is a warning. A plan
// without that line gets no audit warning.
import { pathToFileURL } from "node:url";
import { githubStates } from "./github-state.mjs";
import { MARKS, RECHECK, droppedByUserUnasked, parsePlan, planSnapshot } from "./plan-ledger.mjs";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
} from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";

/** @typedef {import("./plan-ledger.mjs").LedgerItem} LedgerItem */
/** @typedef {ReturnType<typeof parseArguments>} Options */
/** @typedef {{ state: string, label: string }} RefState */
/**
 * @typedef {object} Report
 * @property {string} plan
 * @property {string | null} status
 * @property {string | null} owner
 * @property {string[]} open
 * @property {string[]} awaitingUser
 * @property {string[]} unansweredOffers
 * @property {string[]} stale
 * @property {string[]} recheckDue
 * @property {string[]} resolvedLater
 * @property {string[]} skipped
 * @property {string[]} findings
 * @property {string[]} warnings
 * @property {string[]} errors
 * @property {boolean} [invalidPlan]
 * @property {boolean} [closeOutDue]
 * @property {string} [archived]
 * @property {{ version: number, sessionId: string, turnId: string | null } & ReturnType<typeof planSnapshot>} [reconciliation]
 */

const usage =
  "usage: check-open-work.mjs <plan.md> [--checkout <path>]... [--app-managed <path>]... [--scratch <dir>] [--repo <owner/repo>] [--offline] [--today <YYYY-MM-DD>] [--archive] [--json] [--session <id> --turn <id>]\n" +
  'The output lists deferred items whose trigger is only the user\'s own action ("user selects", "user asks for the backlog") as "awaiting your yes/no"; this is a text match, see the header.';
const TERMINAL_STATUS = /^(completed?|done|archived)\b/i;
const COMPLETED_STATUS = /^completed\b/i;
const PAUSED_STATUS = /^paused\b/i;
// The verb may take a short object of up to four plain words ("user asks for a release"), none of them a
// condition or time word, so "user selects after the release ships" and "user approves the release on
// Friday" stay ordinary deferred items.
const USER_ONLY_TRIGGER =
  /^(?:when |once |until )?(?:the )?user(?:'s)?\s+(?:select\w*|pick\w*|choos\w*|decid\w*|decision|choice|answer\w*|direction|approv\w*|ask\w*|say\w*|request\w*)(?:\s+(?!(?:after|when|once|if|until|unless|before|and|or|on|at|by|in|next|this|every|each|today|tomorrow|tonight|later|during|while|since|from)\b)[a-z'-]+){0,4}$/i;
// A done line that records the user choosing Pause ("user chose Pause in offer X"), not any line that
// mentions the word ("add pause/resume controls").
const PAUSE_CHOICE =
  /\buser\b[^.;]{0,40}\b(?:chose|chosen|selected|picked|asked for|requested)\s+(?:the\s+|a\s+)?`?pause\b(?![/-]\w)|\bpause\b`?\s+(?:was\s+)?(?:chosen|selected|picked)\s+by\s+(?:the\s+)?user/i;
// An offer line that records an answer, and words that say what happened to the other options.
// "user reply" and "user go" are not answer words: "awaiting user reply" and "user reply pending" say the offer is
// still open, so only a line that says it was selected, chosen, picked or answered counts as an answer.
const ANSWERED_OFFER =
  /\boffer\b.*\b(?:selected|chose|chosen|picked|answered)\b|\b(?:selected|chose|chosen|picked|answered)\b.*\boffer\b/i;
// "deferred" and "dropped" count only next to an option code ("1b deferred"), since a line can defer
// something else ("rollout deferred until the release").
const DISPOSITION =
  /not selected|unselected|unpicked|declined|superseded|passed over|only option|all selected|no other options?|\b\d+[a-z]\b[^.;]{0,30}\b(?:deferred|dropped)\b|\b(?:deferred|dropped)\b[^.;]{0,15}\b\d+[a-z]\b/i;
const OFFER_ID = /\b[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+\b/g;
// An ID right after the word "offer": the offer the line is about. The ID is checked against OFFER_ID's
// shape afterwards because the word "offer" is matched in any case.
const OFFER_SUBJECT = /\boffer\b[^\w]{0,3}([\w-]+)/gi;
const OFFER_ID_ONLY = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/;
const REPLACEMENT_OF = /\b(?:by|into|with)\s+(?:the\s+)?$/i;
// The offers rule stops presenting new offers at this many open and unanswered ones.
const OFFER_LIMIT = 3;
// A deferred item that waits on another thread (an upstream issue or pull request, a maintainer, another
// session), or an open question sent to one, needs a `recheck:` date: "trigger: reply" never fires itself.
const EXTERNAL =
  /https:\/\/github\.com\/|\b[\w.-]+\/[\w.-]+#\d+|\bPR\s*#?\s*\d+|(?<![\w/#&])#\d+\b|\bupstream\b|\bmaintainers?\b|\b(?:another|other|the [\w-]+) (?:session|thread)\b/i;
const SENT_QUESTION =
  /\b(?:asked|relayed|sent)\b.*\b(?:session|thread|owner|maintainer)s?\b|\b(?:awaiting|waiting (?:on|for)) (?:a |the )?(?:reply|answer|response)\b/i;
const GITHUB_URL = /https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(?:pull|issues)\/(\d+)/g;
const GITHUB_REF = /(?<![\w./-])([\w.-]+)\/([\w.-]+)#(\d+)\b/g;
const BARE_REF = /(?:\bPR\s*#?\s*|(?<![\w/#&])#)(\d{1,6})\b/gi;
const COMMIT = /\b[0-9a-f]{7,40}\b/g;
const UUID = /(?<![\w.-])[\w.-]*[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}[\w.-]*/gi;
const THREAD_ID = /\bmcp:([0-9a-f]{8})(?:-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?/g;
// Three or more parts, so "UTF-8" is not an offer ID but "ABC-12-3" is.
const LONG_OFFER_ID = /\b[A-Z][A-Z0-9]*(?:-[A-Z0-9]+){2,}\b/g;
// A commit written after the word "commit" or "sha" counts whatever its characters, since git short ids can
// be all digits or all letters; a bare hex-looking run needs a digit and a letter, or dates and counts match.
const NAMED_COMMIT = /\b(?:commit|sha)\s+([0-9a-f]{7,40})\b/gi;
// A work or task id: lowercase parts joined by hyphens or dots, three or more parts, with a hyphen and a digit
// ("docs-fix-20261016", "release-0.17.0-20261018"). Dates start with a digit and skill names have none.
const WORK_ID = /(?<![\w.-])[a-z][a-z0-9]*(?:[-.][a-z0-9]+){2,}(?![\w-]|\.\w)/g;
const SHARED_TOKEN_LINES = 8;
// A ledger past these sizes is no longer reviewed line by line, and an agent reading the plan has to page
// through it. 100 open lines is about what one backlog review can still show one row each; 256 KiB is where
// common agent file readers stop returning a whole file in one read. The archived ledger this budget was set
// from had 579 open or deferred lines in 1.3 MB, and 448 of them were already finished.
const LEDGER_BUDGET = { open: 100, kib: 256 };
// Monthly: items in a full audit were lost within two to four weeks of being promised.
const AUDIT_DAYS = 30;
const PROJECT_NAME = /^\w[\w.-]*$/;
// A real calendar date: "2026-02-31" has the shape but not the round trip.
/** @param {string} value */
function validDate(value) {
  const date = new Date(`${value}T00:00:00Z`);
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

/** @param {string[]} argv */
function parseArguments(argv) {
  const options = {
    plan: /** @type {string | null} */ (null),
    checkouts: /** @type {string[]} */ ([]),
    appManaged: /** @type {string[]} */ ([]),
    scratch: /** @type {string | null} */ (null),
    repo: /** @type {string | null} */ (null),
    offline: false,
    today: new Date().toLocaleDateString("sv"),
    archive: false,
    json: false,
    sessionId: /** @type {string | null} */ (null),
    turnId: /** @type {string | null} */ (null),
  };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index] ?? "";
    if (argument === "--archive") {
      options.archive = true;
    } else if (argument === "--json") {
      options.json = true;
    } else if (argument === "--offline") {
      options.offline = true;
    } else if (
      [
        "--checkout",
        "--app-managed",
        "--scratch",
        "--repo",
        "--today",
        "--session",
        "--turn",
      ].includes(argument)
    ) {
      const value = argv[++index];
      if (!value) {
        throw new Error(`${argument} needs a value\n${usage}`);
      }
      if (argument === "--session") {
        options.sessionId = value;
      } else if (argument === "--turn") {
        options.turnId = value;
      } else if (argument === "--checkout") {
        options.checkouts.push(value);
      } else if (argument === "--app-managed") {
        options.appManaged.push(value);
      } else if (argument === "--repo") {
        if (!/^[\w.-]+\/[\w.-]+$/.test(value)) {
          throw new Error(`--repo needs owner/repo\n${usage}`);
        }
        options.repo = value;
      } else if (argument === "--today") {
        if (!validDate(value)) {
          throw new Error(`--today needs YYYY-MM-DD\n${usage}`);
        }
        options.today = value;
      } else {
        options.scratch = value;
      }
    } else if (argument.startsWith("--") || options.plan) {
      throw new Error(usage);
    } else {
      options.plan = argument;
    }
  }
  if (!options.plan) {
    throw new Error(usage);
  }
  if (Boolean(options.sessionId) !== Boolean(options.turnId)) {
    throw new Error("--session and --turn must be supplied together");
  }
  if (options.sessionId && options.archive) {
    throw new Error("a reconciliation receipt cannot archive its plan");
  }
  return options;
}

/** @param {string} text */
const clip = (text, length = 90) => (text.length > length ? `${text.slice(0, length - 1)}…` : text);

/** @param {string} planPath */
function notesRoot(planPath) {
  const parts = resolve(planPath).split(sep);
  const at = parts.lastIndexOf("plans");
  return at > 0
    ? { notes: parts.slice(0, at).join(sep) || sep, plans: parts.slice(0, at + 1).join(sep), parts }
    : null;
}

// An owner line can name several identities ("Alice, session 7"); a manifest is the plan's only when
// its whole owner equals one of them, so a manifest owned by "session" is not claimed. A manifest that
// cannot be read, or has no owner, could be the plan's, so it is reported instead of skipped.
/** @param {string} directory @param {string} owner */
function ownedScratch(directory, owner) {
  const result = { owned: /** @type {string[]} */ ([]), unreadable: /** @type {string[]} */ ([]) };
  if (!existsSync(directory)) {
    return result;
  }
  const identities = [owner, ...owner.split(/[,;]/)].map((part) => part.trim().toLowerCase());
  for (const name of readdirSync(directory)) {
    const manifest = join(directory, name, "manifest.json");
    if (!existsSync(manifest)) {
      continue;
    }
    try {
      const parsed = JSON.parse(readFileSync(manifest, "utf8"));
      if (typeof parsed.owner !== "string") {
        throw new Error("no owner");
      }
      if (identities.includes(parsed.owner.trim().toLowerCase())) {
        result.owned.push(name);
      }
    } catch {
      result.unreadable.push(manifest);
    }
  }
  return result;
}

/** @param {string} path @param {...string} args */
function git(path, ...args) {
  const run = spawnSync("git", ["-C", path, ...args], { encoding: "utf8" });
  return run.status === 0 ? run.stdout : null;
}

/**
 * @param {string} path
 * @returns {{ error: string } | { branch: string, dirty: number, unpushed: number }}
 */
function checkoutState(path) {
  const status = git(path, "status", "--porcelain=v1", "--branch");
  if (status === null) {
    return { error: `cannot read git state of ${path}` };
  }
  const [branchLine, ...changes] = status.split("\n").filter(Boolean);
  const unpushed = (git(path, "log", "--oneline", "HEAD", "--not", "--remotes") ?? "")
    .split("\n")
    .filter(Boolean);
  const branch = (branchLine ?? "").replace(/^## /, "").split(/\.\.\.| /)[0] ?? "";
  return { branch, dirty: changes.length, unpushed: unpushed.length };
}

// A name counts only as a whole token, so "main" inside "update main docs" or "/a/b" inside "/a/bc" does not.
const GENERIC_BRANCHES = ["main", "master", "HEAD", "No"];
/** @param {string} text @param {string} name */
function mentions(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\w./-])${escaped}($|[^\\w./-])`).test(text);
}

/** @param {LedgerItem} item */
function awaitsUser(item) {
  if (item.mark !== "~") {
    return false;
  }
  const trigger = item.text.match(/\btrigger:\s*(.+)$/i)?.[1];
  return USER_ONLY_TRIGGER.test(trigger?.trim().replace(/[.)\s]+$/, "") ?? "");
}

/** @param {string} resource @param {string[]} names @param {LedgerItem[]} items @param {string[]} findings */
function accountFor(resource, names, items, findings) {
  const naming = items.filter((item) => names.some((name) => mentions(item.text, name)));
  if (!naming.length) {
    findings.push(`${resource} is not named in any ledger item`);
  } else if (!naming.some((item) => item.mark === " " || item.mark === "~")) {
    const first = /** @type {LedgerItem} */ (naming[0]);
    findings.push(
      `${resource} still exists but its ledger item is ${MARKS[first.mark]} (L${first.line})`,
    );
  }
}

// The pull requests, issues and commits an item names. A bare number is looked up in `repo` only.
// A reference the line already reports as merged, landed or superseded ("fix landed in #120",
// "left out of #182") is context for a remaining part, not the item's subject, so it is skipped.
const REPORTED = /\b(?:merged?|landed|closed|superseded|left out of|squash\w*)\b/i;
/** @param {string} text @param {string | null} repo */
function references(text, repo) {
  /** @type {Set<string>} */
  const github = new Set();
  let bare = 0;
  // Only the clause around the reference counts: in "#1 merged; cleanup #2" the word belongs to #1.
  /** @param {number} offset @param {number} length */
  const reported = (offset, length) => {
    const before = text
      .slice(Math.max(0, offset - 25), offset)
      .split(/[;,()]|\.\s/)
      .at(-1);
    const after = text.slice(offset + length, offset + length + 25).split(/[;,()]|\.\s/)[0];
    return REPORTED.test(`${before} ${after}`);
  };
  let rest = text;
  for (const pattern of [GITHUB_URL, GITHUB_REF]) {
    rest = rest.replace(
      pattern,
      /** @param {string} match @param {string} owner @param {string} name @param {string} number @param {number} offset */
      (match, owner, name, number, offset) => {
        if (!reported(offset, match.length)) {
          github.add(`${owner}/${name}#${number}`);
        }
        return " ".repeat(match.length);
      },
    );
  }
  rest = rest.replace(UUID, (id) => " ".repeat(id.length));
  for (const match of rest.matchAll(BARE_REF)) {
    if (reported(match.index, match[0].length)) {
      continue;
    }
    if (repo) {
      github.add(`${repo}#${match[1]}`);
    } else {
      bare++;
    }
  }
  return { github: [...github], bare, commits: [...new Set(rest.match(COMMIT) ?? [])] };
}

/** @param {string} path */
function defaultBranch(path) {
  const head = git(path, "rev-parse", "--abbrev-ref", "origin/HEAD")?.trim();
  if (head && head !== "origin/HEAD") {
    return head;
  }
  return ["origin/main", "origin/master"].find((ref) =>
    git(path, "rev-parse", "--verify", "--quiet", ref),
  );
}

// "landed" when a checkout's default branch contains the commit, "not landed" when a checkout has it
// elsewhere, and undefined when no checkout knows it (a session id or other hex text, not a commit).
// Open items name landed commits mostly as context ("pin is still 6b5c7aef"), so a landed commit never
// marks an item finished by itself; an unlanded one keeps it off the list.
/**
 * @param {string} sha
 * @param {{ path: string, base: string | undefined }[]} checkouts
 * @returns {RefState | undefined}
 */
function commitState(sha, checkouts) {
  let state;
  for (const { path, base } of checkouts) {
    if (git(path, "rev-parse", "--verify", "--quiet", `${sha}^{commit}`) === null) {
      continue;
    }
    if (
      base &&
      spawnSync("git", ["-C", path, "merge-base", "--is-ancestor", sha, base]).status === 0
    ) {
      return { state: "landed", label: `${sha} in ${base}` };
    }
    state = { state: "not landed", label: sha };
  }
  return state;
}

/** @param {LedgerItem[]} open @param {Options} options @param {Report} report */
async function possiblyFinished(open, options, report) {
  const named = open.map((item) => ({ item, ...references(item.text, options.repo) }));
  const bare = named.reduce((total, entry) => total + entry.bare, 0);
  if (bare) {
    report.skipped.push(
      `${bare} bare pull request or issue number(s) not checked: pass --repo <owner/repo>`,
    );
  }
  const { states, skipped } = await githubStates(
    [...new Set(named.flatMap((entry) => entry.github))],
    options.offline,
  );
  if (skipped) {
    report.skipped.push(skipped);
  }
  const checkouts = options.checkouts.map((path) => ({ path, base: defaultBranch(path) }));
  /** @type {string[]} */
  const finished = [];
  for (const { item, github, bare, commits } of named) {
    if (bare) {
      continue;
    }
    /** @type {RefState[]} */
    const refs = github.map((ref) => ({
      state: states.get(ref) ?? "unknown",
      label: `${ref} ${states.get(ref) ?? "unchecked"}`,
    }));
    for (const sha of commits) {
      const commit = commitState(sha, checkouts);
      if (commit) {
        refs.push(commit);
      }
    }
    if (
      refs.some((ref) => ref.state !== "landed") &&
      refs.every((ref) => ["merged", "closed", "landed"].includes(ref.state))
    ) {
      finished.push(`${row(item)} — ${refs.map((ref) => ref.label).join(", ")}`);
    }
  }
  return finished;
}

/** @param {LedgerItem} item */
const row = (item) => `L${item.line} [${item.mark}] ${clip(item.text)}`;

/** @param {string} date @param {number} days */
function addDays(date, days) {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

// The project's last forgotten-work audit: missing, unreadable or older than AUDIT_DAYS is a warning.
/** @param {string} project @param {ReturnType<typeof notesRoot>} roots @param {string} today */
function auditWarning(project, roots, today) {
  if (!PROJECT_NAME.test(project)) {
    return `\`Project: ${clip(project, 40)}\` is not a plain project name, so its audit record was not checked`;
  }
  if (!roots) {
    return `cannot locate the audit record for ${project}: the plan is not under a plans/ directory`;
  }
  const path = join(roots.notes, "audits", project, "last-audit.json");
  if (!existsSync(path)) {
    return `no forgotten-work audit recorded for ${project} (expected ${path}); run hr-forgotten-work-audit`;
  }
  let record;
  try {
    record = JSON.parse(readFileSync(path, "utf8"));
    if (
      !validDate(record?.date) ||
      typeof record.scope !== "string" ||
      typeof record.result !== "string"
    ) {
      throw new Error();
    }
  } catch {
    return `cannot read the audit record ${path} (needs a JSON object with date YYYY-MM-DD, scope and result)`;
  }
  if (record.date > today) {
    return `the audit record ${path} is dated after today (${record.date}), so it was not counted`;
  }
  const age = Math.round((Date.parse(today) - Date.parse(record.date)) / 86_400_000);
  if (age > AUDIT_DAYS) {
    return `last forgotten-work audit for ${project} was ${record.date}, ${age} days ago (over ${AUDIT_DAYS}); run hr-forgotten-work-audit`;
  }
  return null;
}

// Long plans can carry dozens of one kind of warning; show five and count the rest.
/** @param {string[]} warnings @param {string[]} entries @param {string} kind */
function capped(warnings, entries, kind) {
  warnings.push(...entries.slice(0, 5));
  if (entries.length > 5) {
    warnings.push(`${entries.length - 5} more ${kind}`);
  }
}

/** @param {LedgerItem[]} open @param {string} today @param {string[]} warnings */
function rechecks(open, today, warnings) {
  /** @type {string[]} */
  const due = [];
  /** @type {string[]} */
  const undated = [];
  const soon = addDays(today, 7);
  for (const item of open) {
    const written = item.text.match(RECHECK)?.[1];
    if (written && !validDate(written)) {
      undated.push(`L${item.line} has \`recheck: ${written}\`, which is not a calendar date`);
      continue;
    }
    const date = written;
    if (date && date < today) {
      due.push(`${row(item)} — overdue since ${date}`);
    } else if (date && date <= soon) {
      due.push(`${row(item)} — due ${date}`);
    } else if (
      !date &&
      ((item.mark === "~" && EXTERNAL.test(item.text)) || SENT_QUESTION.test(item.text))
    ) {
      undated.push(
        `L${item.line} waits on another thread but has no \`recheck: YYYY-MM-DD\` date: ${clip(item.text, 60)}`,
      );
    }
  }
  capped(warnings, undated, "item(s) waiting on another thread without a recheck: date");
  return due;
}

// What a line names that a later line can answer: pull requests, issues, threads, offers and commits,
// compared by equality. A bare pull request number is `repo`'s when one is given.
/** @param {string} text @param {string | null} repo */
function namedThings(text, repo) {
  /** @type {Set<string>} */
  const found = new Set();
  /** @param {string} _ @param {string} owner @param {string} name @param {string} number */
  const github = (_, owner, name, number) => {
    found.add(`${owner}/${name}#${number}`.toLowerCase());
    return " ";
  };
  let rest = text.replace(GITHUB_URL, github).replace(GITHUB_REF, github);
  rest = rest.replace(THREAD_ID, (/** @type {string} */ _, /** @type {string} */ id) => {
    found.add(`thread:${id}`);
    return " ";
  });
  // Mask whole UUID-bearing IDs so removing a suffix cannot create a shared work or offer prefix.
  rest = rest.replace(UUID, " ");
  rest = rest.replace(LONG_OFFER_ID, (id) => {
    if (/\d/.test(id)) {
      found.add(`offer:${id}`);
    }
    return " ";
  });
  rest = rest.replace(WORK_ID, (id) => {
    if (/\d/.test(id) && id.includes("-")) {
      found.add(`work:${id}`);
      return " ";
    }
    return id;
  });
  for (const match of rest.matchAll(BARE_REF)) {
    found.add(repo ? `${repo}#${match[1]}`.toLowerCase() : `#${match[1]}`);
  }
  for (const [, sha = ""] of rest.matchAll(NAMED_COMMIT)) {
    found.add(`commit:${sha.slice(0, 7).toLowerCase()}`);
  }
  for (const [sha = ""] of rest.matchAll(COMMIT)) {
    if (/\d/.test(sha) && /[a-f]/.test(sha)) {
      found.add(`commit:${sha.slice(0, 7)}`);
    }
  }
  return [...found];
}

// An open or deferred line that names the same thing as a later done line: the result was probably logged
// as a new line and the old one left open. Its re-check date does not matter; a result can arrive early.
/** @param {LedgerItem[]} items @param {string | null} repo */
function resolvedLater(items, repo) {
  /** @type {Map<LedgerItem, string[]>} */
  const named = new Map(items.map((item) => [item, namedThings(item.text, repo)]));
  /** @param {LedgerItem} item */
  const tokensOf = (item) => /** @type {string[]} */ (named.get(item));
  /** @type {Map<string, number>} */
  const lines = new Map();
  for (const tokens of named.values()) {
    for (const token of tokens) {
      lines.set(token, (lines.get(token) ?? 0) + 1);
    }
  }
  /** @type {string[]} */
  const resolved = [];
  for (const item of items) {
    if (item.mark !== " " && item.mark !== "~") {
      continue;
    }
    const mine = tokensOf(item).filter(
      (token) => /** @type {number} */ (lines.get(token)) <= SHARED_TOKEN_LINES,
    );
    const later = items.filter(
      (other) =>
        other.mark === "x" &&
        other.line > item.line &&
        mine.some((token) => tokensOf(other).includes(token)),
    );
    if (!later.length) {
      continue;
    }
    const shared = [
      ...new Set(later.flatMap((other) => mine.filter((token) => tokensOf(other).includes(token)))),
    ].sort();
    resolved.push(
      `${row(item)} — ${shared.join(", ")} is named by later done line(s) ${later.map((other) => `L${other.line}`).join(", ")}`,
    );
  }
  return resolved;
}

// An answered offer must say what happened to the options the user did not pick, on its own line or on
// another ledger line that names the same offer ID.
/** @param {LedgerItem[]} items @param {string[]} warnings */
function offerWarnings(items, warnings) {
  /** @type {string[]} */
  const missing = [];
  for (const item of items) {
    if (!ANSWERED_OFFER.test(item.text) || DISPOSITION.test(item.text)) {
      continue;
    }
    const ids = new Set(item.text.match(OFFER_ID) ?? []);
    const recorded = items.some(
      (other) =>
        other !== item &&
        DISPOSITION.test(other.text) &&
        (other.text.match(OFFER_ID) ?? []).some((id) => ids.has(id)),
    );
    if (!recorded) {
      missing.push(
        `L${item.line} answered offer without the other options' outcome (not selected, deferred): ${clip(item.text, 60)}`,
      );
    }
  }
  capped(warnings, missing, "answered offer(s) without the other options' outcome");
}

// The offer IDs a line is about, leaving out one it only names as a replacement ("superseded by offer X").
/** @param {string} text */
function offersNamed(text) {
  /** @type {string[]} */
  const ids = [];
  for (const match of text.matchAll(OFFER_SUBJECT)) {
    const id = match[1] ?? "";
    if (OFFER_ID_ONLY.test(id) && !REPLACEMENT_OF.test(text.slice(0, match.index))) {
      ids.push(id);
    }
  }
  return ids;
}

// One entry per offer ID that has an open line and no line recording an answer, a drop or a supersession.
/** @param {LedgerItem[]} items */
function unansweredOffers(items) {
  /** @type {Set<string>} */
  const closed = new Set();
  for (const item of items) {
    if (item.mark === "-" || ANSWERED_OFFER.test(item.text) || DISPOSITION.test(item.text)) {
      for (const id of offersNamed(item.text)) {
        closed.add(id);
      }
    }
  }
  /** @type {Map<string, string>} */
  const unanswered = new Map();
  for (const item of items) {
    if (item.mark === " ") {
      for (const id of offersNamed(item.text)) {
        if (!closed.has(id) && !unanswered.has(id)) {
          unanswered.set(id, row(item));
        }
      }
    }
  }
  return [...unanswered.values()];
}

/** @param {Options} options */
async function run(options) {
  const planPath = resolve(/** @type {string} */ (options.plan));
  if (!existsSync(planPath) || !statSync(planPath).isFile()) {
    throw new Error(`cannot read ${options.plan}`);
  }
  const planText = readFileSync(planPath, "utf8");
  const plan = parsePlan(planText);
  /** @type {Report} */
  const report = {
    plan: planPath,
    status: plan.status ?? null,
    owner: plan.owner ?? null,
    open: [],
    awaitingUser: [],
    unansweredOffers: [],
    stale: [],
    recheckDue: [],
    resolvedLater: [],
    skipped: [],
    findings: [],
    warnings: [],
    errors: [...plan.errors],
    ...(options.sessionId
      ? {
          reconciliation: {
            version: 1,
            sessionId: options.sessionId,
            turnId: options.turnId,
            ...planSnapshot(planText),
          },
        }
      : {}),
  };
  const open = plan.items.filter((item) => item.mark === " " || item.mark === "~");
  report.open = open.map(row);
  // A plan that fails its lint still gets every check that reads only its text. The checks that read the
  // host (scratch, checkouts, the audit record, GitHub) wait until the plan is valid.
  const invalid = report.errors.length > 0;
  if (invalid) {
    report.invalidPlan = true;
    report.skipped.push(
      "scratch, checkout, audit record and GitHub checks: they wait until the plan passes its lint",
    );
  }
  report.awaitingUser = open.filter(awaitsUser).map(row);
  if (TERMINAL_STATUS.test(plan.status ?? "") && open.length) {
    report.findings.push(
      `Status says "${plan.status}" but ${open.length} ledger item(s) are open or deferred`,
    );
  }
  // Pausing is the user's choice. A plan marked paused needs a done line that records it.
  const pauseRecorded = plan.items.some(
    (item) => item.mark === "x" && PAUSE_CHOICE.test(item.text),
  );
  if (PAUSED_STATUS.test(plan.status ?? "") && !pauseRecorded) {
    report.findings.push(
      'Status is "paused" but no done ledger item records the user choosing Pause; reopen the plan and offer the close-out',
    );
  }
  // A pause the user chose stands: it is not asked again.
  report.closeOutDue =
    open.length > 0 &&
    open.every((item) => item.mark === "~") &&
    !TERMINAL_STATUS.test(plan.status ?? "") &&
    !(PAUSED_STATUS.test(plan.status ?? "") && pauseRecorded);
  const roots = notesRoot(planPath);
  const scratch = options.scratch ?? (roots ? join(roots.notes, "tmp") : null);
  if (scratch && !invalid) {
    const { owned, unreadable } = ownedScratch(scratch, plan.owner ?? "");
    for (const manifest of unreadable) {
      report.errors.push(
        `cannot read the scratch manifest ${manifest} (needs a JSON object with a string owner)`,
      );
    }
    for (const name of owned) {
      accountFor(`scratch ${name}`, [name], plan.items, report.findings);
    }
  }
  for (const path of invalid ? [] : options.checkouts) {
    const state = checkoutState(path);
    if ("error" in state) {
      report.errors.push(state.error);
    } else if (state.dirty || state.unpushed) {
      accountFor(
        `checkout ${path} (${state.dirty} changed file(s), ${state.unpushed} unpushed commit(s))`,
        [path, ...(GENERIC_BRANCHES.includes(state.branch) ? [] : [state.branch])],
        plan.items,
        report.findings,
      );
    }
  }
  // An app retires its own checkouts, so their state is reported but is not a finding.
  for (const path of invalid ? [] : options.appManaged) {
    const state = checkoutState(path);
    if ("error" in state) {
      report.errors.push(state.error);
    } else if (state.dirty || state.unpushed) {
      report.warnings.push(
        `app-managed checkout ${path} (${state.dirty} changed file(s), ${state.unpushed} unpushed commit(s)) is left for the app to retire`,
      );
    }
  }
  if (!plan.purpose) {
    report.warnings.push(
      "no `Purpose:` line in the first 40 lines (the session's purpose, one sentence)",
    );
  }
  // Every unchecked box outside the ledger is a possible lost item, so each is listed. Prose labels such
  // as "Deferred:" are listed up to five, with a count of the rest. Lines stay in file order.
  let prose = 0;
  for (const entry of plan.narrative) {
    if (entry.box || ++prose <= 5) {
      report.warnings.push(`L${entry.line} outside the ledger: ${clip(entry.text, 70)}`);
    }
  }
  if (prose > 5) {
    report.warnings.push(`${prose - 5} more narrative marker line(s)`);
  }
  offerWarnings(plan.items, report.warnings);
  const unasked = droppedByUserUnasked(plan.items).map(
    (item) =>
      `L${item.line} dropped by the user without "asked in <offer ID or message>": ${clip(item.text, 60)}`,
  );
  capped(report.warnings, unasked, "item(s) dropped by the user with no record of asking");
  report.unansweredOffers = unansweredOffers(plan.items);
  if (report.unansweredOffers.length >= OFFER_LIMIT) {
    report.warnings.push(
      `${report.unansweredOffers.length} offers are open and unanswered; the offers rule says to present no further offer at ${OFFER_LIMIT} or more. Queue the new decision in a walk-through (hr-what-next, Walk-through) instead`,
    );
  }
  const audit = !invalid && plan.project && auditWarning(plan.project, roots, options.today);
  if (audit) {
    report.warnings.push(audit);
  }
  report.recheckDue = rechecks(open, options.today, report.warnings);
  report.resolvedLater = resolvedLater(plan.items, options.repo);
  if (open.length > LEDGER_BUDGET.open) {
    report.warnings.push(
      `${open.length} open or deferred ledger lines, over the budget of ${LEDGER_BUDGET.open}: close finished lines in place with close-ledger-line.mjs and move parked ones to a backlog; offer a consolidation (references/consolidating.md)`,
    );
  }
  const kib = Math.floor(Buffer.byteLength(planText) / 1024);
  if (kib >= LEDGER_BUDGET.kib) {
    report.warnings.push(
      `the plan is ${kib} KiB, at or over the budget of ${LEDGER_BUDGET.kib} KiB: archive closed history (the plan's own completed sections and done lines) before it grows further`,
    );
  }
  if (!invalid) {
    report.stale = await possiblyFinished(open, options, report);
  }
  if (options.archive && !report.errors.length) {
    if (!COMPLETED_STATUS.test(plan.status ?? "")) {
      report.findings.push(`archiving refused: Status is "${plan.status}", not completed`);
    } else if (roots?.parts.at(-3) !== "plans") {
      report.errors.push("the plan is not at plans/<topic>/plan.md (already archived?)");
    } else if (open.length === 0 && !report.findings.length) {
      const target = join(
        roots.plans,
        "archive",
        `${basename(dirname(planPath))}-${new Date().toLocaleDateString("sv")}`,
      );
      if (existsSync(target)) {
        report.errors.push(`${target} already exists`);
      } else {
        mkdirSync(dirname(target), { recursive: true });
        renameSync(dirname(planPath), target);
        report.archived = target;
      }
    }
  }
  return report;
}

async function main() {
  let options;
  let report;
  try {
    options = parseArguments(process.argv.slice(2));
    report = await run(options);
  } catch (error) {
    console.error(/** @type {Error} */ (error).message);
    process.exit(1);
  }
  const code = report.errors.length ? 1 : report.findings.length || report.open.length ? 2 : 0;
  if (report.reconciliation) {
    Object.assign(report.reconciliation, {
      exit: code,
      errors: report.errors,
      findings: report.findings,
    });
  }
  if (options.json) {
    console.log(JSON.stringify({ exit: code, ...report }, null, 2));
  } else {
    console.log(
      `plan: ${report.plan}\nstatus: ${report.status ?? "?"} | owner: ${report.owner ?? "?"}`,
    );
    console.log(`unanswered offers: ${report.unansweredOffers.length}`);
    for (const [label, rows] of /** @type {[string, string[]][]} */ ([
      ["error", report.errors],
      ["open", report.open],
      ["awaiting your yes/no", report.awaitingUser],
      ["unanswered offer", report.unansweredOffers],
      ["possibly finished", report.stale],
      ["re-check due", report.recheckDue],
      ["possibly resolved by a later done line", report.resolvedLater],
      ["skipped", report.skipped],
      ["finding", report.findings],
      ["warning", report.warnings],
    ])) {
      for (const row of rows) {
        console.log(`${label}: ${row}`);
      }
    }
    if (report.archived) {
      console.log(`archived: ${report.archived}`);
    }
    if (report.closeOutDue) {
      console.log(
        "close-out due: every remaining item is deferred. Ask the user about each one in its own question (do it now, hand it to an owner, or drop it) and record 'asked in <offer ID>' on its line; offer All done or Pause only once every item has been asked, and do not mark the plan paused yourself",
      );
    }
    console.log(
      code === 0
        ? "result: nothing open"
        : code === 1
          ? `result: invalid input${report.invalidPlan ? " (the checks that read only the plan text still ran)" : ""}`
          : `result: ${report.open.length} open item(s) (${report.awaitingUser.length} awaiting your yes/no), ${report.findings.length} finding(s)`,
    );
  }
  process.exit(code);
}

if (
  process.argv[1] &&
  existsSync(process.argv[1]) &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  await main();
}
