import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { scratch } from "./fixture.mjs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { compose, modifierList, parseFragment, splitSections } from "../compose.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const core = readFileSync(join(root, "rules/core.md"), "utf8");
const frag = (meta, body, source = "t") => ({ meta, body, source });
const headings = (text) => [...text.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
const composeCli = (args) =>
  execFileSync(process.execPath, [join(root, "compose.mjs"), ...args], { stdio: "pipe" });

test("a replacement keeps the section's position and drops the old text", () => {
  const out = compose(core, [frag({ replaces: "Offers" }, "## Offers\n\nNew offer rules.")]);
  assert.deepEqual(headings(out), headings(core));
  assert.match(out, /New offer rules\./);
  const original = splitSections(core).sections.find((s) => s.heading === "Offers").text;
  assert.equal(out.includes(original.split("\n").slice(2).join("\n")), false);
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
  for (const f of all) compose(core, [f]);
  const out = compose(core, all);
  assert.equal(headings(out)[0], "End of every reply");
  assert.ok(
    modifierList().every((m) => m.description),
    "every modifier has a description",
  );
});

test("the example person layer composes with its skills", (t) => {
  const dir = scratch(t);
  const out = join(dir, "rules.md");
  composeCli([
    "--config",
    join(root, "examples/person/house-rules.json"),
    "--out",
    out,
    "--skills-out",
    join(dir, "skills"),
  ]);
  const text = readFileSync(out, "utf8");
  assert.match(text, /## My tooling/);
  assert.match(text, /Keep reports under 15 lines/);
  assert.equal(headings(text).filter((h) => h === "Reporting").length, 1);
  assert.deepEqual(
    readdirSync(join(dir, "skills")).sort(),
    [...readdirSync(join(root, "skills")), "LICENSE", "THIRD_PARTY_NOTICES.md"].sort(),
  );
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
  const plain = (s) => s.replace(/`/g, "");
  for (const m of modifierList()) {
    const row = readme.split("\n").find((l) => l.startsWith("| `" + m.name + "` |"));
    assert.equal(plain(row?.split("|")[2].trim() ?? ""), plain(m.description), m.name);
  }
  for (const s of readdirSync(join(root, "skills")))
    assert.match(readme, new RegExp("`" + s + "`"), s);
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
    if (!excludeIndependent)
      assert.equal(
        readFileSync(join(dir, "out", "handoff", "SKILL.md"), "utf8"),
        "personal handoff",
      );
    assert.equal(
      readFileSync(join(dir, "out", "vendor-helper", "SKILL.md"), "utf8"),
      "personal vendor-helper",
    );
    assert.equal(existsSync(join(dir, "out", "hr-handoff", "SKILL.md")), true);
    assert.equal(existsSync(join(dir, "out", "hr-read-reddit")), false);
  });
}
