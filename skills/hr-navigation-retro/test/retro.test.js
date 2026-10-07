import { afterEach, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  linkSync,
  mkdtempSync as makeTemporaryDirectory,
  realpathSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dir, "../scripts/retro.py");
const homes = [];
const mkdtempSync = (prefix) => realpathSync.native(makeTemporaryDirectory(prefix));
afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { recursive: true, force: true });
  }
});

function jsonl(path, records) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(
    path,
    records.map((r) => JSON.stringify({ timestamp: new Date().toISOString(), ...r })).join("\n") +
      "\n",
  );
}

// One transcript per host format, each with a known number of misses, a widened
// search, a re-read file and a stale-doc remark.
function fixtureHome() {
  const home = mkdtempSync(join(process.env.HOUSE_RULES_TEST_TMP ?? tmpdir(), "navigation-retro-"));
  homes.push(home);
  const cwd = join(home, "checkouts/myrepo/task");
  const use = (id, name, input) => ({
    type: "assistant",
    cwd,
    message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] },
  });
  const result = (id, content, isError = false) => ({
    type: "user",
    cwd,
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }],
    },
  });
  jsonl(join(home, ".claude/projects/-myrepo/claude-session.jsonl"), [
    { type: "ai-title", aiTitle: "Fix the widget" },
    { type: "user", cwd, message: { role: "user", content: "fix the widget" } },
    use("1", "Grep", { pattern: "widgetRoot" }),
    result("1", "No matches found"),
    use("2", "Glob", { pattern: "**/widget*" }),
    result("2", "No files found"),
    ...[3, 4, 5].flatMap((n) => [
      use(String(n), "Read", { file_path: join(cwd, "src/widget.ts") }),
      result(String(n), "export const widget = 1;"),
    ]),
    {
      type: "assistant",
      cwd,
      message: {
        role: "assistant",
        content: [{ type: "text", text: "The README still says widgetRoot." }],
      },
    },
    use("6", "Edit", { file_path: join(cwd, "src/widget.ts") }),
    result("6", "ok"),
  ]);
  const item = (payload) => ({ type: "response_item", payload });
  jsonl(join(home, ".codex/sessions/2026/10/01/rollout-codex-session.jsonl"), [
    { type: "session_meta", payload: { cwd: join(home, "myrepo") } },
    item({
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "where is the config?" }],
    }),
    item({
      type: "custom_tool_call",
      name: "exec",
      call_id: "a",
      input:
        'await tools.exec_command({cmd:"cat docs/a.md"}); await tools.exec_command({cmd:"ls missing"})',
    }),
    item({
      type: "custom_tool_call_output",
      call_id: "a",
      output: "ls: cannot access 'missing': No such file or directory",
    }),
    item({
      type: "custom_tool_call",
      name: "exec",
      call_id: "b",
      input: "await tools.apply_patch(patch)",
    }),
    item({ type: "custom_tool_call_output", call_id: "b", output: "Done" }),
  ]);
  return home;
}

function inputs(home) {
  return readdirSync(home, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => join(entry.parentPath, entry.name));
}
function rootArgs(home) {
  return [
    ["myrepo", "checkouts/myrepo/task"],
    ["myrepo", "myrepo"],
    ["alpha", "checkouts/alpha/one"],
    ["alpha", "checkouts/alpha/two"],
    ["alpha", "alpha"],
    ["beta", "beta"],
  ].flatMap(([name, path]) => ["--repo-root", `${name}=${join(home, path)}`]);
}
const retro = (home, command, ...args) =>
  execFileSync(
    "python3",
    [script, command, ...args, ...(command === "rank" ? [...rootArgs(home), ...inputs(home)] : [])],
    {
      env: { ...process.env, HOME: home, USERPROFILE: home },
      encoding: "utf8",
    },
  );

test("rank measures misses, widening, re-reads and stale remarks in both host formats", () => {
  const home = fixtureHome();
  const out = join(home, "sessions.json");
  const printed = retro(
    home,
    "rank",
    "--since-days",
    "1",
    "--min-sessions",
    "1",
    "--min-tools",
    "1",
    "--json",
    out,
  );
  const sessions = Object.fromEntries(
    JSON.parse(readFileSync(out, "utf8")).map((s) => [
      s.path.includes(".codex") ? "codex" : "claude",
      s,
    ]),
  );
  expect(sessions.claude).toMatchObject({
    repo: "myrepo",
    title: "Fix the widget",
    tools: 6,
    nav: 5,
    navEdit: 5,
    misses: 2,
    widen: 1,
    rereads: 1,
    stale: 1,
    score: 9,
  });
  expect(sessions.codex).toMatchObject({
    repo: "myrepo",
    prompt: "where is the config?",
    tools: 2,
    nav: 1,
    navEdit: 1,
    misses: 1,
    widen: 0,
  });
  expect(printed).toContain("myrepo");
  expect(printed).toContain(sessions.claude.path);
});

test("timeline flags the empty search and the missing file", () => {
  const home = fixtureHome();
  const claude = retro(
    home,
    "timeline",
    join(home, ".claude/projects/-myrepo/claude-session.jsonl"),
  );
  expect(claude).toContain("#1 Grep: widgetRoot");
  expect(claude).toContain("!! No matches found");
  const codex = retro(
    home,
    "timeline",
    join(home, ".codex/sessions/2026/10/01/rollout-codex-session.jsonl"),
  );
  expect(codex).toContain("!! ls: cannot access 'missing'");
});

function ranked(home) {
  const out = join(home, "rank.json");
  retro(
    home,
    "rank",
    "--since-days",
    "1",
    "--min-sessions",
    "1",
    "--min-tools",
    "1",
    "--json",
    out,
  );
  return JSON.parse(readFileSync(out, "utf8"));
}

test("rank uses event dates and exact roles while citations keep timeline call numbers", () => {
  const home = mkdtempSync(
    join(process.env.HOUSE_RULES_TEST_TMP ?? tmpdir(), "navigation-retro-window-"),
  );
  homes.push(home);
  const path = join(home, ".codex/sessions/window.jsonl");
  const old = new Date(Date.now() - 3 * 86400_000).toISOString();
  const item = (payload, timestamp) => ({
    type: "response_item",
    payload,
    ...(timestamp === undefined ? {} : { timestamp }),
  });
  jsonl(path, [
    { type: "session_meta", timestamp: old, payload: { cwd: join(home, "myrepo") } },
    ...[1, 2, 3].map((n) =>
      item(
        {
          type: "function_call",
          name: "exec_command",
          call_id: String(n),
          arguments: JSON.stringify({ cmd: "cat AGENTS.md" }),
        },
        old,
      ),
    ),
    item({ type: "function_call_output", call_id: "1", output: "No such file or directory" }),
    ...["developer", "system", "tool", "user"].map((role) =>
      item({ type: "message", role, content: [{ text: "The README is stale." }] }),
    ),
    item({
      type: "function_call",
      name: "exec_command",
      call_id: "4",
      arguments: JSON.stringify({ command: ["bash", "-lc", "ls missing"] }),
    }),
    item({ type: "function_call_output", call_id: "4", output: "No such file or directory" }),
    item({ type: "message", role: "assistant", content: [{ text: "The README is stale." }] }),
    item(
      {
        type: "function_call",
        name: "exec_command",
        call_id: "5",
        arguments: JSON.stringify({ cmd: "cat AGENTS.md" }),
      },
      null,
    ),
    item(
      {
        type: "function_call",
        name: "exec_command",
        call_id: "6",
        arguments: JSON.stringify({ cmd: "cat AGENTS.md" }),
      },
      "invalid",
    ),
  ]);
  const [row] = ranked(home);
  expect(row).toMatchObject({ repo: "myrepo", tools: 1, misses: 1, rereads: 0, stale: 1 });
  expect(row.missExamples[0][0]).toBe(4);
  const timeline = retro(home, "timeline", path);
  expect(timeline).toContain("#4 exec_command:");
  expect(timeline).toContain("#6 exec_command:");
});

test("batched command directories and physical read paths stay separate across repositories", () => {
  const home = mkdtempSync(
    join(process.env.HOUSE_RULES_TEST_TMP ?? tmpdir(), "navigation-retro-cwd-"),
  );
  homes.push(home);
  const a = join(home, "checkouts/alpha/one");
  const b = join(home, "beta");
  const a2 = join(home, "checkouts/alpha/two");
  const call = (id, input) => ({
    type: "response_item",
    payload: { type: "custom_tool_call", name: "exec", call_id: id, input },
  });
  jsonl(join(home, ".codex/sessions/mixed.jsonl"), [
    { type: "session_meta", payload: { cwd: a } },
    call(
      "batch",
      `await tools.exec_command({workdir:${JSON.stringify(a)},cmd:${JSON.stringify(`cat AGENTS.md; cat ./AGENTS.md; cat ${a.replaceAll("\\", "/")}/AGENTS.md`)}}); await tools.exec_command({cmd:"cat AGENTS.md; cat AGENTS.md",workdir:${JSON.stringify(b)}});`,
    ),
    {
      type: "response_item",
      payload: {
        type: "custom_tool_call_output",
        call_id: "batch",
        output: "No such file or directory",
      },
    },
    call(
      "other-tree",
      `await tools.exec_command({cmd:"cat AGENTS.md; cat AGENTS.md",workdir:${JSON.stringify(a2)}});`,
    ),
    call(
      "cd",
      `await tools.exec_command({cmd:${JSON.stringify(`cd "${b.replaceAll("\\", "/")}" && cat AGENTS.md`)},workdir:${JSON.stringify(a)}});`,
    ),
    call("dynamic", 'await tools.exec_command({cmd:"cat AGENTS.md",workdir:chosenDirectory});'),
  ]);
  const rows = ranked(home);
  const alpha = rows.find((r) => r.repo === "alpha");
  const beta = rows.find((r) => r.repo === "beta");
  expect(alpha).toMatchObject({ tools: 2, nav: 2, rereads: 1, misses: 0 });
  expect(beta).toMatchObject({ tools: 2, nav: 2, rereads: 1, misses: 0 });
  expect(alpha.rereadFiles).toEqual([[join("~", "checkouts/alpha/one/AGENTS.md"), 3]]);
  expect(beta.rereadFiles).toEqual([[join("~", "beta/AGENTS.md"), 3]]);
});

test("Claude text roles and dates exclude injected remarks and retain assistant legacy records", () => {
  const home = mkdtempSync(
    join(process.env.HOUSE_RULES_TEST_TMP ?? tmpdir(), "navigation-retro-roles-"),
  );
  homes.push(home);
  const cwd = join(home, "myrepo");
  jsonl(join(home, ".claude/projects/myrepo/roles.jsonl"), [
    { type: "user", cwd, message: { role: "user", content: "inspect the repo" } },
    {
      type: "assistant",
      cwd,
      message: {
        role: "assistant",
        content: [{ type: "tool_use", id: "a", name: "Read", input: { file_path: "AGENTS.md" } }],
      },
    },
    { type: "system", message: { role: "system", content: "stale docs" } },
    {
      type: "assistant",
      message: { role: "developer", content: [{ type: "text", text: "stale docs" }] },
    },
    { type: "assistant", timestamp: null, message: { role: "assistant", content: "stale docs" } },
    { type: "assistant", message: { content: "The README is stale." } },
  ]);
  expect(ranked(home)[0]).toMatchObject({ tools: 1, stale: 1 });
});

test("unparsed batch commands and concatenated directories preserve attribution uncertainty", () => {
  const home = mkdtempSync(
    join(process.env.HOUSE_RULES_TEST_TMP ?? tmpdir(), "navigation-retro-dynamic-"),
  );
  homes.push(home);
  const a = join(home, "alpha");
  const b = join(home, "beta");
  jsonl(join(home, ".codex/sessions/dynamic.jsonl"), [
    { type: "session_meta", payload: { cwd: a } },
    {
      type: "response_item",
      payload: {
        type: "custom_tool_call",
        name: "exec",
        call_id: "mixed",
        input: `await tools.exec_command({cmd:"cat AGENTS.md",workdir:${JSON.stringify(a)}}); await tools.exec_command({cmd:chosenCommand,workdir:${JSON.stringify(b)}});`,
      },
    },
    {
      type: "response_item",
      payload: {
        type: "custom_tool_call_output",
        call_id: "mixed",
        output: "No such file or directory",
      },
    },
    {
      type: "response_item",
      payload: {
        type: "custom_tool_call",
        name: "exec",
        call_id: "concat",
        input: `await tools.exec_command({cmd:"cat AGENTS.md",workdir:${JSON.stringify(a)} + suffix});`,
      },
    },
  ]);
  const rows = ranked(home);
  expect(rows.find((r) => r.repo === "alpha")).toMatchObject({ tools: 1, misses: 0 });
  expect(rows.find((r) => r.repo === "beta")).toMatchObject({ tools: 1, nav: 0 });
  expect(rows.find((r) => r.repo === "?")).toMatchObject({ tools: 1 });
});

test("quoted keys and unresolved directory overrides cannot fall back to session cwd", () => {
  for (const mode of ["quoted", "shorthand", "spread", "duplicate"]) {
    const home = mkdtempSync(
      join(process.env.HOUSE_RULES_TEST_TMP ?? tmpdir(), "navigation-retro-overrides-"),
    );
    homes.push(home);
    const a = join(home, "alpha");
    const b = join(home, "beta");
    const child =
      mode === "quoted"
        ? `{"cmd":chosenCommand,"workdir":${JSON.stringify(b)}}`
        : mode === "shorthand"
          ? '{cmd:"cat AGENTS.md",workdir}'
          : mode === "spread"
            ? '{cmd:"cat AGENTS.md",...options}'
            : `{cmd:"cat AGENTS.md",workdir:${JSON.stringify(a)},workdir:chosenDirectory}`;
    jsonl(join(home, ".codex/sessions/overrides.jsonl"), [
      { type: "session_meta", payload: { cwd: a } },
      {
        type: "response_item",
        payload: {
          type: "custom_tool_call",
          name: "exec",
          call_id: "batch",
          input: `await tools.exec_command({cmd:"cat AGENTS.md",workdir:${JSON.stringify(a)}}); await tools.exec_command(${child});`,
        },
      },
      {
        type: "response_item",
        payload: {
          type: "custom_tool_call_output",
          call_id: "batch",
          output: "No such file or directory",
        },
      },
    ]);
    const rows = ranked(home);
    expect(rows.find((r) => r.repo === "alpha")).toMatchObject({ tools: 1, misses: 0 });
    expect(rows.find((r) => r.repo === (mode === "quoted" ? "beta" : "?"))).toMatchObject({
      tools: 1,
    });
  }
});

test("rank reads only selected inputs and uses explicit roots instead of store layout", () => {
  const home = fixtureHome();
  const selected = join(home, ".claude/projects/-myrepo/claude-session.jsonl");
  const output = join(home, "selected.json");
  execFileSync(
    "python3",
    [
      script,
      "rank",
      "--repo-root",
      `selected=${join(home, "checkouts/myrepo/task")}`,
      "--min-sessions",
      "1",
      "--min-tools",
      "1",
      "--json",
      output,
      selected,
      selected,
    ],
    {
      env: { ...process.env, HOME: home, USERPROFILE: home },
    },
  );
  const rows = JSON.parse(readFileSync(output, "utf8"));
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ repo: "selected", tools: 6, misses: 2 });
  expect(rows[0].path).toBe(selected);
});

test("rank selects the most specific mapped root and leaves adjacent paths unknown", () => {
  const home = fixtureHome();
  const selected = join(home, ".claude/projects/-myrepo/claude-session.jsonl");
  const output = join(home, "roots.json");
  const run = (...roots) => {
    execFileSync(
      "python3",
      [script, "rank", ...roots.flatMap((r) => ["--repo-root", r]), "--json", output, selected],
      { env: { ...process.env, HOME: home, USERPROFILE: home } },
    );
    return JSON.parse(readFileSync(output, "utf8"));
  };
  expect(run(`parent=${home}`, `nested=${join(home, "checkouts/myrepo/task")}`)[0].repo).toBe(
    "nested",
  );
  expect(run(`adjacent=${join(home, "checkouts/myrepo/task-other")}`)[0].repo).toBe("?");
});

test("invalid input selection and output aliases refuse before changing a transcript", () => {
  const home = fixtureHome();
  const selected = join(home, ".claude/projects/-myrepo/claude-session.jsonl");
  const original = readFileSync(selected, "utf8");
  const root = `app=${join(home, "checkouts/myrepo/task")}`;
  const alias = join(home, "input-alias.jsonl");
  linkSync(selected, alias);
  const invalid = [
    ["rank", "--repo-root", root],
    ["rank", selected],
    ["rank", "--repo-root", "app=relative", selected],
    ["rank", "--repo-root", root, join(home, "missing.jsonl")],
    ["rank", "--repo-root", root, "--json", selected, selected],
    ["rank", "--repo-root", root, "--json", alias, selected],
    [
      "rank",
      "--repo-root",
      root,
      "--repo-root",
      `other=${join(home, "checkouts/myrepo/task")}`,
      selected,
    ],
  ];
  for (const args of invalid) {
    const result = spawnSync("python3", [script, ...args], {
      env: { ...process.env, HOME: home, USERPROFILE: home },
    });
    expect(result.status).toBe(2);
    expect(readFileSync(selected, "utf8")).toBe(original);
  }
});

test("a new Codex turn attributes remarks to its context instead of the preceding command", () => {
  const home = mkdtempSync(join(process.env.HOUSE_RULES_TEST_TMP ?? tmpdir(), "retro-turn-"));
  homes.push(home);
  const path = join(home, "turn.jsonl");
  const output = join(home, "turn-metrics.json");
  const alpha = join(home, "alpha");
  const beta = join(home, "beta");
  const call = (id, workdir) => ({
    type: "response_item",
    payload: {
      type: "function_call",
      name: "exec_command",
      call_id: id,
      arguments: JSON.stringify({ cmd: "cat README.md", ...(workdir ? { workdir } : {}) }),
    },
  });
  const remark = {
    type: "response_item",
    payload: { type: "message", role: "assistant", content: [{ text: "README is stale." }] },
  };
  jsonl(path, [
    { type: "session_meta", payload: { cwd: alpha } },
    call("1"),
    { type: "turn_context", payload: { cwd: beta } },
    remark,
    call("2"),
    { type: "turn_context", payload: { cwd: alpha } },
    call("3", beta),
    { type: "turn_context", payload: { cwd: alpha } },
    remark,
  ]);
  execFileSync("python3", [
    script,
    "rank",
    "--repo-root",
    `alpha=${alpha}`,
    "--repo-root",
    `beta=${beta}`,
    "--json",
    output,
    path,
  ]);
  const rows = JSON.parse(readFileSync(output, "utf8"));
  expect(rows.find((row) => row.repo === "alpha").stale).toBe(1);
  expect(rows.find((row) => row.repo === "beta").stale).toBe(1);
  expect(rows.find((row) => row.repo === "alpha").staleExamples[0][0]).toBe(3);
  expect(rows.find((row) => row.repo === "beta").staleExamples[0][0]).toBe(1);
});

test("non-object JSON records do not discard valid neighboring events", () => {
  const home = fixtureHome();
  const path = join(home, ".claude/projects/-myrepo/claude-session.jsonl");
  const original = readFileSync(path, "utf8");
  const baseline = ranked(home).find((row) => row.path === path);
  writeFileSync(path, `null\n[]\n7\n${original}`);
  const row = ranked(home).find((row) => row.path === path);
  expect(row.tools).toBe(baseline.tools);
  expect(row.misses).toBe(baseline.misses);
  expect(retro(home, "timeline", path)).toContain("#1 Grep");
});
