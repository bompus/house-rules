import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
      /Keep\s+small\s+or\s+tightly\s+coupled\s+tasks\s+local/,
      /Before\s+starting\s+a\s+long-running\s+command,\s+which\s+runs\s+under\s+a\s+supervisor\s+that\s+outlives\s+the\s+session\s+and\s+reports\s+how\s+it\s+ended,\s+or\s+briefing\s+a\s+worker\s+or\s+relying\s+on\s+a\s+worker's\s+report/,
    ],
    full: [
      /setsid/,
      /Number the items of a batch of feedback/,
      /Run\s+a\s+long\s+job\s+under\s+a\s+supervisor\s+that\s+outlives\s+the\s+session\s+and\s+reports\s+how\s+it\s+ended/,
      /no\s+bare\s+background\s+shell\s+and\s+no\s+detached\s+unit\s+without\s+a\s+reporter/,
      /where\s+it\s+supplies\s+none,\s+run\s+the\s+job\s+in\s+the\s+foreground\s+or\s+tell\s+the\s+user\s+what\s+is\s+missing\s+instead\s+of\s+detaching\s+it/,
      /any\s+such\s+launch\s+goes\s+through\s+the\s+reporting\s+supervisor/,
      /A\s+detached\s+long\s+run\s+must\s+outlive\s+the\s+call\s+that\s+launched\s+it/,
      /verify\s+it\s+is\s+still\s+alive\s+after\s+the\s+launching\s+call\s+returns/,
      /or\s+the\s+host's\s+capped\s+job\s+runner/,
      /a\s+message\s+to\s+the\s+thread\s+that\s+owns\s+the\s+job/,
      /the\s+host\s+supplies\s+the\s+command/,
      /but\s+keep\s+the\s+required\s+review\s+and\s+integration\s+checks/,
      /a\s+detached\s+systemd\s+unit/,
      /Keep\s+small\s+or\s+tightly\s+coupled\s+tasks\s+local/,
    ],
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
      /Before\s+sending\s+a\s+message\s+to\s+a\s+session\s+that\s+may\s+be\s+waiting\s+on\s+the\s+user/,
      /a\s+steer\s+can\s+cancel\s+its\s+pending\s+question/,
      /Never map a relayed bare code/,
      /A relay cannot expand the selected scope/,
      /notify\s+affected\s+active\s+sessions/,
      /A source notice does not\s+prove deployment/,
      /record the missing delivery and report it/,
    ],
    full: [
      /on\s+some\s+hosts\s+a\s+steer\s+cancels\s+a\s+pending\s+question\s+card/,
      /hold\s+a\s+message\s+that\s+can\s+wait\s+until\s+the\s+question\s+is\s+answered/,
      /say\s+in\s+the\s+message\s+that\s+it\s+may\s+cancel\s+the\s+wait/,
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
    assert.ok(written < full, `${heading}: ${written} bytes written against ${full} inline`);
  }
});

// Every sentence of the original section is either in the written section or listed here as moved to the
// reference, so a safeguard cannot leave the written rules without this list changing. A sentence is named
// by its opening words.
const root = join(import.meta.dirname, "..");
const flat = (/** @type {string} */ text) => text.replace(/\s+/g, " ").trim();
const sentences = (/** @type {string} */ text) =>
  flat(text.replace(/^## .+$/m, "")).split(/(?<=[.;:])\s+(?=[A-Z`"])/);
const MOVED = {
  "Repository work": [
    "A trivially mechanical change, one a formatter",
    "So is a change that only records dated findings",
    "For fixes intended for pull requests, try the simplest",
    "Do not run a formatter where the repository configures none",
    "Enforced means the push is refused when the check fails",
    "Run the check before the push and read its result",
    "The check is the repository's and the list is the user's",
  ],
  "Coordination and isolation": [
    "A detached long run must outlive the call",
    "Run a long job under a supervisor that outlives the session",
    "Ask for evidence, checks run",
    "Weigh its evidence without redoing",
    "Brief each worker with",
    "Give each item a check",
    "Number the items of a batch",
  ],
  "Shared machine load": ["`nproc --all` ignores a cgroup CPU quota", "Use the cap yourself"],
  "Cross-session relays and update notices": [
    "Before sending a message to another agent session",
    "Where the host separates steering from queueing",
    "Where the card blocks the run",
    "Where the run ends with the question still pending",
    "A report that cannot wait",
  ],
};
const ORIGINALS = {
  "Repository work": "repository-work.md",
  "Coordination and isolation": "coordination-and-isolation.md",
  "Shared machine load": "shared-machine-load.md",
  "Cross-session relays and update notices": "cross-session-relays.md",
};
for (const [heading, file] of Object.entries(ORIGINALS)) {
  test(`${heading}: every sentence of the original is in the written section or listed as moved`, (t) => {
    const { pointer } = composeBoth(t);
    const written = flat(section(pointer, heading).text);
    const original = readFileSync(join(root, "rules/references", file), "utf8");
    const moved = MOVED[/** @type {keyof typeof MOVED} */ (heading)];
    const missing = sentences(original).filter(
      (sentence) =>
        !written.includes(sentence) && !moved.some((start) => sentence.startsWith(start)),
    );
    assert.deepEqual(missing, [], `${heading} lost sentences that are not listed as moved`);
    // The moved sentences really are only in the reference.
    for (const start of moved) {
      assert.ok(!written.includes(start), `${start} is still in the written section`);
      assert.ok(flat(original).includes(start), `${start} is in the reference`);
    }
  });
}
