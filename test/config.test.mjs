import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { changeSelection, readConfiguration, writeConfiguration } from "../config.mjs";
import { renderConfig } from "../config-view.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = (args, env = {}) =>
  execFileSync(process.execPath, [join(root, "compose.mjs"), "config", ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    stdio: "pipe",
  });
const report = (path, args = []) =>
  JSON.parse(cli(["preview", "--config", path, "--json", ...args]));
function fixture(t, config = {}) {
  const dir = mkdtempSync(
    join(process.env.HOUSE_RULES_TEST_TMP ?? tmpdir(), "house-rules-config-"),
  );
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "house-rules.json");
  writeFileSync(path, JSON.stringify(config));
  return { dir, path };
}

test("selection preview, apply and repeated apply preserve custom configuration and output", (t) => {
  const original = {
    layers: ["."],
    custom: { retain: true },
    skills: { independent: ["handoff"], exclude: ["unavailable-helper"], custom: "keep" },
  };
  const { dir, path } = fixture(t, original);
  mkdirSync(join(dir, "skills", "handoff"), { recursive: true });
  writeFileSync(
    join(dir, "skills", "handoff", "SKILL.md"),
    "---\nname: handoff\n---\nPersonal skill",
  );
  writeFileSync(join(dir, "rules.md"), "keep generated rules");
  const args = [
    "--enable-modifier",
    "swarmail",
    "--disable-skill",
    "hr-read-reddit",
    "--questions",
    "coded",
  ];
  const preview = report(path, args);
  assert.equal(readFileSync(path, "utf8"), JSON.stringify(original));
  assert.equal(preview.questions, "coded");
  assert.equal(preview.skills.find((s) => s.name === "handoff").enabled, true);
  assert.deepEqual(preview.unavailable, ["unavailable-helper"]);
  const applied = JSON.parse(
    cli(["set", "--config", path, "--json", ...args, "--apply", "--expect", preview.revision]),
  );
  assert.equal(applied.applied.changed, true);
  const stored = JSON.parse(readFileSync(path, "utf8"));
  assert.deepEqual(stored, {
    ...original,
    modifiers: ["swarmail", "coded-offers"],
    skills: { ...original.skills, exclude: ["unavailable-helper", "hr-read-reddit"] },
  });
  const before = statSync(path).mtimeMs;
  assert.equal(
    JSON.parse(
      cli([
        "set",
        "--config",
        path,
        "--json",
        ...args,
        "--apply",
        "--expect",
        applied.applied.revision,
      ]),
    ).applied.changed,
    false,
  );
  assert.equal(statSync(path).mtimeMs, before);
  assert.equal(readFileSync(join(dir, "rules.md"), "utf8"), "keep generated rules");
  assert.equal(existsSync(`${path}.lock`), false);
});

test("invalid requests and invalid composition never write config", (t) => {
  const { dir, path } = fixture(t);
  const original = readFileSync(path, "utf8");
  for (const args of [
    ["--enable-modifier", "no-such-modifier"],
    ["--disable-skill", "no-such-skill"],
    ["--enable-modifier", "swarmail", "--disable-modifier", "swarmail"],
    ["--questions", "plain", "--enable-modifier", "coded-offers"],
    ["--enable-modifier", "question-cards"],
    ["--questions", "unknown"],
    ["--typo"],
  ]) {
    assert.throws(() =>
      cli([
        "set",
        "--config",
        path,
        ...args,
        "--apply",
        "--expect",
        readConfiguration(path).revision,
      ]),
    );
    assert.equal(readFileSync(path, "utf8"), original);
  }
  assert.throws(
    () => cli(["set", "--config", path, "--enable-modifier", "swarmail", "--apply"]),
    /requires --expect/,
  );
  mkdirSync(join(dir, "rules"));
  writeFileSync(
    join(dir, "rules", "bad.md"),
    "---\nreplaces: End of every reply\n---\n## End of every reply\n\nWrong",
  );
  assert.throws(
    () =>
      cli([
        "set",
        "--config",
        path,
        "--enable-modifier",
        "swarmail",
        "--apply",
        "--expect",
        readConfiguration(path).revision,
      ]),
    /stays first/,
  );
  assert.equal(readFileSync(path, "utf8"), original);
});

test("missing config is read without creating it and explicit apply can initialize it", (t) => {
  const { dir } = fixture(t);
  const path = join(dir, "new-layer", "house-rules.json");
  const preview = report(path);
  assert.equal(preview.revision, "missing");
  assert.equal(existsSync(dirname(path)), false);
  assert.equal(
    JSON.parse(cli(["set", "--config", path, "--json", "--apply", "--expect", "missing"])).applied
      .changed,
    true,
  );
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), {});
});

test("question presets keep unrelated selections and resolve to composed offer rules", (t) => {
  const { path } = fixture(t, { modifiers: ["swarmail", "coded-offers", "question-cards"] });
  for (const [questions, enabled] of [
    ["plain", []],
    ["coded", ["coded-offers"]],
    ["cards", ["coded-offers", "question-cards"]],
  ]) {
    const out = report(path, ["--questions", questions]);
    assert.deepEqual(
      out.modifiers
        .filter((m) => m.enabled)
        .map((m) => m.name)
        .sort(),
      ["swarmail", ...enabled].sort(),
    );
    assert.equal(out.hostLoading, "unverified");
    assert.equal(
      out.rules.some((rule) => rule.heading === "Question cards"),
      questions === "cards",
    );
  }
});

test("status shows effective personal origins including excluded overrides without exposing custom values", (t) => {
  const { dir, path } = fixture(t, {
    skills: { exclude: ["hr-handoff"], privateToken: "DO_NOT_PRINT" },
  });
  mkdirSync(join(dir, "skills", "hr-handoff"), { recursive: true });
  writeFileSync(
    join(dir, "skills", "hr-handoff", "SKILL.md"),
    "---\nname: hr-handoff\n---\nPersonal override",
  );
  mkdirSync(join(dir, "rules"));
  writeFileSync(
    join(dir, "rules", "mine.md"),
    "---\nreplaces: Offers\n---\n## Offers\n\nMy choices",
  );
  const out = report(path);
  assert.equal(
    out.skills.find((s) => s.name === "hr-handoff").source,
    join(dir, "skills", "hr-handoff"),
  );
  assert.equal(out.skills.find((s) => s.name === "hr-handoff").enabled, false);
  assert.equal(out.rules.find((s) => s.heading === "Offers").source, join(dir, "rules", "mine.md"));
  assert.equal(
    JSON.stringify(report(path, ["--enable-skill", "hr-handoff"])).includes("DO_NOT_PRINT"),
    false,
  );
});

test("lock contention and stale preview cannot overwrite another writer", (t) => {
  const { path } = fixture(t);
  const snapshot = readConfiguration(path);
  const next = changeSelection(snapshot.config, { "enable-modifier": ["swarmail"] }, path);
  writeFileSync(`${path}.lock`, "another owner");
  assert.throws(() => writeConfiguration(snapshot, next, snapshot.revision), /locked/);
  assert.equal(readFileSync(`${path}.lock`, "utf8"), "another owner");
  rmSync(`${path}.lock`);
  writeFileSync(path, '{"custom":"new owner content"}');
  assert.throws(
    () => writeConfiguration(snapshot, next, snapshot.revision),
    /changed since preview/,
  );
  assert.equal(readFileSync(path, "utf8"), '{"custom":"new owner content"}');
  assert.equal(existsSync(`${path}.lock`), false);
});

test("enumerated preview and apply orderings preserve every successful edit", (t) => {
  const { path } = fixture(t);
  const failures = [];
  const events = ["preview A", "preview B", "apply A", "apply B", "external edit"];
  function walk(sequence, depth) {
    writeFileSync(path, "{}");
    const previews = {};
    let expected = {};
    for (const event of sequence) {
      const [operation, actor] = event.split(" ");
      if (operation === "preview") {
        const snapshot = readConfiguration(path);
        const options =
          actor === "A"
            ? { "enable-modifier": ["swarmail"] }
            : { "disable-skill": ["hr-read-reddit"] };
        previews[actor] = { snapshot, next: changeSelection(snapshot.config, options, path) };
      } else if (operation === "external") {
        expected = { ...expected, custom: "external edit preserved" };
        writeFileSync(path, JSON.stringify(expected));
      } else if (previews[actor]) {
        const { snapshot, next } = previews[actor];
        const fresh = readConfiguration(path).revision === snapshot.revision;
        try {
          const result = writeConfiguration(snapshot, next, snapshot.revision);
          if (!fresh) failures.push(`stale write accepted after ${sequence.join(" -> ")}`);
          if (fresh && result.changed) expected = next;
        } catch (e) {
          if (fresh || !/changed since preview/.test(e.message))
            failures.push(`${e.message} after ${sequence.join(" -> ")}`);
        }
      }
      if (JSON.stringify(JSON.parse(readFileSync(path, "utf8"))) !== JSON.stringify(expected))
        failures.push(`successful edit lost after ${sequence.join(" -> ")}`);
    }
    if (depth) for (const event of events) walk([...sequence, event], depth - 1);
  }
  walk([], 4);
  assert.deepEqual(failures, []);
});

test(
  "symlink config is rejected without replacing its target",
  { skip: process.platform === "win32" ? "creating symlinks requires Windows privileges" : false },
  (t) => {
    const { dir, path } = fixture(t);
    const alias = join(dir, "alias.json");
    symlinkSync(path, alias);
    assert.throws(() => readConfiguration(alias), /regular file/);
    assert.equal(readFileSync(path, "utf8"), "{}");
  },
);

test("human output is grouped; JSON and NO_COLOR output contain no terminal escapes", (t) => {
  const { path } = fixture(t);
  const human = cli(["status", "--config", path], { NO_COLOR: "1" });
  assert.match(human, /HOUSE RULES.*status/);
  assert.match(human, /Name\s+State\s+Purpose/);
  assert.match(human, /Host loading unverified/);
  assert.equal(human.includes("\u001b"), false);
  assert.equal(cli(["catalog", "--config", path, "--json"]).includes("\u001b"), false);
  const old = process.stdout.columns;
  try {
    process.stdout.columns = 40;
    const narrow = renderConfig(report(path));
    assert.ok(narrow.split("\n").every((line) => line.length <= 40));
  } finally {
    process.stdout.columns = old;
  }
});

test("terminal styling respects NO_COLOR and removes control characters from personal sources", (t) => {
  const { path } = fixture(t);
  const out = report(path);
  out.layers = ["custom\u001b[31m\nlayer"];
  const oldTTY = process.stdout.isTTY;
  const oldColor = process.env.NO_COLOR;
  const oldTerm = process.env.TERM;
  try {
    process.stdout.isTTY = true;
    process.env.TERM = "xterm";
    delete process.env.NO_COLOR;
    assert.equal(renderConfig(out).includes("\u001b["), true);
    process.env.NO_COLOR = "1";
    assert.equal(renderConfig(out).includes("\u001b"), false);
  } finally {
    process.stdout.isTTY = oldTTY;
    if (oldColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = oldColor;
    if (oldTerm === undefined) delete process.env.TERM;
    else process.env.TERM = oldTerm;
  }
});
