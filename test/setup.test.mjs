import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { scratch } from "./fixture.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const executable = join(root, "compose.mjs");
const cli = (args) =>
  spawnSync(process.execPath, [executable, "setup", ...args], { encoding: "utf8" });
const interactive = {
  skip:
    process.platform !== "linux"
      ? "Linux script PTY harness; native terminal coverage is separate"
      : false,
};
const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

function fixture(t, config) {
  const dir = scratch(t, "house-rules-setup-");
  const path = join(dir, "house-rules.json");
  if (config !== undefined) writeFileSync(path, JSON.stringify(config));
  return { dir, path };
}

// A real terminal drives the shipped entry point; prompts are deterministic barriers.
function terminal(t, path) {
  const child = spawn(
    "script",
    [
      "-q",
      "-e",
      "-c",
      [process.execPath, executable, "setup", "--plain", "--config", path]
        .map(shellQuote)
        .join(" "),
      "/dev/null",
    ],
    {
      cwd: root,
      env: { ...process.env, NO_COLOR: "1", TERM: "dumb" },
      stdio: "pipe",
    },
  );
  let output = "",
    cursor = 0,
    pending,
    exit;
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  const done = new Promise((resolve) => {
    child.on("exit", (code, signal) => {
      exit = { code, signal };
      check();
      resolve(exit);
    });
  });
  const check = () => {
    if (!pending) return;
    const index = output.indexOf(pending.text, cursor);
    if (index !== -1) {
      cursor = index + pending.text.length;
      const { resolve, timer } = pending;
      pending = null;
      clearTimeout(timer);
      resolve();
    } else if (exit) {
      const { reject, timer } = pending;
      pending = null;
      clearTimeout(timer);
      reject(new Error(`Terminal exited before expected output. ${output}`));
    }
  };
  const collect = (chunk) => {
    output += chunk;
    check();
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  t.after(() => {
    if (!exit) child.kill("SIGTERM");
  });
  return {
    wait(text = "setup> ") {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending = null;
          reject(new Error(`Missing ${text}; output: ${output}`));
        }, 10000);
        pending = { text, resolve, reject, timer };
        check();
      });
    },
    async command(text) {
      child.stdin.write(text + "\n");
      await this.wait();
    },
    async finish(text = "cancel") {
      child.stdin.write(text + "\n");
      const result = await done;
      return { ...result, output };
    },
    get output() {
      return output;
    },
  };
}

test("setup JSON preserves the existing status contract and never creates a config", (t) => {
  const { path } = fixture(t);
  const result = cli(["--config", path, "--json"]);
  assert.equal(result.status, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.command, "status");
  assert.equal(report.revision, "missing");
  assert.equal(report.applied, null);
  assert.equal(report.skills.find((row) => row.name === "hr-house-rules-setup").explicitOnly, true);
  assert.equal(existsSync(path), false);
});

test("redirected setup, invalid usage and malformed configs cannot save", (t) => {
  const { path } = fixture(t);
  assert.equal(cli(["--config", path]).status, 2);
  assert.equal(cli(["--config", path, "--apply"]).status, 2);
  assert.equal(existsSync(path), false);
  writeFileSync(path, "{broken");
  assert.equal(cli(["--config", path, "--json"]).status, 1);
  assert.equal(readFileSync(path, "utf8"), "{broken");
});

test("symlink configuration remains untouched", { skip: process.platform === "win32" }, (t) => {
  const { dir, path } = fixture(t);
  const target = join(dir, "target.json");
  writeFileSync(target, "{}");
  symlinkSync(target, path);
  assert.equal(cli(["--config", path, "--json"]).status, 1);
  assert.equal(readFileSync(target, "utf8"), "{}");
});

test(
  "cancel, unchanged new layer and unchanged existing layer do not write",
  interactive,
  async (t) => {
    for (const mode of ["cancel", "missing", "existing"]) {
      const { path } = fixture(t, mode === "existing" ? { custom: true } : undefined);
      const before = existsSync(path) ? statSync(path).mtimeMs : null;
      const session = terminal(t, path);
      await session.wait();
      if (mode === "cancel") await session.command("toggle swarmail");
      await session.command("next");
      await session.command("next");
      const result = await session.finish(mode === "cancel" ? "cancel" : "save");
      assert.equal(result.code, 0);
      assert.equal(existsSync(path), mode === "existing");
      if (before !== null) assert.equal(statSync(path).mtimeMs, before);
    }
  },
);

test(
  "search, back and question presets preserve hidden choices and custom settings",
  interactive,
  async (t) => {
    const original = {
      layers: ["."],
      custom: { keep: true },
      skills: { exclude: ["unavailable-helper"], independent: [], custom: "keep" },
    };
    const { dir, path } = fixture(t, original);
    const outputPath = join(dir, "rules.md");
    writeFileSync(outputPath, "generated sentinel");
    const session = terminal(t, path);
    await session.wait();
    await session.command("questions cards");
    await session.command("questions plain");
    await session.command("next");
    await session.command("search hr-read-reddit");
    const number = /([0-9]+)\. \[on\] hr-read-reddit/.exec(session.output)?.[1];
    assert(number);
    await session.command(`toggle ${number}`);
    await session.command("search no-match-query");
    await session.command("back");
    await session.command("next");
    await session.command("next");
    const result = await session.finish("save");
    assert.equal(result.code, 0);
    const saved = JSON.parse(readFileSync(path, "utf8"));
    assert.deepEqual(saved.layers, original.layers);
    assert.deepEqual(saved.custom, original.custom);
    assert.equal(saved.skills.custom, "keep");
    assert.deepEqual(saved.skills.exclude, ["unavailable-helper", "hr-read-reddit"]);
    assert.equal(saved.modifiers?.includes("question-cards") ?? false, false);
    assert.equal(saved.modifiers?.includes("coded-offers") ?? false, false);
    assert.equal(readFileSync(outputPath, "utf8"), "generated sentinel");
    assert.equal(result.output.includes("\x1b"), false);
  },
);

test(
  "stored unknown modifiers and a missing cards prerequisite can be repaired together",
  interactive,
  async (t) => {
    const { path } = fixture(t, {
      modifiers: ["retired-modifier", "question-cards"],
      custom: "keep",
    });
    const session = terminal(t, path);
    await session.wait();
    await session.command("toggle retired-modifier");
    await session.command("questions cards");
    await session.command("next");
    await session.command("next");
    assert.equal((await session.finish("save")).code, 0);
    const saved = JSON.parse(readFileSync(path, "utf8"));
    assert.deepEqual(new Set(saved.modifiers), new Set(["coded-offers", "question-cards"]));
    assert.equal(saved.custom, "keep");
  },
);

test(
  "stale save rejects; explicit refresh and save preserve another writer's fields",
  interactive,
  async (t) => {
    const { path } = fixture(t, { custom: "old" });
    const session = terminal(t, path);
    await session.wait();
    await session.command("toggle swarmail");
    await session.command("next");
    await session.command("next");
    writeFileSync(
      path,
      JSON.stringify({ custom: "new", skills: { exclude: ["unavailable-helper"] } }),
    );
    const external = readFileSync(path, "utf8");
    await session.command("save");
    assert.equal(readFileSync(path, "utf8"), external);
    await session.command("refresh");
    assert.equal(readFileSync(path, "utf8"), external);
    assert.equal((await session.finish("save")).code, 0);
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), {
      custom: "new",
      skills: { exclude: ["unavailable-helper"] },
      modifiers: ["swarmail"],
    });
  },
);

test(
  "all edit, save and refresh orderings preserve external fields and require save",
  interactive,
  async (t) => {
    const permutations = (events) =>
      events.length
        ? events.flatMap((event, index) =>
            permutations(events.filter((_, i) => i !== index)).map((tail) => [event, ...tail]),
          )
        : [[]];
    for (const sequence of permutations(["edit", "save", "refresh"])) {
      const { path } = fixture(t, { custom: "old" });
      const session = terminal(t, path);
      await session.wait();
      await session.command("toggle swarmail");
      await session.command("next");
      await session.command("next");
      let ended = false,
        edited = false;
      for (const event of sequence) {
        const before = readFileSync(path, "utf8");
        if (event === "edit") {
          writeFileSync(path, JSON.stringify({ ...JSON.parse(before), custom: "new" }));
          edited = true;
        } else if (!ended) {
          if (event === "save" && !edited) {
            await session.finish("save");
            ended = true;
          } else {
            await session.command(event);
            assert.equal(readFileSync(path, "utf8"), before, sequence.join(" -> "));
          }
        }
        if (edited)
          assert.equal(JSON.parse(readFileSync(path, "utf8")).custom, "new", sequence.join(" -> "));
      }
      if (!ended) await session.finish();
    }
  },
);

test("Ctrl-C and terminal end of input discard a changed draft", interactive, async (t) => {
  for (const [key, code] of [
    ["\x03", 130],
    ["\x04", 0],
  ]) {
    const { path } = fixture(t, { custom: "keep" });
    const before = readFileSync(path, "utf8");
    const session = terminal(t, path);
    await session.wait();
    await session.command("toggle swarmail");
    assert.equal((await session.finish(key)).code, code);
    assert.equal(readFileSync(path, "utf8"), before);
  }
});
