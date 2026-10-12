// Checks the file:line citations in a panel's output against the repository.
// See ../references/panel-adjudication.md.
import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const EXT =
  "(?:tsx?|jsx?|mjs|cjs|vue|svelte|css|scss|html|md|json|py|sh|yaml|yml|toml|go|rs|rb|java|kt|swift|php|cs|cpp|c|h)";
const STRICT_RE = new RegExp(
  "`([^`\\n]{1,80})`\\s*\\(\\s*([\\w./\\\\-]+\\." +
    EXT +
    ")\\s*:\\s*(\\d+)(?:\\s*-\\s*(\\d+))?\\s*\\)",
  "g",
);
const BARE_RE = new RegExp("([\\w./\\\\-]+\\." + EXT + "):(\\d+)(?:-(\\d+))?", "g");

// Panel logs are either plain text or JSON lines whose text parts hold the reply.
export function extractPanelText(raw) {
  const texts = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }
    try {
      walk(JSON.parse(trimmed), texts);
    } catch {
      // Not JSON; ignore the line.
    }
  }
  // A plain reply may contain a JSON example line; with no text parts, keep the raw text.
  return texts.length === 0 ? raw : texts.join("");
}

function walk(node, out) {
  if (Array.isArray(node)) {
    for (const item of node) {
      walk(item, out);
    }
    return;
  }
  if (node && typeof node === "object") {
    const { type, text } = node;
    if ((type === "text" || type === "text-delta") && typeof text === "string") {
      out.push(text);
    }
    for (const value of Object.values(node)) {
      walk(value, out);
    }
  }
}

export function findCitations(text) {
  const found = [];
  const strictSpans = [];
  for (const match of text.matchAll(STRICT_RE)) {
    strictSpans.push([match.index, match.index + match[0].length]);
    found.push({
      ident: match[1],
      file: match[2],
      start: Number(match[3]),
      end: Number(match[4] ?? match[3]),
      strict: true,
    });
  }
  for (const match of text.matchAll(BARE_RE)) {
    const at = match.index;
    if (strictSpans.some(([from, to]) => at >= from && at < to)) {
      continue;
    }
    found.push({
      ident: null,
      file: match[1],
      start: Number(match[2]),
      end: Number(match[3] ?? match[2]),
      strict: false,
    });
  }
  return found;
}

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "coverage"]);

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

const indexCache = new Map();

// Models cite basenames (`util.ts:97`) or subpaths (`src/util.ts:97`). Resolve those against
// the repository tree: one match wins, none fails as unreadable, several fail as ambiguous.
function resolveByBasename(cited, repoRoot) {
  if (!indexCache.has(repoRoot)) {
    const index = [];
    const walkDir = (dir) => {
      let entries;
      try {
        entries = readdirSync(dir);
      } catch {
        return;
      }
      for (const entry of entries) {
        if (SKIP_DIRS.has(entry)) {
          continue;
        }
        const full = join(dir, entry);
        let stat;
        try {
          stat = statSync(full);
        } catch {
          continue;
        }
        if (stat.isDirectory()) {
          walkDir(full);
        } else if (stat.isFile()) {
          index.push(full);
        }
      }
    };
    walkDir(repoRoot);
    indexCache.set(repoRoot, index);
  }
  const normalized = cited.split(/[\\/]/).join("/");
  const suffix = `/${normalized}`;
  const matches = indexCache
    .get(repoRoot)
    .filter((path) => basename(path) === normalized || path.split(sep).join("/").endsWith(suffix));
  if (matches.length === 1) {
    return matches[0];
  }
  return matches.length > 1 ? matches : null;
}

export function checkCitation(citation, repoRoot) {
  const direct = isAbsolute(citation.file) ? citation.file : resolve(repoRoot, citation.file);
  const path = isFile(direct) ? direct : resolveByBasename(citation.file, repoRoot);
  if (path === null) {
    return { ...citation, path: direct, status: "fail", reason: "unreadable: ENOENT" };
  }
  // Compare real paths so a symlink inside the repository cannot lead outside it.
  let checkedPath = path;
  if (typeof path === "string") {
    try {
      checkedPath = realpathSync(path);
      const away = relative(realpathSync(repoRoot), checkedPath);
      if (away === ".." || away.startsWith(`..${sep}`) || isAbsolute(away)) {
        return { ...citation, path, status: "fail", reason: "outside the repository" };
      }
    } catch (error) {
      return {
        ...citation,
        path,
        status: "fail",
        reason: `unreadable: ${error.code ?? String(error)}`,
      };
    }
  }
  if (Array.isArray(path)) {
    return {
      ...citation,
      path: direct,
      status: "fail",
      reason: `ambiguous: ${path.length} matches`,
    };
  }
  let lines;
  try {
    lines = readFileSync(checkedPath, "utf8").split("\n");
    // A final newline ends the last line; it does not start another.
    if (lines.length > 1 && lines.at(-1) === "") {
      lines.pop();
    }
  } catch (error) {
    return {
      ...citation,
      path,
      status: "fail",
      reason: `unreadable: ${error.code ?? String(error)}`,
    };
  }
  if (!(citation.start >= 1) || citation.end < citation.start) {
    return { ...citation, path, status: "fail", reason: "bad line range" };
  }
  if (citation.end > lines.length) {
    return {
      ...citation,
      path,
      status: "fail",
      reason: `line ${citation.end} past EOF (${lines.length} lines)`,
    };
  }
  if (citation.ident === null) {
    return { ...citation, path, status: "pass", reason: "exists" };
  }
  const window = lines.slice(citation.start - 1, citation.end).join("\n");
  if (!window.includes(citation.ident)) {
    const range =
      citation.end === citation.start ? `${citation.start}` : `${citation.start}-${citation.end}`;
    return {
      ...citation,
      path,
      status: "fail",
      reason: `line ${range} lacks '${citation.ident}'`,
    };
  }
  return { ...citation, path, status: "pass", reason: "cited" };
}

export function checkLogs(files, repoRoot) {
  const results = [];
  for (const file of files) {
    const text = extractPanelText(readFileSync(file, "utf8"));
    for (const citation of findCitations(text)) {
      results.push({ log: file, ...checkCitation(citation, repoRoot) });
    }
  }
  return results;
}

function main(argv) {
  const json = argv.includes("--json");
  const repoFlag = argv.indexOf("--repo");
  const repoRoot = repoFlag >= 0 ? resolve(argv[repoFlag + 1] ?? ".") : process.cwd();
  const files = argv.filter(
    (arg, i) => arg !== "--json" && arg !== "--repo" && argv[i - 1] !== "--repo",
  );
  if (files.length === 0) {
    console.error("Usage: check-receipts.mjs [--repo <dir>] [--json] <panel-log> [more...]");
    return 2;
  }
  let results;
  try {
    results = checkLogs(files, repoRoot);
  } catch (error) {
    console.error(`Cannot read a panel log: ${error.message}`);
    return 2;
  }
  if (results.length === 0) {
    console.error("No citations found.");
    return 2;
  }
  if (json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    for (const row of results) {
      const label = row.strict
        ? `\`${row.ident}\` (${row.file}:${row.start})`
        : `${row.file}:${row.start}`;
      console.log(`${row.status === "pass" ? "PASS" : "FAIL"} ${label} - ${row.reason}`);
    }
    const failed = results.filter((row) => row.status === "fail").length;
    console.log(`${results.length - failed}/${results.length} citations verified.`);
  }
  return results.some((row) => row.status === "fail") ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
