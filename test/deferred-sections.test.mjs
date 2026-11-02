import assert from "node:assert/strict";
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
      /longer than about 10 minutes/,
      /status update on its\s+own schedule/,
      /fire condition/,
      /exits silently/,
      /an end/,
      /read it back/,
    ],
    full: [/Wait\s+on the job through the watcher/, /\(3 is a start\)/],
  },
  {
    heading: "Upstream contributions",
    modifier: "upstream-contributions",
    reference: "upstream-contributions.md",
    excerpt: [/Show the user the exact text and channel once before posting/, /cannot be undone/],
    full: [/Only a user instruction naming the kind of\s+submission/, /one per request/],
  },
  {
    heading: "Web image formats",
    modifier: "web-image-formats",
    reference: "web-image-formats.md",
    excerpt: [/WebP/, /SVG/],
    full: [/does not authorize downloading, transcoding or rehosting/],
  },
  {
    heading: "Writing",
    modifier: null,
    reference: "writing.md",
    excerpt: [/describe current behavior/, /search the registries/, /let the user pick/],
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
      /maintainer edits/,
      /never pass `--no-maintainer-edit`/,
      /does not authorize enabling Actions or adding secrets/,
    ],
    full: [/maintainer_can_modify/],
  },
  {
    heading: "JavaScript and TypeScript runtime",
    modifier: "bun-runtime",
    reference: "bun-runtime.md",
    excerpt: [/Bun by default/, /Node only when the user explicitly/, /record/],
    full: [/A Bun\s+parent does not change an explicit `node` child/],
  },
  {
    heading: "Compression codecs",
    modifier: "compression-codecs",
    reference: "compression-codecs.md",
    excerpt: [/zstd, then brotli,\s+then gzip/, /Accept-Encoding/],
    full: [/permessage-deflate/, /single runs on Node/],
  },
];
const modifiers = SECTIONS.flatMap((s) => (s.modifier ? [s.modifier] : []));
const MAX_EXCERPT_BYTES = 900;
const MAX_ALL_EXCERPTS_BYTES = 6000;
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
