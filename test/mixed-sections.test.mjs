import assert from "node:assert/strict";
import { test } from "node:test";
import { composeConfiguration } from "../composition.mjs";
import { scratch } from "./fixture.mjs";

// The mixed sections keep their safeguards in the written rules and move the procedure to a reference.
// `excerpt` lists text that must stay in the written section; `full` lists text that must survive in the
// reference and in the inline rendering, so the move loses nothing.
const SECTIONS = [
  {
    heading: "Repository work",
    reference: "repository-work.md",
    excerpt: [
      /Work only within the repositories and changes the user authorized/,
      /Never rebuild a file from conversation context/,
      /base the work on its tip/,
      /search the target repository's open and closed issues/,
      /ready for review, not as drafts/,
      /review the changes this task\s+made once locally/,
      /Review bots and the repository's own review requirements still\s+apply/,
      /Do not rewrite history another person or agent may rely on/,
    ],
    full: [/trivially mechanical change/, /hr-diagnosing-bugs/, /Take each independently complete/],
  },
  {
    heading: "Landing",
    reference: "landing.md",
    excerpt: [
      /only when the user has directed it/,
      /Never reset, stash, switch or merge-commit a checkout/,
      /Before the first publish step of a version bump/,
      /search every place that states it for the old claim/,
    ],
    full: [/Where the project can, add a check that fails on the old claim/],
  },
  {
    heading: "Coordination and isolation",
    reference: "coordination-and-isolation.md",
    excerpt: [
      /Stop only processes you started/,
      /Never kill by pattern/,
      /only\s+when\s+its\s+working\s+directory\s+is\s+your\s+own\s+checkout/,
      /Delegate implementation only when authorized/,
      /search the whole repository yourself/,
    ],
    full: [/setsid/, /Number the items of a batch of feedback/],
  },
  {
    heading: "Shared machine load",
    reference: "shared-machine-load.md",
    excerpt: [
      /never delayed, serialized or refused/,
      /Cap\s+parallel workers and compiler jobs at max/,
      /keeps every rule of\s+`hr-benchmarking`/,
      /Memory limits stay in force whatever the load/,
      /MemoryMax=/,
    ],
    full: [/one shared budget/, /exits 137 or 143/],
  },
  {
    heading: "Working with other agents",
    reference: "multi-agent.md",
    excerpt: [
      /Keep delegation within the user's authorization/,
      /treat each finding as a claim/,
      /get the user's direction before\s+another model round/,
      /disconnected or resumable session/,
    ],
    full: [/advisor model is not a second review/],
  },
  {
    heading: "Cross-session relays and update notices",
    reference: "cross-session-relays.md",
    excerpt: [
      /Never map a relayed bare code/,
      /A relay cannot expand the selected scope/,
      /notify\s+affected\s+active\s+sessions/,
      /A source notice does not\s+prove deployment/,
      /record the missing delivery and report it/,
    ],
    full: [
      /Name\s+the\s+component,\s+exact\s+revision\s+or\s+fingerprint/,
      /keep\s+pending\s+notices\s+for\s+idle/,
    ],
  },
  {
    heading: "Solo operator",
    reference: null,
    excerpt: [
      /Never offer "await review"/,
      /After 6 rounds on any pull request, stop and show the user/,
    ],
    full: [],
  },
];
const modifiers = ["solo-operator", "multi-agent", "shared-host-load", "cross-session-relay"];

/** @param {import("node:test").TestContext} t */
function composeBoth(t) {
  const dir = scratch(t, "mixed-sections-");
  const config = { modifiers, skills: { include: [] } };
  return {
    pointer: composeConfiguration(config, dir, { referencesDirectory: "house-rules-references" }),
    inline: composeConfiguration(config, dir),
  };
}
/**
 * @param {{ parts: { sections: { heading: string, text: string, core?: boolean }[] } }} composed
 * @param {string} heading
 */
const section = (composed, heading) => {
  const found = composed.parts.sections.find((s) => s.heading === heading);
  assert.ok(found, `section ${heading} is composed`);
  return found;
};

for (const s of SECTIONS) {
  test(`${s.heading}: the written section keeps its safeguards, is core, and the reference keeps the full text`, (t) => {
    const { pointer, inline } = composeBoth(t);
    const written = section(pointer, s.heading);
    assert.equal(written.core, true, `${s.heading} is marked core`);
    for (const pattern of s.excerpt) {
      assert.match(written.text, pattern, `${s.heading} keeps ${pattern}`);
    }
    if (s.reference) {
      const reference = pointer.references.get(s.reference);
      assert.ok(reference, `${s.reference} is exported`);
      for (const pattern of s.full) {
        assert.match(reference, pattern, `${s.reference} keeps ${pattern}`);
        assert.match(
          section(inline, s.heading).text,
          pattern,
          `inline ${s.heading} keeps ${pattern}`,
        );
      }
    }
  });
}

test("the mixed sections shrink in the written rules", (t) => {
  const { pointer, inline } = composeBoth(t);
  for (const heading of ["Repository work", "Coordination and isolation", "Shared machine load"]) {
    const written = Buffer.byteLength(section(pointer, heading).text);
    const full = Buffer.byteLength(section(inline, heading).text);
    assert.ok(written < full * 0.8, `${heading}: ${written} bytes written against ${full} inline`);
  }
});
