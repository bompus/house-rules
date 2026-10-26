import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { scratch } from "./fixture.mjs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { compose, modifierList, parseFragment, splitSections } from "../compose.mjs";
import { composeConfiguration } from "../composition.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const core = readFileSync(join(root, "rules/core.md"), "utf8");
/**
 * @param {import("../composition.mjs").Meta} meta
 * @param {string} body
 * @param {string} [source]
 */
const frag = (meta, body, source = "t") => ({ meta, body, source });
/** @param {string} text */
const headings = (text) => [...text.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
/** @param {string[]} args */
const composeCli = (args) =>
  execFileSync(process.execPath, [join(root, "compose.mjs"), ...args], { stdio: "pipe" });

test("a replacement keeps the section's position and drops the old text", () => {
  const out = compose(core, [frag({ replaces: "Offers" }, "## Offers\n\nNew offer rules.")]);
  assert.deepEqual(headings(out), headings(core));
  assert.match(out, /New offer rules\./);
  const original = splitSections(core).sections.find((s) => s.heading === "Offers")?.text ?? "";
  assert.equal(out.includes(original.split("\n").slice(2).join("\n")), false);
});

// A modifier that replaces Offers swaps out core's whole section, so a sentence core gains there
// only reaches that modifier's users if the modifier carries it too.
const OFFERS_SENTENCES_EVERY_VERSION_CARRIES = [
  /For each decision, explain what would change and why it matters to the user, then recommend an option/,
  /three or more offers are open and unanswered, present no further offer/,
  /creates a rule, skill, document or script also names the owning repository, whether any project could use it unchanged, and what you searched/,
];

test("every version of the Offers section carries the sentences core's Offers section requires", () => {
  const dir = join(root, "rules/modifiers");
  const versions = [{ source: "core", text: core }];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".md"))) {
    const { meta, body } = parseFragment(readFileSync(join(dir, file), "utf8"), file);
    if (meta.replaces === "Offers") {
      versions.push({ source: file, text: body });
    }
  }
  assert.ok(versions.length > 1, "expected a modifier that replaces Offers");
  for (const { source, text } of versions) {
    for (const sentence of OFFERS_SENTENCES_EVERY_VERSION_CARRIES) {
      assert.match(text.replace(/\s+/g, " "), sentence, source);
    }
  }
});

test("several fragments after one section keep their configured order", () => {
  const out = compose(core, [
    frag({ after: "Landing" }, "## First"),
    frag({ after: "Landing" }, "## Second"),
  ]);
  const h = headings(out);
  assert.deepEqual(h.slice(h.indexOf("Landing"), h.indexOf("Landing") + 3), [
    "Landing",
    "First",
    "Second",
  ]);
});

test("the end-of-reply check cannot be replaced or removed and stays first", () => {
  assert.throws(
    () => compose(core, [frag({ replaces: "End of every reply" }, "## End of every reply\n\nx")]),
    /stays first/,
  );
  assert.throws(() => compose(core, [frag({ removes: "End of every reply" }, "")]), /stays first/);
  assert.throws(
    () => compose(core, [frag({ before: "End of every reply" }, "## Intro")]),
    /stays first/,
  );
});

test("a replaced section keeps its after: position for later fragments", () => {
  const out = compose(core, [
    frag({ after: "Landing" }, "## First"),
    frag({ replaces: "First" }, "## First\n\nreplaced"),
    frag({ after: "Landing" }, "## Second"),
  ]);
  const h = headings(out);
  assert.deepEqual(h.slice(h.indexOf("Landing"), h.indexOf("Landing") + 3), [
    "Landing",
    "First",
    "Second",
  ]);
});

test("frontmatter typos fail instead of composing somewhere else", () => {
  assert.throws(
    () => compose(core, [frag({ afer: "Landing" }, "## X")]),
    /unknown frontmatter key "afer"/,
  );
  assert.throws(() => compose(core, [frag({ replaces: "" }, "## X")]), /needs a section heading/);
  assert.throws(
    () => compose(core, [frag({ removes: "Writing" }, "## Writing\n\nkept?")]),
    /has no body/,
  );
});

test("each backlog view modifier composes alone, and the two cannot be combined", (t) => {
  const dir = scratch(t);
  /** @param {string[]} modifiers */
  const select = (modifiers) => ({ modifiers, skills: { include: ["hr-what-next"] } });
  for (const name of ["backlog-visual", "backlog-outline"]) {
    const { rules } = composeConfiguration(select([name]), dir);
    assert.equal(headings(rules).filter((h) => h === "Backlog view").length, 1, name);
  }
  assert.throws(
    () => composeConfiguration(select(["backlog-visual", "backlog-outline"]), dir),
    /duplicate section "Backlog view"/,
  );
  assert.equal(
    headings(composeConfiguration(select([]), dir).rules).includes("Backlog view"),
    false,
  );
});

test("ambiguous fragments fail instead of composing contradictions", () => {
  assert.throws(
    () => compose(core, [frag({}, "## Landing\n\nagain")]),
    /duplicate section "Landing"/,
  );
  assert.throws(() => compose(core, [frag({ after: "Nope" }, "## X")]), /no section "Nope"/);
  assert.throws(
    () => compose(core, [frag({ after: "Landing", replaces: "Offers" }, "## X")]),
    /use one of/,
  );
  assert.throws(
    () => compose(core, [frag({ after: "Landing" }, "text without heading")]),
    /must start with/,
  );
});

test("Offers can be replaced but not removed or renamed, since the end-of-reply check points at it", () => {
  assert.throws(() => compose(core, [frag({ removes: "Offers" }, "")]), /replaced, not removed/);
  assert.throws(
    () => compose(core, [frag({ replaces: "Offers" }, "## Choices\n\nx")]),
    /"Offers" section is required/,
  );
});

test("an after: section lands next to its target even when an earlier one was removed", () => {
  const out = compose(core, [
    frag({ after: "Offers" }, "## Temporary"),
    frag({ removes: "Temporary" }, ""),
    frag({ after: "Offers" }, "## Kept"),
  ]);
  const h = headings(out);
  assert.equal(h[h.indexOf("Offers") + 1], "Kept");
});

test("a quoted frontmatter value loses its surrounding quotes only", () => {
  const { meta } = parseFragment(
    '---\ndescription: "Do it. Then stop."\nother: \'a\'\nplain: it\'s "fine"\nlone: "\n---\nBody\n',
    "quoted",
  );
  assert.equal(meta.description, "Do it. Then stop.");
  assert.equal(meta.other, "a");
  assert.equal(meta.plain, 'it\'s "fine"');
  assert.equal(meta.lone, '"');
});
test("Windows line endings and headings inside code fences do not change the result", () => {
  const crlf = parseFragment("---\r\nafter: Landing\r\n---\r\n## Mine\r\n\r\nText.\r\n", "crlf");
  assert.equal(crlf.meta.after, "Landing");
  const fenced = frag(
    { after: "Landing" },
    "## Example\n\n```markdown\n## Offers\n\nnot a section\n```",
  );
  const out = compose(core, [crlf, fenced]);
  assert.equal(
    headings(out.replace(/```[\s\S]*?```/g, "")).filter((h) => h === "Offers").length,
    1,
  );
  assert.match(out, /## Mine\n\nText\./);
});

test("a failed run writes nothing, and unknown flags are refused", (t) => {
  const dir = scratch(t);
  const out = join(dir, "rules.md");
  mkdirSync(join(dir, "skills"));
  writeFileSync(join(dir, "skills", "keep"), "");
  assert.throws(() =>
    composeCli([
      "--config",
      join(root, "examples/person/house-rules.json"),
      "--out",
      out,
      "--skills-out",
      join(dir, "skills"),
    ]),
  );
  assert.throws(
    () => composeCli(["--confg", join(root, "examples/person/house-rules.json"), "--out", out]),
    /Unknown option '--confg'/,
  );
  assert.equal(existsSync(out), false);
});

test("every shipped modifier composes, alone and all together", () => {
  const all = modifierList().map((m) =>
    parseFragment(readFileSync(join(root, "rules/modifiers", `${m.name}.md`), "utf8"), m.name),
  );
  for (const f of all) {
    compose(core, [f]);
  }
  // Modifiers that offer alternative versions of one section cannot be combined; keep the first of each.
  const exclusive = [["backlog-outline", "backlog-visual"]];
  const dropped = new Set(exclusive.flatMap((names) => names.slice(1)));
  const out = compose(
    core,
    all.filter((f) => !dropped.has(f.source)),
  );
  assert.equal(headings(out)[0], "End of every reply");
  assert.ok(
    modifierList().every((m) => m.description),
    "every modifier has a description",
  );
});

test("the example person layer composes with its skills", (t) => {
  const dir = scratch(t);
  const out = join(dir, "rules.md");
  const config = join(dir, "house-rules.json");
  writeFileSync(config, JSON.stringify({ layers: [join(root, "examples/person")] }));
  composeCli(["--config", config, "--out", out, "--skills-out", join(dir, "skills")]);
  const text = readFileSync(out, "utf8");
  assert.match(text, /## My tooling/);
  assert.match(text, /Keep reports under 15 lines/);
  assert.equal(headings(text).filter((h) => h === "Reporting").length, 1);
  assert.deepEqual(
    readdirSync(join(dir, "skills")).sort(),
    [...readdirSync(join(root, "skills")), "LICENSE", "THIRD_PARTY_NOTICES.md"].sort(),
  );
  for (const notice of ["LICENSE", "THIRD_PARTY_NOTICES.md"]) {
    assert.equal(
      readFileSync(join(dir, "skills", notice), "utf8"),
      readFileSync(join(root, notice), "utf8"),
    );
  }
  const standalone = [
    "hr-benchmarking",
    "hr-better-accessibility",
    "hr-better-colors",
    "hr-better-layout",
    "hr-better-typography",
    "hr-better-writing",
    "hr-diagnosing-bugs",
    "hr-explain-code",
    "hr-manual-qa",
    "hr-writing-for-agents",
    "hr-writing-pr",
  ];
  for (const name of standalone) {
    const notice = readFileSync(join(dir, "skills", name, "NOTICE.md"), "utf8");
    assert.equal(notice, readFileSync(join(root, "skills", name, "NOTICE.md"), "utf8"), name);
    assert.ok(
      notice.includes(readFileSync(join(root, "LICENSE"), "utf8")),
      `${name} keeps the full MIT notice`,
    );
    assert.match(notice, /Source: https:\/\/github\.com\//, `${name} keeps source provenance`);
    if (existsSync(join(root, "skills", name, "LICENSE"))) {
      assert.equal(
        readFileSync(join(dir, "skills", name, "LICENSE"), "utf8"),
        readFileSync(join(root, "skills", name, "LICENSE"), "utf8"),
        name,
      );
    }
  }
});

test("a config's own directory is its layer, and layer skills replace base skills", (t) => {
  const dir = scratch(t);
  mkdirSync(join(dir, "rules"));
  writeFileSync(join(dir, "rules", "mine.md"), "---\nafter: Writing\n---\n## Mine\n\nmine");
  mkdirSync(join(dir, "skills", "hr-handoff"), { recursive: true });
  writeFileSync(join(dir, "skills", "hr-handoff", "SKILL.md"), "my handoff");
  writeFileSync(join(dir, "house-rules.json"), "{}");
  composeCli([
    "--config",
    join(dir, "house-rules.json"),
    "--out",
    join(dir, "rules.md"),
    "--skills-out",
    join(dir, "out"),
  ]);
  assert.match(readFileSync(join(dir, "rules.md"), "utf8"), /## Mine/);
  assert.equal(readFileSync(join(dir, "out", "hr-handoff", "SKILL.md"), "utf8"), "my handoff");
  assert.equal(
    existsSync(join(dir, "out", "hr-read-reddit", "test")),
    false,
    "skill tests stay in the checkout",
  );
});

test("the README lists every modifier with its description, and every skill", () => {
  const readme = readFileSync(join(root, "README.md"), "utf8");
  /** @param {string} s */
  const plain = (s) => s.replace(/`/g, "");
  for (const m of modifierList()) {
    const row = readme.split("\n").find((l) => l.split("|")[1]?.trim() === "`" + m.name + "`");
    assert.equal(plain(row?.split("|")[2]?.trim() ?? ""), plain(m.description ?? ""), m.name);
  }
  for (const s of readdirSync(join(root, "skills"))) {
    assert.match(readme, new RegExp("`" + s + "`"), s);
  }
});

for (const kind of ["exclusion", "override", "frontmatter"]) {
  test(`legacy skill ${kind} fails before writing output`, (t) => {
    const dir = scratch(t);
    const config = kind === "exclusion" ? { skills: { exclude: ["handoff"] } } : {};
    if (kind !== "exclusion") {
      const folder = kind === "frontmatter" ? "hr-handoff" : "handoff";
      mkdirSync(join(dir, "skills", folder), { recursive: true });
      writeFileSync(join(dir, "skills", folder, "SKILL.md"), "---\nname: handoff\n---\nmy handoff");
    }
    writeFileSync(join(dir, "house-rules.json"), JSON.stringify(config));
    writeFileSync(join(dir, "rules.md"), "keep previous rules");
    assert.throws(
      () =>
        composeCli([
          "--config",
          join(dir, "house-rules.json"),
          "--out",
          join(dir, "rules.md"),
          "--skills-out",
          join(dir, "out"),
        ]),
      /legacy skill name "handoff".*"hr-handoff"/,
    );
    assert.equal(readFileSync(join(dir, "rules.md"), "utf8"), "keep previous rules");
    assert.equal(existsSync(join(dir, "out")), false);
  });
}

for (const excludeIndependent of [false, true]) {
  test(`independent generic exclusion ${excludeIndependent} preserves the prefixed skill`, (t) => {
    const dir = scratch(t);
    for (const name of ["handoff", "vendor-helper"]) {
      mkdirSync(join(dir, "skills", name), { recursive: true });
      writeFileSync(join(dir, "skills", name, "SKILL.md"), `personal ${name}`);
    }
    writeFileSync(
      join(dir, "house-rules.json"),
      JSON.stringify({
        skills: {
          independent: ["handoff"],
          exclude: ["hr-read-reddit", ...(excludeIndependent ? ["handoff"] : [])],
        },
      }),
    );
    composeCli([
      "--config",
      join(dir, "house-rules.json"),
      "--out",
      join(dir, "rules.md"),
      "--skills-out",
      join(dir, "out"),
    ]);
    assert.equal(existsSync(join(dir, "out", "handoff")), !excludeIndependent);
    if (!excludeIndependent) {
      assert.equal(
        readFileSync(join(dir, "out", "handoff", "SKILL.md"), "utf8"),
        "personal handoff",
      );
    }
    assert.equal(
      readFileSync(join(dir, "out", "vendor-helper", "SKILL.md"), "utf8"),
      "personal vendor-helper",
    );
    assert.equal(existsSync(join(dir, "out", "hr-handoff", "SKILL.md")), true);
    assert.equal(existsSync(join(dir, "out", "hr-read-reddit")), false);
  });
}

test("the skills the core rules name are declared, shipped and selected by default", (t) => {
  const named = [...new Set(core.match(/hr-[a-z][a-z-]*/g))].sort();
  const { meta } = parseFragment(core, "core");
  const declared = (meta.requires ?? "")
    .split(",")
    .map((s) => s.trim())
    .sort();
  assert.deepEqual(
    declared,
    named,
    "core.md front matter requires: lists every skill the text names",
  );
  const dir = scratch(t);
  const sample = JSON.parse(readFileSync(join(root, "examples/person/house-rules.json"), "utf8"));
  for (const skill of named) {
    assert.ok(sample.skills.include.includes(skill), `${skill} is in the fresh-install skill set`);
  }
  assert.deepEqual(composeConfiguration(sample, dir).warnings, []);
});

// The fresh install is what a new user's agent loads in every session, so growth past this
// ceiling needs a reason stated in the change that raises it. v0.10.0 was 18 KB, v0.11.0 26 KB.
const FRESH_INSTALL_CEILING_BYTES = 31_800;

test("the fresh install's composed rules stay under the size ceiling", (t) => {
  const dir = scratch(t);
  // The config is copied alone, so the sample person layer beside it is left out: a user's own
  // layer is theirs and is not part of what house-rules ships.
  writeFileSync(
    join(dir, "house-rules.json"),
    readFileSync(join(root, "examples/person/house-rules.json")),
  );
  const out = join(dir, "rules.md");
  composeCli(["--config", join(dir, "house-rules.json"), "--out", out]);
  const bytes = readFileSync(out).length;
  assert.ok(
    bytes <= FRESH_INSTALL_CEILING_BYTES,
    `the fresh install composes to ${bytes} bytes, over the ${FRESH_INSTALL_CEILING_BYTES}-byte ceiling in test/compose.test.mjs; raise the ceiling in the same change and state why`,
  );
});

test("excluding a skill the core rules rely on warns instead of composing silently", (t) => {
  const dir = scratch(t);
  const skills = { include: ["hr-what-next", "hr-code-review", "hr-diagnosing-bugs"] };
  const { warnings } = composeConfiguration({ skills }, dir);
  assert.deepEqual(warnings, [
    'rules/core.md expects the "hr-plain-prose" skill, which is not in the composed set',
  ]);
});

// With --out, core keeps a short section and links its reference; without it, the reference
// replaces the whole section. A sentence that only the short section carries is lost there.
test("each core section with a reference text carries every sentence of the short section", () => {
  const paths = (parseFragment(core, "core").meta.references ?? "").split(",").map((p) => p.trim());
  /** @param {string} text */
  const flat = (text) => text.replace(/\s+/g, " ").trim();
  assert(paths.length > 0);
  for (const path of paths) {
    const reference = flat(readFileSync(join(root, "rules", path), "utf8"));
    const heading = /^## (.+)$/m.exec(
      reference.length ? readFileSync(join(root, "rules", path), "utf8") : "",
    )?.[1];
    const section = splitSections(core).sections.find((s) => s.heading === heading);
    assert(section, `core has no section "${heading}"`);
    // The paragraph holding the link only points at the reference; every other paragraph must be in it.
    const paragraphs = section.text
      .replace(/^## .+$/m, "")
      .split(/\n\n+/)
      .map(flat)
      .filter(Boolean);
    const missing = paragraphs.filter((p) => !p.includes("](") && !reference.includes(p));
    assert.deepEqual(missing, [], `${path} lacks sentences core's short "${heading}" section has`);
  }
});
