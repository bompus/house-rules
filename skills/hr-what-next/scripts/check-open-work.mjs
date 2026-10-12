#!/usr/bin/env node
// Open-work check for a session plan: lists what is still open before anyone says
// "nothing remains" or archives the plan. See ../SKILL.md and the plan-files rule.
// Exit 0: nothing open; 1: invalid input; 2: open work remains or archiving refused.
// "awaiting your yes/no" lists the deferred items whose trigger is only the user's own action
// ("user selects", "user's decision", "user asks for the backlog"): they were deferred, not decided,
// so the user still owes a yes, a no or a trigger other than their own. The match is a heuristic on the
// trigger text, which must be the user plus a verb such as selects, picks, decides, asks or approves and
// at most a short object ("it", "the backlog"); a trigger with a date, event or another condition
// stays an ordinary deferred item. The group is a subset of `open` and does not change the exit code.
// "possibly finished" lists open or deferred items whose every named pull request or issue is merged or
// closed on GitHub: done work left open, or a trigger that has fired. A named commit that a --checkout has
// outside its default branch keeps the item off the list. Bare numbers ("PR #4") are looked up only in
// --repo. The check needs `gh`; without it, offline, or with --offline it is skipped and "skipped" says so.
// "re-check due" lists items whose `recheck: YYYY-MM-DD` date is past or within 7 days. Both groups are
// subsets of `open` and do not change the exit code.
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
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";

const usage =
  "usage: check-open-work.mjs <plan.md> [--checkout <path>]... [--app-managed <path>]... [--scratch <dir>] [--repo <owner/repo>] [--offline] [--today <YYYY-MM-DD>] [--archive] [--json]\n" +
  'The output lists deferred items whose trigger is only the user\'s own action ("user selects", "user asks for the backlog") as "awaiting your yes/no"; this is a text match, see the header.';
const TERMINAL_STATUS = /^(completed?|done|archived)\b/i;
const COMPLETED_STATUS = /^completed\b/i;
const MARKS = { " ": "open", "~": "deferred", x: "done", "-": "dropped" };
const REQUIRED = {
  "~": ["trigger", "a trigger"],
  x: ["evidence", "evidence"],
  "-": ["by", "who dropped it"],
};
const USER_ONLY_TRIGGER =
  /^(?:when |once |until )?(?:the )?user(?:'s)?\s+(?:select\w*|pick\w*|choos\w*|decid\w*|decision|choice|answer\w*|direction|approv\w*|ask\w*|say\w*|request\w*)(?:\s+(?:for |to )?(?:it|this|them|that|one|the backlog|the item|a decision))?$/i;
const NARRATIVE =
  /^\s*(?:[-*]\s+|#+\s+)?\**(pending|waiting|deferred|blocked-on-user|blocked-by|todo|follow-?ups?)\b/i;
// A labelled follow-up inside a prose sentence ("Merged. Deferred: the listing", "Still open for later: x").
const PROSE_MARKER =
  /(?:^|[.;!?]\s+|\*\*)\s*(?:follow-?ups?|deferred|todo|(?:still )?open for later)\**\s*:/i;
// An offer line that records an answer, and words that say what happened to the other options.
const ANSWERED_OFFER =
  /\boffer\b.*\b(?:selected|chose|picked|answered)\b|\b(?:selected|chose|picked|answered)\b.*\boffer\b|\boffer\b.*\buser (?:reply|go)\b/i;
// "deferred" and "dropped" count only next to an option code ("1B deferred"), since a line can defer
// something else ("rollout deferred until the release").
const DISPOSITION =
  /not selected|unselected|unpicked|declined|superseded|passed over|only option|all selected|no other options?|\b\d+[a-z]\b[^.;]{0,30}\b(?:deferred|dropped)\b|\b(?:deferred|dropped)\b[^.;]{0,15}\b\d+[a-z]\b/i;
const OFFER_ID = /\b[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+\b/g;
// An ID right after the word "offer": the offer the line is about. The ID is checked against OFFER_ID's
// shape afterwards because the word "offer" is matched in any case.
const OFFER_SUBJECT = /\boffer\b[^\w]{0,3}([\w-]+)/gi;
const OFFER_ID_ONLY = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/;
const REPLACEMENT_OF = /\b(?:by|into|with|under|behind|after)\s+(?:the\s+)?$/i;
// The offers rule stops presenting new offers at this many open and unanswered ones.
const OFFER_LIMIT = 3;
// A deferred item that waits on another thread (an upstream issue or pull request, a maintainer, another
// session), or an open question sent to one, needs a `recheck:` date: "trigger: reply" never fires itself.
const EXTERNAL =
  /https:\/\/github\.com\/|\b[\w.-]+\/[\w.-]+#\d+|\bPR\s*#?\s*\d+|(?<![\w/#&])#\d+\b|\bupstream\b|\bmaintainers?\b|\b(?:another|other|the [\w-]+) (?:session|thread)\b/i;
const SENT_QUESTION =
  /\b(?:asked|relayed|sent)\b.*\b(?:session|thread|owner|maintainer)s?\b|\b(?:awaiting|waiting (?:on|for)) (?:a |the )?(?:reply|answer|response)\b/i;
const RECHECK = /\brecheck:\s*(\d{4}-\d{2}-\d{2})/i;
const GITHUB_URL = /https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(?:pull|issues)\/(\d+)/g;
const GITHUB_REF = /(?<![\w./-])([\w.-]+)\/([\w.-]+)#(\d+)\b/g;
const BARE_REF = /(?:\bPR\s*#?\s*|(?<![\w/#&])#)(\d{1,6})\b/gi;
const COMMIT = /\b[0-9a-f]{7,40}\b/g;
// Monthly: items in a full audit were lost within two to four weeks of being promised.
const AUDIT_DAYS = 30;
const PROJECT_NAME = /^\w[\w.-]*$/;
// A real calendar date: "2026-02-31" has the shape but not the round trip.
function validDate(value) {
  const date = new Date(`${value}T00:00:00Z`);
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

function parseArguments(argv) {
  const options = {
    plan: null,
    checkouts: [],
    appManaged: [],
    scratch: null,
    repo: null,
    offline: false,
    today: new Date().toLocaleDateString("sv"),
    archive: false,
    json: false,
  };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--archive") options.archive = true;
    else if (argument === "--json") options.json = true;
    else if (argument === "--offline") options.offline = true;
    else if (["--checkout", "--app-managed", "--scratch", "--repo", "--today"].includes(argument)) {
      const value = argv[++index];
      if (!value) throw new Error(`${argument} needs a value\n${usage}`);
      if (argument === "--checkout") options.checkouts.push(value);
      else if (argument === "--app-managed") options.appManaged.push(value);
      else if (argument === "--repo") {
        if (!/^[\w.-]+\/[\w.-]+$/.test(value)) throw new Error(`--repo needs owner/repo\n${usage}`);
        options.repo = value;
      } else if (argument === "--today") {
        if (!validDate(value)) throw new Error(`--today needs YYYY-MM-DD\n${usage}`);
        options.today = value;
      } else options.scratch = value;
    } else if (argument.startsWith("--") || options.plan) throw new Error(usage);
    else options.plan = argument;
  }
  if (!options.plan) throw new Error(usage);
  return options;
}

const clip = (text, length = 90) => (text.length > length ? `${text.slice(0, length - 1)}…` : text);

function readPlan(path) {
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  const header = lines.slice(0, 40);
  const field = (name) =>
    header
      .map((line) => line.match(new RegExp(`^\\s*(?:\\*\\*)?${name}:?(?:\\*\\*)?:?\\s*(.+)$`, "i")))
      .find(Boolean)?.[1]
      .trim();
  const errors = [];
  const status = field("Status");
  const owner = field("Owner");
  const purpose = field("Purpose");
  // Only an exact `Project:` field: "Project URL: ..." is a different header.
  const project = header
    .map((line) => line.match(/^\s*(?:\*\*)?Project(?:\*\*)?:(?:\*\*)?\s*(.+)$/i))
    .find(Boolean)?.[1]
    .trim();
  if (!status) errors.push("no `Status:` line in the first 40 lines");
  if (!owner) errors.push("no `Owner:` line in the first 40 lines");
  const start = lines.findIndex((line) => /^#{1,6}\s+Ledger\s*$/i.test(line));
  if (start < 0) errors.push("no `## Ledger` section");
  let end = lines.length;
  if (start >= 0) {
    const level = lines[start].match(/^#+/)[0].length;
    const next = lines.findIndex(
      (line, i) => i > start && new RegExp(`^#{1,${level}}\\s`).test(line),
    );
    if (next >= 0) end = next;
  }
  const items = [];
  for (let i = start + 1; start >= 0 && i < end; i++) {
    const match = lines[i].match(/^\s*[-*]\s+\[([ x~-])\]\s+(.*)$/i);
    if (match) {
      items.push({ line: i + 1, mark: match[1].toLowerCase(), text: match[2] });
    } else if (items.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*[-*]\s/.test(lines[i])) {
      items[items.length - 1].text += ` ${lines[i].trim()}`;
    }
  }
  if (start >= 0 && !items.length)
    errors.push("the ledger has no items (`- [ ] ...`, `- [~] ...`, `- [x] ...`, `- [-] ...`)");
  for (const item of items) {
    const required = REQUIRED[item.mark];
    if (required && !new RegExp(`\\b${required[0]}:\\s*\\S`, "i").test(item.text))
      errors.push(
        `L${item.line}: a ${MARKS[item.mark]} item needs \`${required[0]}:\` (${required[1]})`,
      );
  }
  const narrative = [];
  lines.forEach((line, i) => {
    const inLedger = start >= 0 && i > start && i < end;
    if (
      !inLedger &&
      i > 0 &&
      (NARRATIVE.test(line) || PROSE_MARKER.test(line) || /^\s*[-*]\s+\[[ ~]\]/.test(line))
    )
      narrative.push({ line: i + 1, text: line.trim() });
  });
  return { status, owner, purpose, project, items, errors, narrative };
}

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
function ownedScratch(directory, owner) {
  const result = { owned: [], unreadable: [] };
  if (!existsSync(directory)) return result;
  const identities = [owner, ...owner.split(/[,;]/)].map((part) => part.trim().toLowerCase());
  for (const name of readdirSync(directory)) {
    const manifest = join(directory, name, "manifest.json");
    if (!existsSync(manifest)) continue;
    try {
      const parsed = JSON.parse(readFileSync(manifest, "utf8"));
      if (typeof parsed.owner !== "string") throw new Error("no owner");
      if (identities.includes(parsed.owner.trim().toLowerCase())) result.owned.push(name);
    } catch {
      result.unreadable.push(manifest);
    }
  }
  return result;
}

function git(path, ...args) {
  const run = spawnSync("git", ["-C", path, ...args], { encoding: "utf8" });
  return run.status === 0 ? run.stdout : null;
}

function checkoutState(path) {
  const status = git(path, "status", "--porcelain=v1", "--branch");
  if (status === null) return { error: `cannot read git state of ${path}` };
  const [branchLine, ...changes] = status.split("\n").filter(Boolean);
  const unpushed = (git(path, "log", "--oneline", "HEAD", "--not", "--remotes") ?? "")
    .split("\n")
    .filter(Boolean);
  const branch = branchLine.replace(/^## /, "").split(/\.\.\.| /)[0];
  return { branch, dirty: changes.length, unpushed: unpushed.length };
}

// A name counts only as a whole token, so "main" inside "update main docs" or "/a/b" inside "/a/bc" does not.
const GENERIC_BRANCHES = ["main", "master", "HEAD", "No"];
function mentions(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\w./-])${escaped}($|[^\\w./-])`).test(text);
}

function awaitsUser(item) {
  if (item.mark !== "~") return false;
  const trigger = item.text.match(/\btrigger:\s*(.+)$/i)?.[1];
  return USER_ONLY_TRIGGER.test(trigger?.trim().replace(/[.)\s]+$/, "") ?? "");
}

function accountFor(resource, names, items, findings) {
  const naming = items.filter((item) => names.some((name) => mentions(item.text, name)));
  if (!naming.length) findings.push(`${resource} is not named in any ledger item`);
  else if (!naming.some((item) => item.mark === " " || item.mark === "~"))
    findings.push(
      `${resource} still exists but its ledger item is ${MARKS[naming[0].mark]} (L${naming[0].line})`,
    );
}

// The pull requests, issues and commits an item names. A bare number is looked up in `repo` only.
// A reference the line already reports as merged, landed or superseded ("fix landed in #120",
// "left out of #182") is context for a remaining part, not the item's subject, so it is skipped.
const REPORTED = /\b(?:merged?|landed|closed|superseded|left out of|squash\w*)\b/i;
function references(text, repo) {
  const github = new Set();
  let bare = 0;
  // Only the clause around the reference counts: in "#1 merged; cleanup #2" the word belongs to #1.
  const reported = (offset, length) => {
    const before = text
      .slice(Math.max(0, offset - 25), offset)
      .split(/[;,()]|\.\s/)
      .at(-1);
    const after = text.slice(offset + length, offset + length + 25).split(/[;,()]|\.\s/)[0];
    return REPORTED.test(`${before} ${after}`);
  };
  let rest = text;
  for (const pattern of [GITHUB_URL, GITHUB_REF])
    rest = rest.replace(pattern, (match, owner, name, number, offset) => {
      if (!reported(offset, match.length)) github.add(`${owner}/${name}#${number}`);
      return " ".repeat(match.length);
    });
  for (const match of rest.matchAll(BARE_REF)) {
    if (reported(match.index, match[0].length)) continue;
    if (repo) github.add(`${repo}#${match[1]}`);
    else bare++;
  }
  return { github: [...github], bare, commits: [...new Set(rest.match(COMMIT) ?? [])] };
}

function gh(...args) {
  return new Promise((done) => {
    let stdout = "";
    let stderr = "";
    const child = spawn("gh", args, { timeout: 30_000 });
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) =>
      done({ error: error.code === "ENOENT" ? "gh not found" : error.message }),
    );
    child.on("close", (code) =>
      done(code === 0 ? { stdout } : { error: stderr.trim() || `gh exit ${code}` }),
    );
  });
}

// "merged", "closed", "open" or "unknown" (not found) per reference; null when GitHub cannot be asked.
async function githubStates(refs, offline) {
  const states = new Map();
  if (!refs.length) return { states };
  if (offline) return { states, skipped: "GitHub check skipped: --offline" };
  const lookup = async (ref) => {
    const [, owner, name, number] = ref.match(/^(.+)\/(.+)#(\d+)$/);
    const result = await gh("api", `repos/${owner}/${name}/issues/${number}`);
    if (result.error) {
      if (/\b404\b|not found/i.test(result.error) && result.error !== "gh not found")
        return states.set(ref, "unknown");
      throw new Error(result.error.split("\n")[0]);
    }
    const issue = JSON.parse(result.stdout);
    states.set(ref, issue.pull_request?.merged_at ? "merged" : issue.state);
  };
  try {
    // The first lookup runs alone, so an offline host or a missing gh costs one call, not one per item.
    await lookup(refs[0]);
    const queue = refs.slice(1);
    await Promise.all(
      Array.from({ length: 8 }, async () => {
        while (queue.length) await lookup(queue.shift());
      }),
    );
  } catch (error) {
    return { states: new Map(), skipped: `GitHub check skipped: ${error.message}` };
  }
  return { states };
}

function defaultBranch(path) {
  const head = git(path, "rev-parse", "--abbrev-ref", "origin/HEAD")?.trim();
  if (head && head !== "origin/HEAD") return head;
  return ["origin/main", "origin/master"].find((ref) =>
    git(path, "rev-parse", "--verify", "--quiet", ref),
  );
}

// "landed" when a checkout's default branch contains the commit, "not landed" when a checkout has it
// elsewhere, and undefined when no checkout knows it (a session id or other hex text, not a commit).
// Open items name landed commits mostly as context ("pin is still 6b5c7aef"), so a landed commit never
// marks an item finished by itself; an unlanded one keeps it off the list.
function commitState(sha, checkouts) {
  let state;
  for (const { path, base } of checkouts) {
    if (git(path, "rev-parse", "--verify", "--quiet", `${sha}^{commit}`) === null) continue;
    if (
      base &&
      spawnSync("git", ["-C", path, "merge-base", "--is-ancestor", sha, base]).status === 0
    )
      return { state: "landed", label: `${sha} in ${base}` };
    state = { state: "not landed", label: sha };
  }
  return state;
}

async function possiblyFinished(open, options, report) {
  const named = open.map((item) => ({ item, ...references(item.text, options.repo) }));
  const bare = named.reduce((total, entry) => total + entry.bare, 0);
  if (bare)
    report.skipped.push(
      `${bare} bare pull request or issue number(s) not checked: pass --repo <owner/repo>`,
    );
  const { states, skipped } = await githubStates(
    [...new Set(named.flatMap((entry) => entry.github))],
    options.offline,
  );
  if (skipped) report.skipped.push(skipped);
  const checkouts = options.checkouts.map((path) => ({ path, base: defaultBranch(path) }));
  const finished = [];
  for (const { item, github, bare, commits } of named) {
    if (bare) continue;
    const refs = github.map((ref) => ({
      state: states.get(ref) ?? "unknown",
      label: `${ref} ${states.get(ref) ?? "unchecked"}`,
    }));
    for (const sha of commits) {
      const commit = commitState(sha, checkouts);
      if (commit) refs.push(commit);
    }
    if (
      refs.some((ref) => ref.state !== "landed") &&
      refs.every((ref) => ["merged", "closed", "landed"].includes(ref.state))
    )
      finished.push(`${row(item)} — ${refs.map((ref) => ref.label).join(", ")}`);
  }
  return finished;
}

const row = (item) => `L${item.line} [${item.mark}] ${clip(item.text)}`;

function addDays(date, days) {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

// The project's last forgotten-work audit: missing, unreadable or older than AUDIT_DAYS is a warning.
function auditWarning(project, roots, today) {
  if (!PROJECT_NAME.test(project))
    return `\`Project: ${clip(project, 40)}\` is not a plain project name, so its audit record was not checked`;
  if (!roots)
    return `cannot locate the audit record for ${project}: the plan is not under a plans/ directory`;
  const path = join(roots.notes, "audits", project, "last-audit.json");
  if (!existsSync(path))
    return `no forgotten-work audit recorded for ${project} (expected ${path}); run hr-forgotten-work-audit`;
  let record;
  try {
    record = JSON.parse(readFileSync(path, "utf8"));
    if (
      !validDate(record?.date) ||
      typeof record.scope !== "string" ||
      typeof record.result !== "string"
    )
      throw new Error();
  } catch {
    return `cannot read the audit record ${path} (needs a JSON object with date YYYY-MM-DD, scope and result)`;
  }
  if (record.date > today)
    return `the audit record ${path} is dated after today (${record.date}), so it was not counted`;
  const age = Math.round((Date.parse(today) - Date.parse(record.date)) / 86_400_000);
  if (age > AUDIT_DAYS)
    return `last forgotten-work audit for ${project} was ${record.date}, ${age} days ago (over ${AUDIT_DAYS}); run hr-forgotten-work-audit`;
  return null;
}

// Long plans can carry dozens of one kind of warning; show five and count the rest.
function capped(warnings, entries, kind) {
  warnings.push(...entries.slice(0, 5));
  if (entries.length > 5) warnings.push(`${entries.length - 5} more ${kind}`);
}

function rechecks(open, today, warnings) {
  const due = [];
  const undated = [];
  const soon = addDays(today, 7);
  for (const item of open) {
    const written = item.text.match(RECHECK)?.[1];
    if (written && !validDate(written)) {
      undated.push(`L${item.line} has \`recheck: ${written}\`, which is not a calendar date`);
      continue;
    }
    const date = written;
    if (date && date < today) due.push(`${row(item)} — overdue since ${date}`);
    else if (date && date <= soon) due.push(`${row(item)} — due ${date}`);
    else if (
      !date &&
      ((item.mark === "~" && EXTERNAL.test(item.text)) || SENT_QUESTION.test(item.text))
    )
      undated.push(
        `L${item.line} waits on another thread but has no \`recheck: YYYY-MM-DD\` date: ${clip(item.text, 60)}`,
      );
  }
  capped(warnings, undated, "item(s) waiting on another thread without a recheck: date");
  return due;
}

// An answered offer must say what happened to the options the user did not pick, on its own line or on
// another ledger line that names the same offer ID.
function offerWarnings(items, warnings) {
  const missing = [];
  for (const item of items) {
    if (!ANSWERED_OFFER.test(item.text) || DISPOSITION.test(item.text)) continue;
    const ids = new Set(item.text.match(OFFER_ID) ?? []);
    const recorded = items.some(
      (other) =>
        other !== item &&
        DISPOSITION.test(other.text) &&
        (other.text.match(OFFER_ID) ?? []).some((id) => ids.has(id)),
    );
    if (!recorded)
      missing.push(
        `L${item.line} answered offer without the other options' outcome (not selected, deferred): ${clip(item.text, 60)}`,
      );
  }
  capped(warnings, missing, "answered offer(s) without the other options' outcome");
}

// The offer IDs a line is about, leaving out one it only names as a replacement ("superseded by offer X").
function offersNamed(text) {
  const ids = [];
  for (const match of text.matchAll(OFFER_SUBJECT)) {
    if (OFFER_ID_ONLY.test(match[1]) && !REPLACEMENT_OF.test(text.slice(0, match.index)))
      ids.push(match[1]);
  }
  return ids;
}

// One entry per offer ID that has an open line and no line recording an answer, a drop or a supersession.
function unansweredOffers(items) {
  const closed = new Set();
  for (const item of items)
    if (item.mark === "-" || ANSWERED_OFFER.test(item.text) || DISPOSITION.test(item.text))
      for (const id of offersNamed(item.text)) closed.add(id);
  const unanswered = new Map();
  for (const item of items)
    if (item.mark === " ")
      for (const id of offersNamed(item.text))
        if (!closed.has(id) && !unanswered.has(id)) unanswered.set(id, row(item));
  return [...unanswered.values()];
}

async function run(options) {
  const planPath = resolve(options.plan);
  if (!existsSync(planPath) || !statSync(planPath).isFile())
    throw new Error(`cannot read ${options.plan}`);
  const plan = readPlan(planPath);
  const report = {
    plan: planPath,
    status: plan.status ?? null,
    owner: plan.owner ?? null,
    open: [],
    awaitingUser: [],
    unansweredOffers: [],
    stale: [],
    recheckDue: [],
    skipped: [],
    findings: [],
    warnings: [],
    errors: [...plan.errors],
  };
  if (report.errors.length) return report;
  const open = plan.items.filter((item) => item.mark === " " || item.mark === "~");
  report.open = open.map(row);
  report.awaitingUser = open.filter(awaitsUser).map(row);
  if (TERMINAL_STATUS.test(plan.status) && open.length)
    report.findings.push(
      `Status says "${plan.status}" but ${open.length} ledger item(s) are open or deferred`,
    );
  const roots = notesRoot(planPath);
  const scratch = options.scratch ?? (roots ? join(roots.notes, "tmp") : null);
  if (scratch) {
    const { owned, unreadable } = ownedScratch(scratch, plan.owner);
    for (const manifest of unreadable)
      report.errors.push(
        `cannot read the scratch manifest ${manifest} (needs a JSON object with a string owner)`,
      );
    for (const name of owned) accountFor(`scratch ${name}`, [name], plan.items, report.findings);
  }
  for (const path of options.checkouts) {
    const state = checkoutState(path);
    if (state.error) report.errors.push(state.error);
    else if (state.dirty || state.unpushed)
      accountFor(
        `checkout ${path} (${state.dirty} changed file(s), ${state.unpushed} unpushed commit(s))`,
        [path, ...(GENERIC_BRANCHES.includes(state.branch) ? [] : [state.branch])],
        plan.items,
        report.findings,
      );
  }
  // An app retires its own checkouts, so their state is reported but is not a finding.
  for (const path of options.appManaged) {
    const state = checkoutState(path);
    if (state.error) report.errors.push(state.error);
    else if (state.dirty || state.unpushed)
      report.warnings.push(
        `app-managed checkout ${path} (${state.dirty} changed file(s), ${state.unpushed} unpushed commit(s)) is left for the app to retire`,
      );
  }
  if (!plan.purpose)
    report.warnings.push(
      "no `Purpose:` line in the first 40 lines (the session's purpose, one sentence)",
    );
  for (const entry of plan.narrative.slice(0, 5))
    report.warnings.push(`L${entry.line} outside the ledger: ${clip(entry.text, 70)}`);
  if (plan.narrative.length > 5)
    report.warnings.push(`${plan.narrative.length - 5} more narrative marker line(s)`);
  offerWarnings(plan.items, report.warnings);
  report.unansweredOffers = unansweredOffers(plan.items);
  if (report.unansweredOffers.length >= OFFER_LIMIT)
    report.warnings.push(
      `${report.unansweredOffers.length} offers are open and unanswered; the offers rule says to present no further offer at ${OFFER_LIMIT} or more. Queue the new decision in a walk-through (hr-what-next, Walk-through) instead`,
    );
  const audit = plan.project && auditWarning(plan.project, roots, options.today);
  if (audit) report.warnings.push(audit);
  report.recheckDue = rechecks(open, options.today, report.warnings);
  report.stale = await possiblyFinished(open, options, report);
  if (options.archive && !report.errors.length) {
    if (!COMPLETED_STATUS.test(plan.status))
      report.findings.push(`archiving refused: Status is "${plan.status}", not completed`);
    else if (roots?.parts.at(-3) !== "plans")
      report.errors.push("the plan is not at plans/<topic>/plan.md (already archived?)");
    else if (open.length === 0 && !report.findings.length) {
      const target = join(
        roots.plans,
        "archive",
        `${basename(dirname(planPath))}-${new Date().toLocaleDateString("sv")}`,
      );
      if (existsSync(target)) report.errors.push(`${target} already exists`);
      else {
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
    console.error(error.message);
    process.exit(1);
  }
  const code = report.errors.length ? 1 : report.findings.length || report.open.length ? 2 : 0;
  if (options.json) console.log(JSON.stringify({ exit: code, ...report }, null, 2));
  else {
    console.log(
      `plan: ${report.plan}\nstatus: ${report.status ?? "?"} | owner: ${report.owner ?? "?"}`,
    );
    if (code !== 1) console.log(`unanswered offers: ${report.unansweredOffers.length}`);
    for (const [label, rows] of [
      ["error", report.errors],
      ["open", report.open],
      ["awaiting your yes/no", report.awaitingUser],
      ["unanswered offer", report.unansweredOffers],
      ["possibly finished", report.stale],
      ["re-check due", report.recheckDue],
      ["skipped", report.skipped],
      ["finding", report.findings],
      ["warning", report.warnings],
    ])
      for (const row of rows) console.log(`${label}: ${row}`);
    if (report.archived) console.log(`archived: ${report.archived}`);
    console.log(
      code === 0
        ? "result: nothing open"
        : code === 1
          ? "result: invalid input"
          : `result: ${report.open.length} open item(s) (${report.awaitingUser.length} awaiting your yes/no), ${report.findings.length} finding(s)`,
    );
  }
  process.exit(code);
}

await main();
