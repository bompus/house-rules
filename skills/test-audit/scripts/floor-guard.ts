#!/usr/bin/env bun
// Flag changes that make tests or checkers easier to pass: new suppression
// comments, added skips or `.only`, deleted test files, and assertions removed
// from test files that still exist. Diff-scoped: merge base to working tree,
// untracked files included. Tightening is silent; only loosening is reported.
//   bun floor-guard.ts [--base <ref>]   (default: origin/HEAD, then origin/main)
// Exit 0 clean, 1 findings, 2 the guard could not run. Never read 2 as clean.
// Adapted from addyosmani/agent-skills constraint-driven-development
// references/floor-guard.md (MIT).
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

export type Finding = { rule: string; file: string; text: string };

const SUPPRESSIONS =
  /@ts-ignore|@ts-nocheck|@ts-expect-error|eslint-disable|oxlint-disable|biome-ignore|#\s*noqa|#\s*type:\s*ignore|istanbul ignore|c8 ignore|nosemgrep|gitleaks:allow|Stryker disable/;
const SKIPS =
  /\.(skip|todo|only)\s*\(|\b(xit|xdescribe|xtest)\s*\(|@pytest\.mark\.(skip|xfail)|\bt\.Skip\(/;
const ASSERTION = /\b(expect|assert\w*|should)\b/;

export function isTestFile(path: string): boolean {
  return /\.(test|spec)\.[^/]+$|_test\.[^/]+$|(^|\/)test_[^/]+$|(^|\/)(tests?|__tests__)\//.test(
    path,
  );
}

// Reads a unified diff (`--unified=0` is enough) and returns the loosening moves.
export function scanDiff(diff: string): Finding[] {
  const added: { file: string; text: string }[] = [];
  const removed: { file: string; text: string }[] = [];
  const deleted = new Set<string>();
  const strip = (p: string) => p.replace(/^[ab]\//, "");
  let file = "";
  let oldFile = "";
  // File headers appear only between `diff --git` and the first `@@`; inside a hunk,
  // an added line such as `++ x` is content, not a header.
  let inHunk = false;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff ")) {
      inHunk = false;
    } else if (line.startsWith("@@")) {
      inHunk = true;
    } else if (!inHunk && line.startsWith("--- ")) {
      oldFile = strip(line.slice(4));
    } else if (!inHunk && line.startsWith("+++ ")) {
      const newFile = strip(line.slice(4));
      file = newFile === "/dev/null" ? oldFile : newFile;
      if (newFile === "/dev/null") {
        deleted.add(oldFile);
      }
    } else if (line.startsWith("+")) {
      added.push({ file, text: line.slice(1) });
    } else if (line.startsWith("-")) {
      removed.push({ file, text: line.slice(1) });
    }
  }

  const findings: Finding[] = [];
  const flag = (rule: string, f: string, text: string) =>
    findings.push({ rule, file: f, text: text.trim().slice(0, 120) });
  for (const { file: f, text } of added) {
    if (SUPPRESSIONS.test(text)) {
      flag("silenced-checker", f, text);
    }
    if (isTestFile(f) && SKIPS.test(text)) {
      flag("test-skipped", f, text);
    }
  }
  for (const f of deleted) {
    if (isTestFile(f)) {
      flag("test-deleted", f, "file deleted");
    }
  }
  // An assertion line that reappears in the same file was moved, not removed.
  const kept = new Set(added.map((a) => `${a.file}\0${a.text.trim()}`));
  for (const { file: f, text } of removed) {
    if (!isTestFile(f) || deleted.has(f) || !ASSERTION.test(text)) {
      continue;
    }
    if (!kept.has(`${f}\0${text.trim()}`)) {
      flag("assertion-removed", f, text);
    }
  }
  return findings;
}

function git(args: string[], okStatuses = [0]): string | null {
  const r = spawnSync("git", args, { encoding: "utf8" });
  return r.status !== null && okStatuses.includes(r.status) ? r.stdout : null;
}

function main(): number {
  const bail = (msg: string) => (console.error(`floor-guard: ${msg}`), 2);
  let base: string | undefined;
  try {
    base = parseArgs({ options: { base: { type: "string" } } }).values.base;
  } catch (error) {
    return bail(error instanceof Error ? error.message : String(error));
  }
  const bases = base ? [base] : ["origin/HEAD", "origin/main"];
  let mergeBase: string | undefined;
  for (const b of bases) {
    mergeBase = git(["merge-base", b, "HEAD"])?.trim();
    if (mergeBase) {
      break;
    }
  }
  if (!mergeBase) {
    return bail(`no merge base against ${bases.join(" or ")}`);
  }
  const tracked = git(["diff", "--unified=0", mergeBase, "--"]);
  const untracked = git(["ls-files", "--others", "--exclude-standard"]);
  if (tracked === null || untracked === null) {
    return bail("could not read the diff");
  }
  let diff = tracked;
  for (const f of untracked.split("\n").filter(Boolean)) {
    // --no-index exits 1 when the sides differ, which is the normal case here.
    const d = git(["diff", "--no-index", "--unified=0", "/dev/null", f], [0, 1]);
    if (d === null) {
      return bail(`could not diff untracked file ${f}`);
    }
    diff += `\n${d}`;
  }
  const findings = scanDiff(diff);
  for (const f of findings) {
    console.log(`${f.rule}\t${f.file}\t${f.text}`);
  }
  if (findings.length === 0) {
    console.log("floor-guard: clean");
  }
  return findings.length ? 1 : 0;
}

if (import.meta.main) {
  process.exit(main());
}
