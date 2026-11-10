import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { ADAPTER_FOR, adaptersFile, resolveAdapter } from "../scripts/seat-adapters.mjs";

const POSIX = { skip: process.platform === "win32" ? "POSIX paths" : false };
const refuse = /** @type {(message: string) => never} */ (
  (message) => {
    throw new Error(message);
  }
);
const INSTALL = "bun ~/host/install-seat-adapters.ts";
const ENTRY = {
  package: "@agentclientprotocol/codex-acp",
  version: "2.6.0",
  bin: "codex-acp",
  runtime: "node",
};

/**
 * A host: `repo` (the review root), `bin` with a stand-in node, `root` with an installed adapter version
 * and its marker, and the version file. `edit` changes the file's document before it is written.
 * @param {(doc: any) => void} [edit]
 */
function host(edit) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "seat-adapters-")));
  const repo = join(base, "repo");
  const bin = join(base, "bin");
  const root = join(base, "root");
  mkdirSync(repo);
  mkdirSync(bin);
  writeFileSync(join(bin, "node"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(bin, "node"), 0o755);
  const folder = join(root, "codex-acp", "2.6.0");
  const pkg = join(folder, "node_modules", "@agentclientprotocol", "codex-acp", "dist");
  mkdirSync(pkg, { recursive: true });
  mkdirSync(join(folder, "node_modules", ".bin"));
  writeFileSync(join(pkg, "index.js"), "// adapter\n");
  symlinkSync(
    join("..", "@agentclientprotocol", "codex-acp", "dist", "index.js"),
    join(folder, "node_modules", ".bin", "codex-acp"),
  );
  writeFileSync(
    join(folder, "installed.json"),
    JSON.stringify({ adapter: "codex-acp", ...ENTRY, lockSha256: "x" }),
  );
  const doc = {
    schema: 1,
    root,
    install: INSTALL,
    adapters: { "codex-acp": { ...ENTRY } },
  };
  edit?.(doc);
  const file = join(base, "seat-adapters.json");
  writeFileSync(file, JSON.stringify(doc));
  return { base, repo, bin, root, folder, file, dirs: [bin] };
}
/** @param {ReturnType<typeof host>} h @param {string} [agent] */
const resolve = (h, agent = "codex") =>
  resolveAdapter({ agent, file: h.file, dirs: h.dirs, root: h.repo }, refuse);

test("the agents that have an adapter", () => {
  assert.deepEqual(ADAPTER_FOR, { codex: "codex-acp", claude: "claude-agent-acp" });
});

test("the file is $XDG_CONFIG_HOME/seat-adapters.json, else ~/.config", () => {
  assert.equal(adaptersFile({ XDG_CONFIG_HOME: "/x/cfg" }), join("/x/cfg", "seat-adapters.json"));
  assert.equal(adaptersFile({}), join(homedir(), ".config", "seat-adapters.json"));
  // A relative XDG value is not a place to look: it would resolve against the working directory.
  assert.equal(
    adaptersFile({ XDG_CONFIG_HOME: "cfg" }),
    join(homedir(), ".config", "seat-adapters.json"),
  );
});

test("an installed version starts as node, then the canonical adapter script", POSIX, () => {
  const h = host();
  const out = resolve(h);
  assert.equal(out.exe, join(h.bin, "node"));
  assert.deepEqual(out.args, [
    join(h.folder, "node_modules", "@agentclientprotocol", "codex-acp", "dist", "index.js"),
  ]);
});

test("a root written with ~ is the user's home folder", POSIX, () => {
  // The path is checked, not the install: the folder under the home folder is missing.
  const h = host((doc) => {
    doc.root = "~/seat-adapters-test-root-that-does-not-exist";
  });
  assert.throws(
    () => resolve(h),
    (/** @type {Error} */ e) =>
      e.message.includes(join(homedir(), "seat-adapters-test-root-that-does-not-exist")) &&
      !e.message.includes("~/seat-adapters-test"),
  );
});

test("a missing file says the host has no seat adapters and names --server-exe", POSIX, () => {
  const h = host();
  assert.throws(
    () =>
      resolveAdapter(
        { agent: "codex", file: join(h.base, "none.json"), dirs: h.dirs, root: h.repo },
        refuse,
      ),
    /no seat adapters installed.*--server-exe ABSOLUTE-PATH/s,
  );
});

test(
  "a missing version folder or marker names the adapter, version, root and install command",
  POSIX,
  () => {
    const h = host((doc) => {
      doc.adapters["codex-acp"].version = "9.9.9";
    });
    assert.throws(
      () => resolve(h),
      new RegExp(
        `seat adapter codex-acp 9\\.9\\.9 is not installed under ${h.root}; run: bun ~/host/install-seat-adapters.ts`,
      ),
    );
    // No marker, or one that does not parse, is an install that did not finish.
    const g = host();
    rmSync(join(g.folder, "installed.json"));
    assert.throws(() => resolve(g), /is not installed under/);
    writeFileSync(join(g.folder, "installed.json"), "{");
    assert.throws(() => resolve(g), /is not installed under/);
  },
);

test("a marker that differs from the file's entry is refused, lockSha256 aside", POSIX, () => {
  for (const [field, value] of /** @type {Array<[string, string]>} */ ([
    ["adapter", "claude-agent-acp"],
    ["package", "@evil/codex-acp"],
    ["version", "2.6.1"],
    ["bin", "other"],
    ["runtime", "bun"],
  ])) {
    const h = host();
    writeFileSync(
      join(h.folder, "installed.json"),
      JSON.stringify({ adapter: "codex-acp", ...ENTRY, [field]: value }),
    );
    assert.throws(() => resolve(h), new RegExp(`installed\\.json.*${field}`, "s"), field);
  }
  // lockSha256 is not compared: the host may change it without a new version.
  const h = host();
  writeFileSync(
    join(h.folder, "installed.json"),
    JSON.stringify({ adapter: "codex-acp", ...ENTRY, lockSha256: "other" }),
  );
  resolve(h);
});

test("a malformed file is refused, each way", POSIX, () => {
  const cases = /** @type {Array<[string, (doc: any) => void, RegExp]>} */ ([
    ["schema", (d) => (d.schema = 2), /schema/],
    ["no root", (d) => delete d.root, /root/],
    ["relative root", (d) => (d.root = "root"), /root.*absolute/],
    ["no install", (d) => delete d.install, /install/],
    ["no entry", (d) => delete d.adapters["codex-acp"], /no entry for codex-acp/],
    ["runtime", (d) => (d.adapters["codex-acp"].runtime = "bun"), /runtime/],
    ["version path", (d) => (d.adapters["codex-acp"].version = "../x"), /version/],
    ["version empty", (d) => (d.adapters["codex-acp"].version = ""), /version/],
    ["bin path", (d) => (d.adapters["codex-acp"].bin = "../codex-acp"), /bin/],
    ["bin number", (d) => (d.adapters["codex-acp"].bin = 7), /bin/],
    ["package", (d) => delete d.adapters["codex-acp"].package, /package/],
  ]);
  for (const [name, edit, message] of cases) {
    assert.throws(() => resolve(host(edit)), message, name);
  }
  const h = host();
  writeFileSync(h.file, "{ not json");
  assert.throws(() => resolve(h), /not valid JSON/);
  writeFileSync(h.file, "[]");
  assert.throws(() => resolve(h), /schema/);
});

test("a bin that links out of the version folder is refused", POSIX, () => {
  const h = host();
  const outside = join(h.base, "elsewhere.js");
  writeFileSync(outside, "//\n");
  const link = join(h.folder, "node_modules", ".bin", "codex-acp");
  rmSync(link);
  symlinkSync(outside, link);
  assert.throws(() => resolve(h), /outside .*2\.6\.0/);
});

test("a version folder inside the checkout is refused", POSIX, () => {
  const h = host();
  const inside = host((doc) => {
    doc.root = join(h.repo, "adapters");
  });
  // Same layout built under the checkout of `inside`.
  const folder = join(inside.repo, "adapters", "codex-acp", "2.6.0");
  const pkg = join(folder, "node_modules", "@agentclientprotocol", "codex-acp", "dist");
  mkdirSync(pkg, { recursive: true });
  mkdirSync(join(folder, "node_modules", ".bin"));
  writeFileSync(join(pkg, "index.js"), "//\n");
  symlinkSync(
    join("..", "@agentclientprotocol", "codex-acp", "dist", "index.js"),
    join(folder, "node_modules", ".bin", "codex-acp"),
  );
  writeFileSync(join(folder, "installed.json"), JSON.stringify({ adapter: "codex-acp", ...ENTRY }));
  writeFileSync(
    inside.file,
    JSON.stringify({
      schema: 1,
      root: join(inside.repo, "adapters"),
      install: INSTALL,
      adapters: { "codex-acp": { ...ENTRY } },
    }),
  );
  assert.throws(() => resolve(inside), /inside the review checkout/);
});

test("node comes from the trusted program folders, none there is a refusal", POSIX, () => {
  const h = host();
  assert.throws(
    () => resolveAdapter({ agent: "codex", file: h.file, dirs: [], root: h.repo }, refuse),
    /node is not in the trusted program folders/,
  );
});

test("an agent with no adapter is refused", POSIX, () => {
  const h = host();
  assert.throws(() => resolve(h, "devin"), /no adapter/);
});
