import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { scratch } from "./fixture.mjs";
import { basename, dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, "install.sh");

// A directory of the only system tools install.sh needs, so the real bun and
// node on this machine stay out of the search.
const TOOLS = ["sh", "sed", "awk", "find", "mkdir", "cp", "mv", "date"];
function toolDir() {
  const dir = join(scratch({ after }, "house-rules-install-"), "tools");
  mkdirSync(dir);
  for (const tool of TOOLS) {
    const path = execFileSync("sh", ["-c", `command -v ${tool}`], { encoding: "utf8" }).trim();
    symlinkSync(path, join(dir, tool));
  }
  return dir;
}
// install.sh is for Linux, macOS and WSL; Windows uses install.ps1.
const posix = process.platform !== "win32";
const tools = posix ? toolDir() : "";
const it = posix ? test : test.skip;

// Writes a stub runtime that prints a version; returns its directory.
function stub(home, rel, version) {
  const path = join(home, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `#!/bin/sh\necho ${version}\n`);
  chmodSync(path, 0o755);
  return dirname(path);
}

function run(home, pathDirs, args = [], env = {}) {
  return spawnSync("sh", [script, ...args], {
    encoding: "utf8",
    env: { HOME: home, PATH: [...pathDirs, tools].join(":"), ...env },
  });
}
const picked = (home, pathDirs) => {
  const r = run(home, pathDirs, ["--print-runtime"]);
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};

it("prefers Bun 1.4 or newer over any Node", (t) => {
  const home = scratch(t, "house-rules-install-");
  const bun = stub(home, "a/bun", "1.4.2");
  const node = stub(home, "b/node", "v24.1.0");
  assert.equal(picked(home, [node, bun]), join(bun, "bun"));
});

it("picks the newest Bun across PATH and version managers", (t) => {
  const home = scratch(t, "house-rules-install-");
  const onPath = stub(home, "a/bun", "1.4.2");
  stub(home, ".bun/bin/bun", "1.5.0-canary.3");
  stub(home, ".local/share/mise/installs/bun/1.4.9/bin/bun", "1.4.9");
  assert.equal(picked(home, [onPath]), join(home, ".bun/bin/bun"));
});

it("falls back to the newest Node 22 or newer when Bun is older than 1.4", (t) => {
  const home = scratch(t, "house-rules-install-");
  const bun = stub(home, "a/bun", "1.3.9");
  const node = stub(home, "b/node", "v22.11.0");
  stub(home, ".nvm/versions/node/v24.2.0/bin/node", "v24.2.0");
  stub(home, ".nvm/versions/node/v20.9.0/bin/node", "v20.9.0");
  assert.equal(picked(home, [bun, node]), join(home, ".nvm/versions/node/v24.2.0/bin/node"));
});

it("compares version fields as numbers", (t) => {
  const home = scratch(t, "house-rules-install-");
  const nine = stub(home, "a/node", "v22.9.0");
  const ten = stub(home, "b/node", "v22.10.0");
  assert.equal(picked(home, [nine, ten]), join(ten, "node"));
});

it("fails with install pointers when no runtime is new enough", (t) => {
  const home = scratch(t, "house-rules-install-");
  const node = stub(home, "a/node", "v20.18.0");
  const r = run(home, [node], ["--print-runtime"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Bun 1\.4 or newer .* Node\.js 22 or newer/);
});

it("rejects a HOUSE_RULES_RUNTIME below the minimum", (t) => {
  const home = scratch(t, "house-rules-install-");
  const dir = stub(home, "a/node", "v21.7.0");
  const r = run(home, [], ["--print-runtime"], { HOUSE_RULES_RUNTIME: join(dir, "node") });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /below 22\.0\.0/);
});

it("refuses a non-empty directory that is not a checkout", (t) => {
  const home = scratch(t, "house-rules-install-");
  const dir = join(home, "stuff");
  mkdirSync(dir);
  writeFileSync(join(dir, "notes.txt"), "mine\n");
  const r = run(home, [], [], { HOUSE_RULES_DIR: dir, HOUSE_RULES_RUNTIME: process.execPath });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /holds no compose\.mjs/);
  assert.deepEqual(readdirSync(dir), ["notes.txt"]);
});

it("installs from a checkout, then recomposes without deleting the old skills", (t) => {
  const home = scratch(t, "house-rules-install-");
  const checkout = join(home, "house-rules");
  cpSync(root, checkout, { recursive: true, filter: (src) => basename(src) !== ".git" });
  const env = { HOUSE_RULES_DIR: checkout, HOUSE_RULES_RUNTIME: process.execPath };
  const config = join(home, ".config/house-rules");

  const first = run(home, [], [], env);
  assert.equal(first.status, 0, first.stderr);
  assert.ok(existsSync(join(config, "house-rules.json")));
  assert.ok(existsSync(join(config, "rules.md")));
  assert.ok(readdirSync(join(config, "composed-skills")).length > 0);
  assert.match(first.stdout, /@~\/\.config\/house-rules\/rules\.md/);

  const second = run(home, [], [], env);
  assert.equal(second.status, 0, second.stderr);
  const kept = readdirSync(config).filter((f) => f.startsWith("composed-skills.previous-"));
  assert.equal(kept.length, 1);
  assert.ok(readdirSync(join(config, "composed-skills")).length > 0);

  // Runs within the same second keep separate backups instead of nesting one.
  const third = run(home, [], [], env);
  assert.equal(third.status, 0, third.stderr);
  const backups = readdirSync(config).filter((f) => f.startsWith("composed-skills.previous-"));
  assert.equal(backups.length, 2);
  for (const b of backups) assert.ok(!existsSync(join(config, b, "composed-skills")));
});
