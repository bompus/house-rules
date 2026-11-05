import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { composeConfiguration } from "../composition.mjs";
import { scratch } from "./fixture.mjs";

// Each section below keeps a short excerpt in the always-on rules and moves its full text to a
// reference. `excerpt` lists what must stay in the excerpt (the safeguards and the pointer), so none of
// them moves into a file an agent may not open; `full` lists text that must survive in the reference
// and in the inline rendering, so the move loses nothing.
const SECTIONS = [
  {
    heading: "Implementation economy",
    modifier: null,
    reference: "implementation-economy.md",
    excerpt: [
      /when\s+nothing\s+outside\s+the\s+change\s+depends\s+on\s+the\s+old\s+shape/,
      /no\s+blind\s+upgrades/,
      /cannot\s+tell\s+whether\s+something\s+still\s+has\s+a\s+user,\s+ask/,
      /more\s+than\s+three\s+places/,
      /analysis\s+repeats\s+across\s+many\s+files\s+or\s+records/,
      /repeats\s+no\s+external\s+action/,
      /Reuse first/,
      /simplest solution/,
      /never\s+at\s+the\s+cost\s+of\s+security,\s+validation\s+or\s+stated\s+requirements/,
      /release\s+notes\s+for\s+every\s+version\s+in\s+between/,
    ],
    full: [/useLayoutEffect/, /encode it in\s+structure before prose/, /Write regression tests/],
  },
  {
    heading: "Periodic status updates",
    modifier: "periodic-updates",
    reference: "periodic-updates.md",
    excerpt: [
      /posted\s+even\s+when\s+nothing\s+changed/,
      /updating\s+or\s+disabling/,
      /sends\s+no\s+"nothing\s+to\s+report"\s+message/,
      /until\s+the\s+job\s+ends/,
      /longer than about 10 minutes/,
      /status update on its\s+own schedule/,
      /fire condition/,
      /exits silently/,
      /an end/,
    ],
    full: [
      /Wait\s+on the job through the watcher/,
      /\(3 is a start\)/,
      /change\s+only\s+the\s+fields\s+you\s+mean\s+to/,
      /not\s+in\s+one\s+long\s+blocking\s+call/,
      /no\s+metered\s+route\s+unless\s+approved/,
      /[Ss]top\s+the\s+updates\s+when\s+the\s+job\s+ends/,
      /read\s+it\s+back/,
    ],
  },
  {
    heading: "Upstream contributions",
    modifier: "upstream-contributions",
    reference: "upstream-contributions.md",
    excerpt: [
      /only\s+a\s+user\s+instruction\s+naming\s+the\s+kind\s+of\s+submission/,
      /prior\s+approval,\s+starts\s+with\s+a\s+comment\s+or\s+discussion/,
      /matches\s+a\s+kind\s+of\s+change/,
      /edit\s+its\s+title\s+and\s+opening\s+lines\s+to\s+match/,
      /Show the user the exact text and channel once before posting/,
      /cannot be undone/,
    ],
    full: [/Only a user instruction naming the kind of\s+submission/, /one per request/],
  },
  {
    heading: "Web image formats",
    modifier: "web-image-formats",
    reference: "web-image-formats.md",
    excerpt: [
      /preference\s+does\s+not\s+authorize\s+downloading,\s+transcoding\s+or\s+rehosting/,
      /target\s+browsers\s+and\s+publishing\s+pipeline/,
      /only\s+within\s+the\s+selected\s+task's\s+scope/,
      /WebP/,
      /SVG/,
    ],
    full: [/does not authorize downloading, transcoding or rehosting/],
  },
  {
    heading: "Writing",
    modifier: null,
    reference: "writing-and-naming.md",
    excerpt: [
      /unless\s+the\s+user\s+asks\s+for\s+it\s+elsewhere/,
      /MCP\s+registries/,
      /say\s+again\s+what\s+a\s+coined\s+label\s+means/,
      /describe current behavior/,
      /search the registries/,
      /let the user pick/,
    ],
    full: [
      /`hr-plain-prose` has the\s+full procedure/,
      /Operational references to available repository guidance/,
    ],
  },
  {
    heading: "Maintainer edits",
    modifier: "maintainer-edits",
    reference: "maintainer-edits.md",
    excerpt: [
      /Report\s+failed\s+updates\s+rather\s+than\s+claiming\s+the\s+setting\s+is\s+enabled/,
      /without\s+changing\s+repository\s+access/,
      /maintainer edits/,
      /never pass `--no-maintainer-edit`/,
      /does\s+not\s+authorize\s+enabling\s+Actions\s+or\s+adding\s+secrets/,
    ],
    full: [/maintainer_can_modify/],
  },
  {
    heading: "JavaScript and TypeScript runtime",
    modifier: "bun-runtime",
    reference: "bun-runtime.md",
    excerpt: [
      /a\s+Node\s+shebang/,
      /frozen\s+evaluation\s+inputs\s+and\s+historical\s+records\s+unchanged/,
      /Bun by default/,
      /Node only when the user explicitly/,
      /record/,
    ],
    full: [/A Bun\s+parent does not change an explicit `node` child/],
  },
  {
    heading: "Compression codecs",
    modifier: "compression-codecs",
    reference: "compression-codecs.md",
    excerpt: [
      /does\s+not\s+add\s+a\s+codec\s+to\s+a\s+runtime/,
      /skip\s+any\s+coding\s+listed\s+with\s+`q=0`/,
      /outside\s+the\s+task\s+unless\s+asked/,
      /zstd, then brotli,\s+then gzip/,
      /Accept-Encoding/,
    ],
    full: [/permessage-deflate/, /single runs on Node/],
  },
];
const modifiers = SECTIONS.flatMap((s) => (s.modifier ? [s.modifier] : []));
const MAX_EXCERPT_BYTES = 1400;
const MAX_ALL_EXCERPTS_BYTES = 9000;
const bytes = (/** @type {string} */ text) => Buffer.byteLength(text, "utf8");

/** @param {import("node:test").TestContext} t */
function composeBoth(t) {
  const dir = scratch(t, "deferred-sections-");
  const config = { modifiers, skills: { include: [] } };
  return {
    pointer: composeConfiguration(config, dir, { referencesDirectory: "house-rules-references" }),
    inline: composeConfiguration(config, dir),
  };
}
/**
 * @param {{ parts: { sections: { heading: string, text: string }[] } }} composed
 * @param {string} heading
 */
const sectionText = (composed, heading) => {
  const found = composed.parts.sections.find((s) => s.heading === heading);
  assert.ok(found, `section ${heading} is composed`);
  return found.text;
};

for (const s of SECTIONS) {
  test(`${s.heading}: a short excerpt keeps its safeguards and the full text moves to a reference`, (t) => {
    const { pointer, inline } = composeBoth(t);
    const excerpt = sectionText(pointer, s.heading);
    assert.ok(
      bytes(excerpt) <= MAX_EXCERPT_BYTES,
      `${s.heading} excerpt is ${bytes(excerpt)} bytes, over ${MAX_EXCERPT_BYTES}`,
    );
    assert.match(excerpt, new RegExp(`\\]\\(house-rules-references/${s.reference}\\)`));
    for (const pattern of s.excerpt) {
      assert.match(excerpt, pattern, `${s.heading} excerpt keeps ${pattern}`);
    }
    const reference = pointer.references.get(s.reference);
    assert.ok(reference, `${s.reference} is exported`);
    for (const pattern of s.full) {
      assert.match(reference, pattern, `${s.reference} keeps ${pattern}`);
      assert.match(sectionText(inline, s.heading), pattern, `inline ${s.heading} keeps ${pattern}`);
    }
  });
}

test("the eight deferred sections together stay small in the always-on rules", (t) => {
  const { pointer, inline } = composeBoth(t);
  const sum = (/** @type {typeof pointer} */ composed) =>
    SECTIONS.reduce((total, s) => total + bytes(sectionText(composed, s.heading)), 0);
  assert.ok(sum(pointer) <= MAX_ALL_EXCERPTS_BYTES, `excerpts total ${sum(pointer)} bytes`);
  assert.ok(sum(inline) > 15000, "the inline rendering still carries the full text");
});

test("a personal layer's own writing.md reference still composes beside the core references", (t) => {
  const dir = scratch(t, "deferred-sections-personal-");
  mkdirSync(join(dir, "rules"), { recursive: true });
  mkdirSync(join(dir, "references"), { recursive: true });
  writeFileSync(
    join(dir, "rules", "mine.md"),
    "---\nafter: Writing\nreference: ../references/writing.md\n---\n\n## Personal drafting\n\nShort. See [the procedure](../references/writing.md).\n",
  );
  writeFileSync(
    join(dir, "references", "writing.md"),
    "## Personal drafting\n\nLong personal procedure.\n",
  );
  const result = composeConfiguration({ skills: { include: [] } }, dir, {
    referencesDirectory: "house-rules-references",
  });
  assert.ok(result.references.has("writing.md"), "the personal reference is exported");
  assert.ok(
    result.references.has("writing-and-naming.md"),
    "the core reference keeps its own name",
  );
});
