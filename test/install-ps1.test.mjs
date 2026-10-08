import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { scratch } from "./fixture.mjs";
import { basename, dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, "install.ps1");
const windows = process.platform === "win32";
const it = windows ? test : test.skip;

const system32 = join(process.env.SystemRoot ?? "C:\\Windows", "System32");
// Windows PowerShell 5.1 ships with Windows 11; PowerShell 7 is tested too when present.
const shells = [join(system32, "WindowsPowerShell", "v1.0", "powershell.exe")];
if (windows) {
  const pwsh = spawnSync("where.exe", ["pwsh.exe"], { encoding: "utf8" });
  if (pwsh.status === 0) shells.push(pwsh.stdout.split(/\r?\n/)[0].trim());
}

// Variables that would point the search at this machine's real runtimes.
const DROP = new Set(
  [
    "PATH",
    "USERPROFILE",
    "LOCALAPPDATA",
    "APPDATA",
    "SCOOP",
    "MISE_DATA_DIR",
    "NVM_HOME",
    "NVM_SYMLINK",
  ]
    .concat(["FNM_DIR", "VOLTA_HOME", "XDG_DATA_HOME", "XDG_CONFIG_HOME"])
    .concat([
      "HOUSE_RULES_DIR",
      "HOUSE_RULES_CONFIG_DIR",
      "HOUSE_RULES_REPO",
      "HOUSE_RULES_RUNTIME",
    ]),
);

function homeFixture(t) {
  // The long form of the path: TEMP can be an 8.3 short name (C:\Users\RUNNER~1),
  // while the script reports the long names Get-ChildItem returns.
  const home = realpathSync.native(scratch(t, "house-rules-ps1-"));
  mkdirSync(join(home, "AppData", "Local"), { recursive: true });
  mkdirSync(join(home, "AppData", "Roaming"), { recursive: true });
  return home;
}

// Writes a stub runtime that prints a version; returns its directory.
function stub(home, rel, version) {
  const path = join(home, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `@echo ${version}\r\n`);
  return dirname(path);
}

// PowerShell 7 colors and wraps error text to the console width.
const plain = (r) =>
  (r.stderr + r.stdout)
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/\s*\|\s*/g, " ")
    .replace(/\s+/g, " ");

function run(shell, home, pathDirs, args = [], env = {}) {
  const base = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !DROP.has(k.toUpperCase())),
  );
  return spawnSync(
    shell,
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, ...args],
    {
      encoding: "utf8",
      env: {
        ...base,
        PATH: [...pathDirs, system32].join(";"),
        USERPROFILE: home,
        LOCALAPPDATA: join(home, "AppData", "Local"),
        APPDATA: join(home, "AppData", "Roaming"),
        ...env,
      },
    },
  );
}

// Each test starts PowerShell at least once, and a cold start on a CI runner can take
// seconds. Bun's default per-test timeout is 5 s; node --test has none.
const slow = { timeout: 30_000 };

for (const shell of shells) {
  const name = basename(shell);
  const picked = (home, pathDirs) => {
    const r = run(shell, home, pathDirs, ["-PrintRuntime"]);
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };

  it(`${name}: prefers Bun 1.4 or newer over any Node`, slow, (t) => {
    const home = homeFixture(t);
    const bun = stub(home, "a\\bun.cmd", "1.4.2");
    const node = stub(home, "b\\node.cmd", "v24.1.0");
    assert.equal(picked(home, [node, bun]), join(bun, "bun.cmd"));
  });

  it(`${name}: picks the newest Bun across PATH and version managers`, slow, (t) => {
    const home = homeFixture(t);
    const onPath = stub(home, "a\\bun.cmd", "1.4.2");
    stub(home, ".bun\\bin\\bun.cmd", "1.5.0-canary.3");
    stub(home, "AppData\\Local\\mise\\installs\\bun\\1.4.9\\bun.cmd", "1.4.9");
    assert.equal(picked(home, [onPath]), join(home, ".bun", "bin", "bun.cmd"));
  });

  it(`${name}: falls back to the newest Node 22 or newer when Bun is older than 1.4`, slow, (t) => {
    const home = homeFixture(t);
    const bun = stub(home, "a\\bun.cmd", "1.3.9");
    const node = stub(home, "b\\node.cmd", "v22.11.0");
    stub(home, "AppData\\Roaming\\nvm\\v24.2.0\\node.cmd", "v24.2.0");
    stub(home, "AppData\\Roaming\\nvm\\v20.9.0\\node.cmd", "v20.9.0");
    assert.equal(
      picked(home, [bun, node]),
      join(home, "AppData", "Roaming", "nvm", "v24.2.0", "node.cmd"),
    );
  });

  it(`${name}: compares version fields as numbers`, slow, (t) => {
    const home = homeFixture(t);
    const nine = stub(home, "a\\node.cmd", "v22.9.0");
    const ten = stub(home, "b\\node.cmd", "v22.10.0");
    assert.equal(picked(home, [nine, ten]), join(ten, "node.cmd"));
  });

  it(`${name}: fails with install pointers when no runtime is new enough`, slow, (t) => {
    const home = homeFixture(t);
    const node = stub(home, "a\\node.cmd", "v20.18.0");
    const r = run(shell, home, [node], ["-PrintRuntime"]);
    assert.notEqual(r.status, 0);
    assert.match(plain(r), /Bun 1\.4 or newer .* Node\.js 22 or newer/);
  });

  it(`${name}: refuses a non-empty directory that is not a checkout`, slow, (t) => {
    const home = homeFixture(t);
    const dir = join(home, "stuff");
    mkdirSync(dir);
    writeFileSync(join(dir, "notes.txt"), "mine\n");
    const r = run(shell, home, [], [], {
      HOUSE_RULES_DIR: dir,
      HOUSE_RULES_RUNTIME: process.execPath,
    });
    assert.notEqual(r.status, 0);
    assert.match(plain(r), /holds no compose\.mjs/);
    assert.deepEqual(readdirSync(dir), ["notes.txt"]);
  });

  it(
    `${name}: installs from a checkout, then recomposes without deleting the old skills`,
    slow,
    (t) => {
      const home = homeFixture(t);
      const checkout = join(home, "house-rules");
      cpSync(root, checkout, { recursive: true, filter: (src) => basename(src) !== ".git" });
      const env = { HOUSE_RULES_DIR: checkout, HOUSE_RULES_RUNTIME: process.execPath };
      const config = join(home, ".config", "house-rules");

      const first = run(shell, home, [], [], env);
      assert.equal(first.status, 0, first.stderr);
      assert.ok(existsSync(join(config, "house-rules.json")));
      assert.ok(existsSync(join(config, "rules.md")));
      assert.ok(readdirSync(join(config, "composed-skills")).length > 0);
      assert.match(first.stdout, /@~\/\.config\/house-rules\/rules\.md/);
      assert.equal(
        JSON.parse(readFileSync(join(config, "house-rules.json"), "utf8")).skills.include.length,
        8,
      );
      assert.equal(existsSync(join(config, "composed-skills", "hr-handoff")), false);
      const existing = JSON.stringify({
        modifiers: ["no-attribution", "release-batching"],
        skills: { exclude: ["hr-read-reddit"] },
        custom: "keep",
      });
      writeFileSync(join(config, "house-rules.json"), existing);

      const second = run(shell, home, [], [], env);
      assert.equal(second.status, 0, second.stderr);
      assert.equal(readFileSync(join(config, "house-rules.json"), "utf8"), existing);
      assert.match(
        readFileSync(join(config, "rules.md"), "utf8"),
        /house-rules-references\/release-batching.md/,
      );
      assert.match(
        readFileSync(join(config, "house-rules-references", "release-batching.md"), "utf8"),
        /Every release's notes must/,
      );
      const referenceManifest = readFileSync(
        join(config, "house-rules-references", "manifest.json"),
        "utf8",
      );
      assert.equal(existsSync(join(config, "composed-skills", "hr-handoff", "SKILL.md")), true);
      assert.equal(existsSync(join(config, "composed-skills", "hr-read-reddit")), false);
      const kept = readdirSync(config).filter((f) => f.startsWith("composed-skills.previous-"));
      assert.equal(kept.length, 1);
      assert.ok(readdirSync(join(config, "composed-skills")).length > 0);

      // Runs within the same second keep separate backups instead of nesting one.
      const third = run(shell, home, [], [], env);
      assert.equal(third.status, 0, third.stderr);
      assert.equal(
        readFileSync(join(config, "house-rules-references", "manifest.json"), "utf8"),
        referenceManifest,
      );
      const backups = readdirSync(config).filter((f) => f.startsWith("composed-skills.previous-"));
      assert.equal(backups.length, 2);
      for (const b of backups) assert.ok(!existsSync(join(config, b, "composed-skills")));
    },
  );
}
