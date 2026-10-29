import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  decide,
  entries,
  evaluate,
  finalReply,
  planPaths,
  statements,
} from "../scripts/stop-claim-check.mjs";

const PLAN_OPEN =
  "Owner: test\nStatus: active\n## Ledger\n- [ ] Open item\n- [x] Done; evidence: checked\n";
const PLAN_DONE = "Owner: test\nStatus: active\n## Ledger\n- [x] Done; evidence: checked\n";
const PLAN_BAD = "Owner: test\nStatus: active\n## Ledger\n- [x] Done without evidence\n";

/** @param {...any} lines */
const jsonl = (...lines) => lines.map((line) => JSON.stringify(line)).join("\n");
/** @param {any[]} content */
const assistant = (content) => ({ type: "assistant", message: { role: "assistant", content } });
/** @param {string} text */
const text = (text) => ({ type: "text", text });
/** @param {string} name @param {any} input */
const tool = (name, input) => ({ type: "tool_use", name, input });
const user = { type: "user", message: { role: "user", content: "go" } };
const toolResult = { type: "user", message: { role: "user", content: [{ type: "tool_result" }] } };

const CLAIM = "The work is finished. Nothing remains.";

/** @param {Record<string, string>} files keyed by POSIX path; compared as resolved paths so Windows agrees */
const reader = (files) => {
  const byPath = new Map(Object.entries(files).map(([path, text]) => [resolve(path), text]));
  return { read: (/** @type {string} */ path) => byPath.get(resolve(path)) };
};

test("finalReply returns only the text after the last tool call", () => {
  const list = entries(
    jsonl(
      user,
      assistant([text("Starting.")]),
      assistant([tool("Bash", { command: "ls" })]),
      toolResult,
      assistant([text("Part one.")]),
      assistant([text("Part two.")]),
    ),
  );
  assert.equal(finalReply(list), "Part one.\nPart two.");
});

test("finalReply stops at the previous user prompt", () => {
  const list = entries(
    jsonl(assistant([text("Old reply.")]), user, assistant([text("New reply.")])),
  );
  assert.equal(finalReply(list), "New reply.");
});

test("entries tolerates a partial last line but not a malformed one in the middle", () => {
  assert.equal(entries('{"type":"user"}\n\n{"type":').length, 1);
  assert.throws(() => entries('{"type":"user"}\n{broken\n{"type":"assistant"}'));
});

/** Paths as POSIX text without a drive letter, so the expectations read the same on Windows. */
const posix = (/** @type {string[]} */ paths) =>
  paths.map((path) => path.replace(/^[A-Za-z]:/, "").replaceAll("\\", "/"));

/** @param {string} command @param {string} [cwd] */
const plansOf = (command, cwd = "/work") =>
  posix(planPaths(entries(jsonl(assistant([tool("Bash", { command })]))), cwd));

test("planPaths keeps plans the session wrote or handed to a floor script and ignores reads", () => {
  const list = entries(
    jsonl(
      assistant([tool("Read", { file_path: "/x/plans/other/plan.md" })]),
      assistant([tool("Edit", { file_path: "/x/plans/mine/plan.md" })]),
      assistant([tool("Edit", { file_path: "/x/notes/plan.md" })]),
      assistant([tool("Bash", { command: "cat /x/plans/read-only/plan.md" })]),
      assistant([
        tool("Bash", {
          command: "node skills/hr-what-next/scripts/check-open-work.mjs ~/p/plans/floor/plan.md",
        }),
      ]),
    ),
  );
  assert.deepEqual(posix(planPaths(list, "/work")), [
    "/x/plans/mine/plan.md",
    ...posix([join(homedir(), "p/plans/floor/plan.md")]),
  ]);
});

test("planPaths follows cd and a bare plan.md within one command, and a redirect to a full path", () => {
  assert.deepEqual(plansOf("cd /x/plans/topic-a && echo '- [ ] x' >> plan.md"), [
    "/x/plans/topic-a/plan.md",
  ]);
  assert.deepEqual(plansOf("cd /x/plans/topic-b && node check-open-work.mjs plan.md | head"), [
    "/x/plans/topic-b/plan.md",
  ]);
  assert.deepEqual(plansOf("echo y >> /x/plans/topic-c/plan.md"), ["/x/plans/topic-c/plan.md"]);
  assert.deepEqual(plansOf("cd /x/plans/topic-d && cat plan.md"), []);
  assert.deepEqual(plansOf("sed -i s/a/b/ /x/plans/topic-e/plan.md"), ["/x/plans/topic-e/plan.md"]);
  assert.deepEqual(plansOf('cd /x/plans/t-f; C="node a/close-ledger-line.mjs plan.md"'), [
    "/x/plans/t-f/plan.md",
  ]);
});

test("planPaths: a read in the same command does not count, and statement order decides which plan is last", () => {
  assert.deepEqual(
    plansOf("node check-open-work.mjs /x/plans/mine/plan.md; cat /x/plans/other/plan.md"),
    ["/x/plans/mine/plan.md"],
  );
  assert.deepEqual(
    plansOf(
      "cd /x/plans/old && echo done >> plan.md; node check-open-work.mjs /x/plans/new/plan.md",
    ),
    ["/x/plans/old/plan.md", "/x/plans/new/plan.md"],
  );
});

test("planPaths resolves relative paths against the command's own cd, the entry's directory, then the hook's", () => {
  assert.deepEqual(plansOf("(cd /x && node check-open-work.mjs plans/mine/plan.md)", "/project"), [
    "/x/plans/mine/plan.md",
  ]);
  assert.deepEqual(plansOf("node check-open-work.mjs plans/mine/plan.md", "/project"), [
    "/project/plans/mine/plan.md",
  ]);
  const list = entries(
    jsonl({
      ...assistant([tool("Bash", { command: "node check-open-work.mjs plans/mine/plan.md" })]),
      cwd: "/entry",
    }),
  );
  assert.deepEqual(posix(planPaths(list, "/project")), ["/entry/plans/mine/plan.md"]);
});

test("planPaths keeps a quoted path with spaces whole and skips here-document bodies", () => {
  assert.deepEqual(plansOf('node check-open-work.mjs "/x/my notes/plans/mine/plan.md"'), [
    "/x/my notes/plans/mine/plan.md",
  ]);
  assert.deepEqual(
    plansOf("cat >> /x/plans/a/plan.md <<'EOF'\nnode check-open-work.mjs /x/plans/b/plan.md\nEOF"),
    ["/x/plans/a/plan.md"],
  );
});

test("planPaths handles a very long command in linear time", () => {
  const command = "node check-open-work.mjs /x/plans/a/plan.md; echo " + "a".repeat(131_072);
  const started = performance.now();
  assert.deepEqual(plansOf(command), ["/x/plans/a/plan.md"]);
  assert.ok(performance.now() - started < 500);
});

test("decide blocks a completion claim while the plan has open items and names them", () => {
  const result = decide({ reply: CLAIM, planPath: "/x/plans/a/plan.md", planText: PLAN_OPEN });
  assert.equal(result.block, true);
  assert.match(result.reason ?? "", /1 open or deferred item/);
  assert.match(result.reason ?? "", /L4 - \[ \] Open item|L4 Open item/);
});

test("decide passes a reply that makes no completion claim", () => {
  const reply = "Not finished: one item is open.";
  assert.equal(decide({ reply, planPath: "/x/plans/a/plan.md", planText: PLAN_OPEN }).block, false);
});

test("decide passes a reply that only quotes a completion phrase, and still blocks a claim beside a quote", () => {
  const quoted = [
    'I checked the hook with a reply that says "nothing left" and it blocked, as designed.',
    "The test sentence was \u201cThis session is complete and can be closed.\u201d Five items stay open.",
    "Running `nothing left` through the checker returns a block.",
    "The fixture:\n```\nNothing remains.\n```\nOne item is still open.",
  ];
  for (const reply of quoted) {
    assert.equal(decide({ reply, planPath: "/p", planText: PLAN_OPEN }).block, false, reply);
  }
  const claimed = [
    'The test said "nothing left". The work is finished. Nothing remains.',
    'Quoted "x" and "y", then: nothing left.',
    'An unmatched " quote does not hide it. Nothing remains.',
  ];
  for (const reply of claimed) {
    assert.equal(decide({ reply, planPath: "/p", planText: PLAN_OPEN }).block, true, reply);
  }
});

test("decide passes when nothing is open, when there is no plan, and when the plan does not parse", () => {
  assert.equal(decide({ reply: CLAIM, planPath: "/p", planText: PLAN_DONE }).block, false);
  assert.equal(decide({ reply: CLAIM, planPath: undefined, planText: undefined }).block, false);
  assert.equal(decide({ reply: CLAIM, planPath: "/p", planText: PLAN_BAD }).block, false);
});

test("evaluate blocks once and lets the continuation through", () => {
  const transcript = jsonl(
    user,
    assistant([tool("Edit", { file_path: "/x/plans/mine/plan.md" })]),
    toolResult,
    assistant([text(CLAIM)]),
  );
  const files = reader({ "/t.jsonl": transcript, "/x/plans/mine/plan.md": PLAN_OPEN });
  assert.equal(evaluate({ transcript_path: "/t.jsonl" }, files).block, true);
  assert.equal(
    evaluate({ transcript_path: "/t.jsonl", stop_hook_active: true }, files).block,
    false,
  );
});

test("evaluate prefers the message the hook input carries, and passes a session with no plan", () => {
  const transcript = jsonl(user, assistant([text("Working on it.")]));
  const files = reader({ "/t.jsonl": transcript });
  assert.equal(
    evaluate({ transcript_path: "/t.jsonl", last_assistant_message: CLAIM }, files).block,
    false,
  );
});

test("evaluate skips a named path that is not a file and uses the last one that is", () => {
  const transcript = jsonl(
    user,
    assistant([tool("Edit", { file_path: "/x/plans/real/plan.md" })]),
    assistant([tool("Bash", { command: "node check-open-work.mjs /x/plans/missing/plan.md" })]),
    assistant([text(CLAIM)]),
  );
  const files = reader({ "/t.jsonl": transcript, "/x/plans/real/plan.md": PLAN_OPEN });
  assert.equal(evaluate({ transcript_path: "/t.jsonl" }, files).block, true);
  assert.equal(
    evaluate({ transcript_path: "/t.jsonl" }, reader({ "/t.jsonl": transcript })).block,
    false,
  );
});

test("evaluate checks the plan the session touched last", () => {
  const transcript = jsonl(
    user,
    assistant([tool("Edit", { file_path: "/x/plans/old/plan.md" })]),
    assistant([tool("Edit", { file_path: "/x/plans/new/plan.md" })]),
    toolResult,
    assistant([text(CLAIM)]),
  );
  const files = reader({
    "/t.jsonl": transcript,
    "/x/plans/old/plan.md": PLAN_OPEN,
    "/x/plans/new/plan.md": PLAN_DONE,
  });
  assert.equal(evaluate({ transcript_path: "/t.jsonl" }, files).block, false);
});

test("evaluate throws on a corrupt transcript so the hook passes without checking, and decide notes an unparseable plan", () => {
  const corrupt = `${jsonl(user, assistant([tool("Edit", { file_path: "/x/plans/a/plan.md" })]))}\n{broken\n${jsonl(assistant([text(CLAIM)]))}`;
  const files = reader({ "/t.jsonl": corrupt, "/x/plans/a/plan.md": PLAN_OPEN });
  assert.throws(() => evaluate({ transcript_path: "/t.jsonl" }, files));
  const result = decide({ reply: CLAIM, planPath: "/x/plans/a/plan.md", planText: PLAN_BAD });
  assert.equal(result.block, false);
  assert.match(result.note ?? "", /does not parse/);
});

test("planPaths ignores a script name or tee that is only an argument of another program", () => {
  assert.deepEqual(plansOf("rg -n check-open-work.mjs /x/plans/other/plan.md"), []);
  assert.deepEqual(plansOf("rg tee /x/plans/other/plan.md"), []);
  assert.deepEqual(plansOf("nice -n 10 node check-open-work.mjs /x/plans/a/plan.md"), [
    "/x/plans/a/plan.md",
  ]);
  assert.deepEqual(plansOf("echo x | tee /x/plans/b/plan.md"), ["/x/plans/b/plan.md"]);
  assert.deepEqual(plansOf('C="node a/close-ledger-line.mjs /x/plans/c/plan.md"; $C --line 1'), [
    "/x/plans/c/plan.md",
  ]);
});

test("planPaths skips an edit whose tool result is an error", () => {
  const list = entries(
    jsonl(
      assistant([{ ...tool("Edit", { file_path: "/x/plans/good/plan.md" }), id: "t1" }]),
      assistant([{ ...tool("Edit", { file_path: "/x/plans/bad/plan.md" }), id: "t2" }]),
      {
        type: "user",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "t2", is_error: true }],
        },
      },
    ),
  );
  assert.deepEqual(posix(planPaths(list, "/work")), ["/x/plans/good/plan.md"]);
});

test("planPaths: a subshell's cd ends with the subshell, and a plan after a very long command is still found", () => {
  assert.deepEqual(
    plansOf("(cd /other && pwd); node check-open-work.mjs plans/mine/plan.md", "/project"),
    ["/project/plans/mine/plan.md"],
  );
  const command = `echo ${"a".repeat(200_000)}; node check-open-work.mjs /x/plans/late/plan.md`;
  assert.deepEqual(plansOf(command), ["/x/plans/late/plan.md"]);
});

test("entries rejects a corrupt record that ends in a newline", () => {
  assert.throws(() => entries('{"type":"user"}\n{broken\n'));
  assert.equal(entries('{"type":"user"}\n{"type":"assis').length, 1);
});

test("run as a program it reads the hook input from stdin and blocks once", () => {
  const dir = mkdtempSync(join(process.env.HOUSE_RULES_TEST_TMP || tmpdir(), "stop-claim-"));
  try {
    const plan = join(dir, "plans", "demo", "plan.md");
    mkdirSync(join(dir, "plans", "demo"), { recursive: true });
    writeFileSync(plan, PLAN_OPEN);
    const transcript = join(dir, "t.jsonl");
    writeFileSync(transcript, `${jsonl(user, assistant([tool("Edit", { file_path: plan })]))}\n`);
    const script = fileURLToPath(new URL("../scripts/stop-claim-check.mjs", import.meta.url));
    const call = (/** @type {object} */ input) =>
      spawnSync(process.execPath, [script], { input: JSON.stringify(input), encoding: "utf8" });

    const blocked = call({ transcript_path: transcript, cwd: dir, last_assistant_message: CLAIM });
    assert.equal(blocked.status, 0);
    assert.equal(JSON.parse(blocked.stdout).decision, "block");
    assert.equal(
      call({ transcript_path: transcript, last_assistant_message: "Not finished." }).stdout,
      "",
    );
    assert.equal(
      call({ transcript_path: transcript, stop_hook_active: true, last_assistant_message: CLAIM })
        .stdout,
      "",
    );
    const garbage = spawnSync(process.execPath, [script], { input: "not json", encoding: "utf8" });
    assert.equal(garbage.status, 0);
    assert.match(garbage.stderr, /passed without checking/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("planPaths ignores a commented-out redirect and a floor script's option values, and counts a failed edit tool but not a failed call's exit status", () => {
  assert.deepEqual(plansOf("echo done # > /x/plans/old/plan.md"), []);
  assert.deepEqual(plansOf("echo done > /x/plans/new/plan.md # and > /x/plans/old/plan.md"), [
    "/x/plans/new/plan.md",
  ]);
  assert.deepEqual(
    plansOf(
      "node close-ledger-line.mjs /x/plans/cur/plan.md --match /x/plans/old/plan.md --evidence ok",
    ),
    ["/x/plans/cur/plan.md"],
  );
  const list = entries(
    jsonl(
      assistant([{ ...tool("Edit", { file_path: "/x/plans/cur/plan.md" }), id: "e1" }]),
      assistant([{ ...tool("Bash", { command: "sed -i s/a/b/ /x/plans/old/plan.md" }), id: "b1" }]),
      assistant([
        {
          ...tool("Bash", { command: "node check-open-work.mjs /x/plans/open/plan.md" }),
          id: "b2",
        },
      ]),
      {
        type: "user",
        message: {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "e1", is_error: true },
            { type: "tool_result", tool_use_id: "b1", is_error: true },
            { type: "tool_result", tool_use_id: "b2", is_error: true },
          ],
        },
      },
    ),
  );
  // The failed Edit is not a write; a failed Bash call still names the plans it tried to change.
  assert.deepEqual(posix(planPaths(list, "/work")), [
    "/x/plans/old/plan.md",
    "/x/plans/open/plan.md",
  ]);
});

test("planPaths skips here-document bodies whatever the delimiter looks like, and a here-string is not one", () => {
  assert.deepEqual(
    plansOf(
      "cat >> /x/plans/a/plan.md <<'END-PLAN'\nnode check-open-work.mjs /x/plans/old/plan.md\nEND-PLAN",
    ),
    ["/x/plans/a/plan.md"],
  );
  assert.deepEqual(plansOf('cat <<< "x"; node check-open-work.mjs /x/plans/after/plan.md'), [
    "/x/plans/after/plan.md",
  ]);
});

test("planPaths finds a here-document only outside quotes and comments", () => {
  assert.deepEqual(plansOf("# Example uses <<EOF\nnode check-open-work.mjs /x/plans/cur/plan.md"), [
    "/x/plans/cur/plan.md",
  ]);
  assert.deepEqual(plansOf("echo '<<EOF'\nnode check-open-work.mjs /x/plans/cur/plan.md"), [
    "/x/plans/cur/plan.md",
  ]);
  assert.deepEqual(
    plansOf(
      "cat <<A <<B > /x/plans/a/plan.md\nnode check-open-work.mjs /x/plans/no/plan.md\nA\nB\nnode check-open-work.mjs /x/plans/b/plan.md",
    ),
    ["/x/plans/a/plan.md", "/x/plans/b/plan.md"],
  );
});

test("planPaths treats only an unquoted > as a redirection", () => {
  assert.deepEqual(plansOf("rg '>' /x/plans/old/plan.md"), []);
  assert.deepEqual(plansOf("echo a\\> b > /x/plans/cur/plan.md"), ["/x/plans/cur/plan.md"]);
});

test("planPaths follows cd past the option terminator", () => {
  assert.deepEqual(
    posix(
      planPaths(
        entries(
          jsonl(
            assistant([
              tool("Bash", {
                command: "cd -- /work && node check-open-work.mjs plans/cur/plan.md",
              }),
            ]),
          ),
        ),
        "/elsewhere",
      ),
    ),
    ["/work/plans/cur/plan.md"],
  );
});

test("planPaths takes a close-ledger-line plan after option values", () => {
  assert.deepEqual(
    plansOf(
      "node close-ledger-line.mjs --match /x/plans/old/plan.md /x/plans/cur/plan.md --evidence ok",
    ),
    ["/x/plans/cur/plan.md"],
  );
  assert.deepEqual(
    plansOf(
      "node check-open-work.mjs --offline --checkout /x/plans/old/plan.md /x/plans/cur/plan.md",
    ),
    ["/x/plans/cur/plan.md"],
  );
});

test("planPaths handles line continuations, here-strings, exact here-document terminators and tee input", () => {
  assert.deepEqual(plansOf("node check-open-work.mjs \\\n  /x/plans/cur/plan.md"), [
    "/x/plans/cur/plan.md",
  ]);
  assert.deepEqual(plansOf('echo "a \\\nb" > /x/plans/cur/plan.md'), ["/x/plans/cur/plan.md"]);
  assert.deepEqual(plansOf('cat <<< "x"\nnode check-open-work.mjs /x/plans/cur/plan.md'), [
    "/x/plans/cur/plan.md",
  ]);
  assert.deepEqual(
    plansOf(
      "cat <<'EOF' > /x/plans/cur/plan.md\n  EOF\nnode check-open-work.mjs /x/plans/old/plan.md\nEOF",
    ),
    ["/x/plans/cur/plan.md"],
  );
  assert.deepEqual(
    plansOf(
      "cat <<-EOF > /x/plans/cur/plan.md\nbody\n\tEOF\nnode check-open-work.mjs /x/plans/after/plan.md",
    ),
    ["/x/plans/cur/plan.md", "/x/plans/after/plan.md"],
  );
  assert.deepEqual(plansOf("tee < /x/plans/old/plan.md"), []);
  assert.deepEqual(plansOf("tee /x/plans/cur/plan.md < /x/in.txt"), ["/x/plans/cur/plan.md"]);
});

test("planPaths sees commands after shell keywords and prefixes, and skips redirections and inline code", () => {
  assert.deepEqual(
    plansOf("if true; then node check-open-work.mjs /x/plans/cur/plan.md --offline; fi"),
    ["/x/plans/cur/plan.md"],
  );
  assert.deepEqual(
    plansOf("for f in a; do bun run check-open-work.mjs /x/plans/cur/plan.md; done"),
    ["/x/plans/cur/plan.md"],
  );
  assert.deepEqual(plansOf("node check-open-work.mjs > /dev/null /x/plans/cur/plan.md"), [
    "/x/plans/cur/plan.md",
  ]);
  assert.deepEqual(plansOf("node check-open-work.mjs 2> /dev/null /x/plans/cur/plan.md"), [
    "/x/plans/cur/plan.md",
  ]);
  assert.deepEqual(plansOf('node -e "// check-open-work.mjs" /x/plans/old/plan.md'), []);
  assert.deepEqual(plansOf("env LC_ALL=C sed -i s/a/b/ /x/plans/cur/plan.md"), [
    "/x/plans/cur/plan.md",
  ]);
  assert.deepEqual(plansOf("echo hi | sudo /usr/bin/tee /x/plans/cur/plan.md"), [
    "/x/plans/cur/plan.md",
  ]);
});

test("planPaths follows quoted substitutions, descriptor duplication, cd after keywords and pipeline subshells", () => {
  assert.deepEqual(plansOf('r="$(node check-open-work.mjs /x/plans/cur/plan.md)"'), [
    "/x/plans/cur/plan.md",
  ]);
  assert.deepEqual(plansOf('echo "a $(cd /y && pwd) b" > /x/plans/cur/plan.md'), [
    "/x/plans/cur/plan.md",
  ]);
  assert.deepEqual(
    plansOf(
      'node close-ledger-line.mjs --match "check-open-work.mjs task" /x/plans/cur/plan.md --evidence ok',
    ),
    ["/x/plans/cur/plan.md"],
  );
  assert.deepEqual(plansOf("node check-open-work.mjs 2>&1 /x/plans/cur/plan.md"), [
    "/x/plans/cur/plan.md",
  ]);
  assert.deepEqual(
    plansOf("if true; then cd /project; fi; node check-open-work.mjs plans/cur/plan.md"),
    ["/project/plans/cur/plan.md"],
  );
  assert.deepEqual(
    plansOf("cd /other | cat; node check-open-work.mjs plans/cur/plan.md", "/project"),
    ["/project/plans/cur/plan.md"],
  );
  assert.deepEqual(
    plansOf("true || cd /other; node check-open-work.mjs plans/cur/plan.md", "/project"),
    ["/project/plans/cur/plan.md"],
  );
  assert.deepEqual(plansOf("cd /y && node check-open-work.mjs plans/cur/plan.md", "/project"), [
    "/y/plans/cur/plan.md",
  ]);
  assert.deepEqual(plansOf("tee <<< /x/plans/other/plan.md"), []);
});

test("planPaths keeps double-quoted backslashes, quote-removed delimiters, cd forms and background cd", () => {
  assert.deepEqual(plansOf('node check-open-work.mjs "/x/plans/cur\\plan.md"'), [
    "/x/plans/cur/plan.md",
  ]);
  assert.deepEqual(plansOf('echo "a\\"b" > /x/plans/cur/plan.md'), ["/x/plans/cur/plan.md"]);
  assert.deepEqual(
    plansOf(
      'cat <<E"OF" > /x/plans/old/plan.md\ncontents\nEOF\nnode check-open-work.mjs /x/plans/cur/plan.md',
    ),
    ["/x/plans/old/plan.md", "/x/plans/cur/plan.md"],
  );
  assert.deepEqual(plansOf("cd /usr; cd -; node check-open-work.mjs plans/cur/plan.md", "/"), [
    "/plans/cur/plan.md",
  ]);
  assert.deepEqual(
    plansOf("cd; node check-open-work.mjs plans/cur/plan.md"),
    posix([resolve(homedir(), "plans/cur/plan.md")]),
  );
  assert.deepEqual(plansOf("cd /usr & node check-open-work.mjs plans/cur/plan.md", "/"), [
    "/plans/cur/plan.md",
  ]);
  assert.deepEqual(plansOf("cd /y && node check-open-work.mjs plans/cur/plan.md", "/"), [
    "/y/plans/cur/plan.md",
  ]);
});

test("planPaths scopes a background list, a cd with redirections and a subshell's previous directory", () => {
  assert.deepEqual(
    plansOf("cd /usr && true & wait; node check-open-work.mjs plans/cur/plan.md", "/"),
    ["/plans/cur/plan.md"],
  );
  assert.deepEqual(
    plansOf("cd 2>/dev/null /usr; node check-open-work.mjs plans/cur/plan.md", "/"),
    ["/usr/plans/cur/plan.md"],
  );
  assert.deepEqual(
    plansOf("cd /usr; (cd /var); cd -; node check-open-work.mjs plans/cur/plan.md", "/"),
    ["/plans/cur/plan.md"],
  );
});

test("entries ignores a trailing blank line but not a terminated corrupt record before it", () => {
  assert.equal(entries('{"type":"user"}\n{"type":').length, 1);
  assert.throws(() => entries('{"type":"user"}\n{broken\n '));
  assert.equal(entries('{"type":"user"}\n \n').length, 1);
});

test("planPaths resolves relative operands before judging them and keeps numeric arguments", () => {
  assert.deepEqual(
    plansOf("cd /work/plans/topic && node check-open-work.mjs ./plan.md --offline"),
    ["/work/plans/topic/plan.md"],
  );
  assert.deepEqual(plansOf("cd /work/plans && node check-open-work.mjs topic/plan.md"), [
    "/work/plans/topic/plan.md",
  ]);
  assert.deepEqual(plansOf("cd /tmp && node check-open-work.mjs ./plan.md"), []);
  assert.deepEqual(
    plansOf("node close-ledger-line.mjs --line 4 > /dev/null /x/plans/cur/plan.md --evidence ok"),
    ["/x/plans/cur/plan.md"],
  );
  assert.deepEqual(plansOf("node check-open-work.mjs 2>/dev/null /x/plans/cur/plan.md"), [
    "/x/plans/cur/plan.md",
  ]);
});

test("planPaths reads &> as a redirection and ${HOME} as the home directory", () => {
  assert.deepEqual(plansOf("echo hi &> /x/plans/cur/plan.md"), ["/x/plans/cur/plan.md"]);
  assert.deepEqual(plansOf("echo hi &>> /x/plans/cur/plan.md"), ["/x/plans/cur/plan.md"]);
  assert.deepEqual(plansOf("cd /y &> /dev/null; node check-open-work.mjs plans/cur/plan.md", "/"), [
    "/y/plans/cur/plan.md",
  ]);
  assert.deepEqual(
    plansOf("node check-open-work.mjs ${HOME}/plans/cur/plan.md"),
    posix([resolve(homedir(), "plans/cur/plan.md")]),
  );
});

test("planPaths keeps the outer command around a quoted substitution, nested background jobs, here-document boundaries and input descriptors", () => {
  assert.deepEqual(
    plansOf(
      'node close-ledger-line.mjs --evidence "$(git rev-parse --short HEAD)" /x/plans/cur/plan.md --line 5',
    ),
    ["/x/plans/cur/plan.md"],
  );
  assert.deepEqual(
    plansOf("cd /repo && (true & wait); node check-open-work.mjs plans/cur/plan.md", "/work"),
    ["/repo/plans/cur/plan.md"],
  );
  assert.deepEqual(
    plansOf(
      "cd /repo && cat <<EOF\nbody\nEOF\ntrue & wait; node check-open-work.mjs plans/cur/plan.md",
      "/work",
    ),
    ["/repo/plans/cur/plan.md"],
  );
  assert.deepEqual(plansOf("node check-open-work.mjs 0</dev/null /x/plans/cur/plan.md --offline"), [
    "/x/plans/cur/plan.md",
  ]);
});

test("planPaths keeps the command around an unquoted substitution and reads quoted assignment values", () => {
  assert.deepEqual(
    plansOf("node close-ledger-line.mjs --time $(date +%H:%M) /x/plans/cur/plan.md --line 5"),
    ["/x/plans/cur/plan.md"],
  );
  assert.deepEqual(plansOf('NOTE="two words" node check-open-work.mjs /x/plans/cur/plan.md'), [
    "/x/plans/cur/plan.md",
  ]);
  assert.deepEqual(statements("echo a$(b c)d e").at(-1), ["echo", "a$d", "e"]);
  assert.deepEqual(plansOf("sed -eiprint /x/plans/cur/plan.md"), []);
  assert.deepEqual(plansOf("sed -ni s/a/b/p /x/plans/cur/plan.md"), ["/x/plans/cur/plan.md"]);
  assert.equal(statements("a |& b").flat().length, statements("a | b").flat().length);
});
