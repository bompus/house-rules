import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { compose, composeConfiguration, composeSections, parseFragment } from "../composition.mjs";
import { scratch } from "./fixture.mjs";

const root = join(import.meta.dirname, "..");
/**
 * @param {import("../composition.mjs").Meta} meta
 * @param {string} body
 */
const frag = (meta, body) => ({ meta, body, source: "t" });
const CORE = `---
core: End of every reply, Offers, Landing
---

# House rules

Intro.

## End of every reply

A.

## Offers

B.

## Extra

D.

## Landing

C.
`;
/** @param {{ sections: { heading: string }[] }} parts */
const order = (parts) => parts.sections.map((s) => s.heading);
/** @param {{ sections: { heading: string, core?: boolean }[] }} parts */
const coreOf = (parts) => parts.sections.filter((s) => s.core).map((s) => s.heading);

test("core: in the core rules marks the listed sections, and a fragment's core: true marks what it adds", () => {
  const parts = composeSections(CORE, [
    frag({ after: "Extra", core: "true" }, "## Mine\n\nM."),
    frag({ after: "Extra" }, "## Plain\n\nP."),
  ]);
  assert.deepEqual(coreOf(parts), ["End of every reply", "Offers", "Mine", "Landing"]);
  assert.deepEqual(order(parts), [
    "End of every reply",
    "Offers",
    "Extra",
    "Mine",
    "Plain",
    "Landing",
  ]);
});

test("a replacement keeps the core mark of the section it replaces", () => {
  const parts = composeSections(CORE, [frag({ replaces: "Landing" }, "## Landing\n\nNew.")]);
  assert.ok(coreOf(parts).includes("Landing"));
});

test("coreFirst puts the core sections first, in order, and leaves the rest in order", () => {
  const fragments = [
    frag({ after: "Extra", core: "true" }, "## Mine\n\nM."),
    frag({ after: "Extra" }, "## Plain\n\nP."),
  ];
  const parts = composeSections(CORE, fragments, { coreFirst: true });
  assert.deepEqual(order(parts), [
    "End of every reply",
    "Offers",
    "Mine",
    "Landing",
    "Extra",
    "Plain",
  ]);
  assert.equal(order(composeSections(CORE, fragments)).at(2), "Extra");
});

test("coreFirst keeps End of every reply first even when it is not marked core", () => {
  const core = CORE.replace("core: End of every reply, Offers, Landing", "core: Landing");
  const parts = composeSections(core, [], { coreFirst: true });
  assert.deepEqual(order(parts), ["End of every reply", "Landing", "Offers", "Extra"]);
});

test("core: naming a section that does not exist is an error", () => {
  assert.throws(
    () => composeSections(CORE.replace("Landing\n---", "Landing, Nope\n---"), []),
    /core: no section "Nope" to mark core/,
  );
});

test("core: in a fragment accepts only true or false", () => {
  assert.throws(
    () => composeSections(CORE, [frag({ core: "maybe" }, "## Mine\n\nM.")]),
    /core: must be true or false/,
  );
});

test("coreFirst in the configuration must be a boolean", (t) => {
  const dir = scratch(t, "core-marker-config-");
  assert.throws(
    () =>
      composeConfiguration(
        /** @type {import("../composition.mjs").Config} */ (
          /** @type {unknown} */ ({ coreFirst: "yes", skills: { include: [] } })
        ),
        dir,
      ),
    /coreFirst must be true or false/,
  );
});

test("the shipped rules mark the safeguard sections core and coreFirst moves them to the front", (t) => {
  const dir = scratch(t, "core-marker-shipped-");
  const config = {
    modifiers: [
      "solo-operator",
      "squash-landing",
      "multi-agent",
      "shared-host-load",
      "cross-session-relay",
      "no-attribution",
      "land-when-done",
    ],
    skills: { include: [] },
  };
  const plain = composeConfiguration(config, dir);
  const marked = coreOf(plain.parts);
  for (const heading of [
    "End of every reply",
    "Offers",
    "Finishing work",
    "Session purpose",
    "Repository work",
    "Landing",
    "Landing by default",
    "Cleanup",
    "Coordination and isolation",
    "Durable notes",
    "Safety and privacy",
    "Solo operator",
    "Squash landing",
    "Working with other agents",
    "Shared machine load",
    "Cross-session relays and update notices",
    "No attribution",
  ]) {
    assert.ok(marked.includes(heading), `${heading} is core`);
  }
  const first = composeConfiguration({ ...config, coreFirst: true }, dir);
  const names = order(first.parts);
  const lastCore = names.findLastIndex((h) => marked.includes(h));
  const firstOther = names.findIndex((h) => !marked.includes(h));
  assert.ok(lastCore < firstOther, "every core section comes before every other section");
  assert.equal(names[0], "End of every reply");
});

test("the text-only questions section is core, so coreFirst keeps it beside the Offers permission", (t) => {
  const dir = scratch(t, "core-marker-text-only-");
  const config = {
    modifiers: ["text-only-questions", "shared-host-load"],
    coreFirst: true,
    skills: { include: [] },
  };
  const { parts } = composeConfiguration(config, dir);
  const names = order(parts);
  const core = coreOf(parts);
  assert.ok(core.includes("Offers") && core.includes("Text-only questions"));
  assert.ok(
    names.findLastIndex((h) => core.includes(h)) < names.findIndex((h) => !core.includes(h)),
    "every core section, the text-only one included, comes before every other section",
  );
});

test("composing text-only questions with another question choice stops before any output", (t) => {
  const dir = scratch(t, "core-marker-text-only-conflict-");
  for (const other of ["model-default-questions", "coded-offers", "question-cards"]) {
    assert.throws(
      () =>
        composeConfiguration(
          { modifiers: ["text-only-questions", other], skills: { include: [] } },
          dir,
        ),
      /text-only-questions cannot combine/,
    );
  }
});

test("--sizes lists the core sections and the bytes of each group", (t) => {
  const dir = scratch(t, "core-marker-sizes-");
  mkdirSync(join(dir, "rules"));
  writeFileSync(
    join(dir, "rules", "mine.md"),
    "---\nafter: Writing\ncore: true\n---\n\n## Mine\n\nM.\n",
  );
  writeFileSync(join(dir, "house-rules.json"), JSON.stringify({ skills: { include: [] } }));
  const out = execFileSync(
    process.execPath,
    [join(root, "compose.mjs"), "--config", join(dir, "house-rules.json"), "--sizes"],
    { stdio: "pipe" },
  ).toString();
  const rows = out
    .trimEnd()
    .split("\n")
    .map((l) => l.split("\t"));
  const sections = rows.filter((r) => r[1] === "section");
  const core = rows.filter((r) => r[1] === "core");
  assert.ok(core.length > 0);
  assert.ok(core.some((r) => r[2] === "Mine"));
  for (const r of core) {
    assert.equal(
      sections.find((s) => s[2] === r[2])?.[0],
      r[0],
      `${r[2]} has the same size as its section row`,
    );
  }
  const sum = (/** @type {string[][]} */ list) => list.reduce((n, r) => n + Number(r[0]), 0);
  const subtotal = (/** @type {string} */ name) =>
    Number(rows.find((r) => r[1] === "subtotal" && r[2] === name)?.[0]);
  assert.equal(subtotal("core sections"), sum(core));
  assert.equal(subtotal("other sections"), sum(sections) - sum(core));
});

test("core: false unmarks a section and a replacement of several sections keeps the mark on each", () => {
  const unmarked = composeSections(CORE, [
    frag({ replaces: "Landing", core: "false" }, "## Landing\n\nNew."),
  ]);
  assert.equal(coreOf(unmarked).includes("Landing"), false);
  const many = composeSections(CORE, [
    frag({ replaces: "Landing" }, "## Landing\n\nNew.\n\n## Landing two\n\nTwo."),
  ]);
  assert.deepEqual(
    coreOf(many).filter((h) => h.startsWith("Landing")),
    ["Landing", "Landing two"],
  );
});

test("core: is checked on a removes: fragment too", () => {
  assert.throws(
    () => composeSections(CORE, [frag({ removes: "Extra", core: "maybe" }, "")]),
    /core: must be true or false/,
  );
});

test("composeSections writes the references of a directly parsed shipped modifier inline, as compose does", () => {
  const core = readFileSync(join(root, "rules/core.md"), "utf8");
  const modifier = parseFragment(
    readFileSync(join(root, "rules/modifiers/shared-host-load.md"), "utf8"),
    "shared-host-load",
  );
  const text = composeSections(core, [modifier]).sections.find(
    (s) => s.heading === "Shared machine load",
  )?.text;
  assert.ok(text?.includes("Start each job inside it"), "the procedure is inline");
  assert.ok(!text?.includes("](../references/"), "no unresolved reference link");
});

test("a core heading with a comma is written with a backslash", () => {
  const core = CORE.replace(
    "core: End of every reply, Offers, Landing",
    "core: End of every reply, Offers, Landing, Visuals\\, and more",
  ).replace("## Extra\n\nD.", "## Visuals, and more\n\nV.\n\n## Extra\n\nD.");
  assert.ok(coreOf(composeSections(core, [])).includes("Visuals, and more"));
});

test("compose accepts the file path of a shipped modifier as its source label", () => {
  const core = readFileSync(join(root, "rules/core.md"), "utf8");
  const text = readFileSync(join(root, "rules/modifiers/shared-host-load.md"), "utf8");
  const byName = compose(core, [parseFragment(text, "shared-host-load")]);
  assert.equal(compose(core, [parseFragment(text, "rules/modifiers/shared-host-load.md")]), byName);
});

test("--sizes reports the bytes of the core prefix the written rules start with under coreFirst", (t) => {
  const dir = scratch(t, "core-marker-prefix-");
  mkdirSync(join(dir, "rules"));
  writeFileSync(
    join(dir, "rules", "mine.md"),
    "---\nafter: Writing\ncore: true\n---\n\n## Mine\n\nM.\n",
  );
  const config = join(dir, "house-rules.json");
  writeFileSync(config, JSON.stringify({ coreFirst: true, skills: { include: [] } }));
  const listing = execFileSync(
    process.execPath,
    [join(root, "compose.mjs"), "--config", config, "--sizes"],
    { stdio: "pipe" },
  ).toString();
  const prefix = Number(
    listing
      .split("\n")
      .map((l) => l.split("\t"))
      .find((r) => r[1] === "subtotal" && r[2] === "core prefix")?.[0],
  );
  // --sizes reports the written rules, the ones --out writes.
  const out = join(dir, "out", "rules.md");
  execFileSync(process.execPath, [join(root, "compose.mjs"), "--config", config, "--out", out], {
    stdio: "pipe",
  });
  const rules = readFileSync(out, "utf8");
  const first = rules.indexOf("\n\n## Offers"); // sanity: the written rules start with the preamble
  assert.ok(first > 0);
  const lastCore = rules.indexOf("## Mine");
  const end = rules.indexOf("\n\n## ", lastCore + 1);
  assert.equal(
    prefix,
    Buffer.byteLength(rules.slice(0, end), "utf8"),
    "the prefix ends after the last core section",
  );
});
