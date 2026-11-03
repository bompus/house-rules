import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { composeConfiguration } from "../composition.mjs";
import { scratch } from "./fixture.mjs";

// A time figure needs a named comparable finished run; without one the rules give no figure at all and
// say what the work waits on. The words "unmeasured" and a promised whole-task ETA must not come back.
const config = {
  modifiers: ["effort-estimates", "periodic-updates", "compact-status"],
  skills: { include: [] },
};
/** @param {import("node:test").TestContext} t */
function compose(t) {
  const dir = scratch(t, "estimate-rules-");
  return {
    inline: composeConfiguration(config, dir),
    pointer: composeConfiguration(config, dir, { referencesDirectory: "house-rules-references" }),
  };
}
/**
 * @param {{ parts: { sections: { heading: string, text: string }[] } }} composed
 * @param {string} heading
 */
const section = (composed, heading) => {
  const found = composed.parts.sections.find((s) => s.heading === heading);
  assert.ok(found, `section ${heading} is composed`);
  return found.text;
};

test("no estimate rule asks for an unmeasured figure", (t) => {
  const { inline, pointer } = compose(t);
  const texts = [
    section(inline, "Effort estimates"),
    section(inline, "Periodic status updates"),
    section(pointer, "Periodic status updates"),
    section(inline, "Compact work updates"),
    pointer.references.get("periodic-updates.md") ?? "",
  ].join("\n");
  assert.doesNotMatch(
    texts,
    /basis\s+\(?or\s+(the\s+word\s+)?"unmeasured"|mark\s+the\s+estimate\s+unmeasured|unmeasured\s+status|state\s+when\s+an\s+estimate\s+is\s+unmeasured/i,
  );
  assert.doesNotMatch(texts, /whole-task ETA with (its|the) basis/i);
});

test("effort estimates need a named comparable finished run, else no figure and what the work waits on", (t) => {
  const text = section(compose(t).inline, "Effort estimates");
  assert.match(text, /only\s+when\s+it\s+rests\s+on\s+a\s+comparable\s+finished\s+run/);
  assert.match(text, /start\s+and\s+end\s+times\s+you\s+took\s+from\s+its\s+logs/);
  assert.match(text, /git\s+history/);
  assert.match(
    text,
    /give\s+no\s+figure\s+at\s+all,\s+even\s+for\s+a\s+small\s+change\s+before\s+work\s+starts/,
  );
  assert.match(text, /Any\s+time\s+figure\s+for\s+work\s+this\s+session/);
  assert.match(text, /give\s+no\s+figure\s+at\s+all/);
  assert.match(text, /say\s+what\s+the\s+work\s+waits\s+on/);
  assert.match(text, /A\s+figure\s+labeled\s+"unmeasured"\s+is\s+still\s+a\s+figure/);
  assert.match(text, /A\s+figure\s+labeled\s+"unmeasured"\s+is\s+still\s+a\s+figure/);
  // kept from before
  assert.match(text, /wall-clock\s+time\s+for\s+this\s+session/);
  assert.match(text, /Never\s+quote\s+human\s+developer\s+time/);
  assert.match(text, /keep\s+it\s+unchanged\s+unless\s+new\s+evidence\s+changes\s+it/);
  assert.match(text, /under\s+half\s+or\s+over\s+twice/);
});

test("periodic updates keep progress, elapsed time and what is waited on, and a finish time needs a named run", (t) => {
  const { inline, pointer } = compose(t);
  const texts = [
    section(pointer, "Periodic status updates"),
    section(inline, "Periodic status updates"),
    pointer.references.get("periodic-updates.md") ?? "",
  ];
  for (const text of texts) {
    assert.match(text, /elapsed\s+time/);
    assert.match(text, /what\s+(the\s+job\s+)?(waits|is\s+waiting)\s+on/);
    assert.match(text, /named\s+comparable\s+finished\s+run/);
    assert.match(
      text,
      /no\s+promised\s+end\s+time\s+or\s+whole-task\s+ETA\s+unless\s+a\s+named\s+comparable\s+finished\s+run\s+measured\s+it|only\s+when\s+a\s+named\s+comparable\s+finished\s+run\s+supports\s+it/,
    );
  }
});

test("compact work updates put elapsed time, what is waited on and any measured estimate in Next", (t) => {
  const text = section(compose(t).inline, "Compact work updates");
  assert.match(text, /elapsed\s+time\s+and\s+what\s+is\s+waited\s+on/);
  assert.match(text, /only\s+when\s+a\s+named\s+comparable\s+finished\s+run\s+supports\s+it/);
});

// The periodic screening scenarios accept the new behaviour and reject an end time with no run behind it.
/** @param {string} name */
function scenario(name) {
  const text = readFileSync(
    join(import.meta.dirname, "../evals/end-of-reply/screen/modifiers", name),
    "utf8",
  );
  const front = Object.fromEntries(
    (text.split("---")[1] ?? "")
      .trim()
      .split("\n")
      .map((line) => {
        const i = line.indexOf(":");
        return [line.slice(0, i), line.slice(i + 1).trim()];
      }),
  );
  const required = new RegExp(front.requiredPattern ?? "", "i");
  const forbidden = new RegExp(front.forbiddenPattern || "(?!)", "i");
  return (/** @type {string} */ reply) => required.test(reply) && !forbidden.test(reply);
}

const LINE = "612/1840 tests, 0 failures";
test("the status-line scenario wants progress, the elapsed duration and what is waited on, and no forecast figure", () => {
  const accepts = scenario("periodic-update-line.md");
  for (const reply of [
    `${LINE}; 14m elapsed; waiting on the remaining tests.`,
    `${LINE}; waiting on remaining tests; 14m elapsed.`,
    `${LINE}; waiting on remaining tests; 14 minutes have elapsed.`,
    `${LINE}; 14m elapsed; waiting on tests; ETA unmeasured.`,
    "612/1840 tests completed, 0 failures, 14 minutes elapsed; waiting for the remaining tests. No comparable timed run supports a finish estimate.",
  ]) {
    assert.ok(accepts(reply), reply);
  }
  for (const reply of [
    `${LINE} running.`,
    `${LINE}; waiting on tests; elapsed time unknown.`,
    `${LINE}; 114m elapsed; waiting on tests.`,
    `${LINE}; 14m elapsed; waiting on tests; finishes in 30 minutes.`,
    `${LINE}; 14m elapsed; waiting on tests; about 30 minutes to finish.`,
    `${LINE}; 14m elapsed; waiting on tests; finishes at 15:45.`,
    `${LINE}; 14m elapsed; waiting on tests; ETA 15:45 UTC.`,
    `${LINE}; 14m elapsed; waiting on tests; estimated 30 minutes.`,
    `${LINE}; 14m elapsed; waiting on tests; done in 30 minutes.`,
  ]) {
    assert.ok(!accepts(reply), reply);
  }
});

test("the launch scenario takes a figure only when the reply names the earlier runs, and not the interval or the word unmeasured", () => {
  const accepts = scenario("periodic-launch.md");
  for (const reply of [
    "I will post every 5 minutes; waiting on the four benchmark stages.",
    "I will finish the benchmark and post every 5 minutes; waiting on the stages.",
    "I will report every 5 minutes; ETA unmeasured; waiting on stages.",
    "I will post every 5 minutes; waiting on benchmark stages; ETA about 75 minutes, based on the last two runs (68 and 81 minutes).",
  ]) {
    assert.ok(accepts(reply), reply);
  }
  for (const reply of [
    "I will post every 5 minutes; waiting on benchmark stages. ETA 75 minutes (unmeasured).",
    "I will post every 5 minutes; waiting on benchmark stages; ETA 40 minutes.",
    "I will post every 5 minutes; waiting on benchmark stages; ETA 40 minutes based on current throughput.",
    "I will post every 5 minutes; waiting on the last stage; ETA 40 minutes.",
    "I will post every 5 minutes; waiting on stages; done at 15:45.",
  ]) {
    assert.ok(!accepts(reply), reply);
  }
});
