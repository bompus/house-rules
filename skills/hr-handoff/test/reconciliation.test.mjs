import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const skill = join(import.meta.dirname, "..");
const script = join(skill, "scripts", "check-reconciliation.mjs");
const directories = [];
const fixture = (name) => JSON.parse(readFileSync(join(skill, "assets", name), "utf8"));

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function setup(change = () => {}) {
  const receipt = fixture("receipt.example.json");
  const source = fixture("source.example.json");
  const ledger = fixture("ledger.example.json");
  change(receipt, source, ledger);
  const directory = mkdtempSync(join(tmpdir(), "handoff-reconciliation-"));
  directories.push(directory);
  for (const [name, data] of [
    ["receipt.json", receipt],
    ["source.example.json", source],
    ["ledger.example.json", ledger],
  ])
    writeFileSync(join(directory, name), JSON.stringify(data));
  return { directory, file: join(directory, "receipt.json") };
}

function run(file, executable = process.execPath) {
  const result = spawnSync(executable, [script, file], { encoding: "utf8" });
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  expect(result.stderr).toBe("");
  return { code: result.status, stdout: result.stdout, report: JSON.parse(result.stdout) };
}

test("accounts for independent session and child ledger records; keeps dependency ownership", () => {
  const { file } = setup();
  const result = run(file);
  expect(result.code).toBe(0);
  expect(result.report).toMatchObject({
    status: "complete",
    sources: 2,
    records: 4,
    items: 3,
    errors: [],
    gaps: [],
  });
  expect(result.report.limits).toContain("Does not prove semantic completeness");
});

const invalid = [
  [
    "omitted user request",
    (r) => {
      r.accounting.shift();
    },
    'unaccounted record ["current","request-1"]',
  ],
  [
    "omitted child-ledger candidate",
    (r) => {
      r.items.pop();
    },
    "unknown outcome item evaluation",
  ],
  [
    "stale open row after completion",
    (r) => {
      r.items[0].state = "open";
    },
    "state open contradicts latest outcome done",
  ],
  [
    "complete claim with unknown export total",
    (r) => {
      r.sources[0].expectedRecords = null;
    },
    "complete coverage claimed despite source gaps",
  ],
  [
    "complete claim with omitted export records",
    (r) => {
      r.sources[0].expectedRecords = 4;
    },
    "complete coverage claimed despite source gaps",
  ],
  [
    "complete claim with declared truncation",
    (r) => {
      r.sources[0].gaps.push("Record text truncated");
    },
    "complete coverage claimed despite source gaps",
  ],
  [
    "missing owned PR inventory",
    (r) => {
      delete r.git.ownedPrs;
    },
    "git.ownedPrs: expected an array",
  ],
  [
    "missing PR owner",
    (r) => {
      delete r.git.dependencyPrs[0].owner;
    },
    ".owner: expected nonempty text",
  ],
  [
    "missing PR URL",
    (r) => {
      delete r.git.ownedPrs[0].url;
    },
    "invalid URL",
  ],
  [
    "missing PR state",
    (r) => {
      delete r.git.ownedPrs[0].state;
    },
    "invalid state",
  ],
  [
    "missing dependency check evidence",
    (r) => {
      r.git.dependencyPrs[0].evidence = [];
    },
    "evidence required",
  ],
  [
    "foreign PR treated as owned",
    (r) => {
      r.git.ownedPrs.push(r.git.dependencyPrs.pop());
    },
    "owner differs from receipt owner",
  ],
  [
    "PR in both ownership lists",
    (r) => {
      r.git.dependencyPrs.push(r.git.ownedPrs[0]);
    },
    "duplicate PR across inventories",
  ],
  [
    "unknown evidence record",
    (r) => {
      r.items[0].evidence[0].record = "missing";
    },
    "unknown evidence",
  ],
  [
    "old evidence for latest disposition",
    (r) => {
      r.items[0].evidence[0].record = "request-1";
    },
    "latest outcome must be included",
  ],
  [
    "duplicate source record",
    (_r, s) => {
      s.records.push(s.records[0]);
    },
    "duplicate id request-1",
  ],
  [
    "ambiguous context-only accounting",
    (r) => {
      r.accounting[0].context = "No task";
    },
    "supply item IDs or a context-only reason",
  ],
  [
    "invalid calendar date",
    (r) => {
      r.git.checkedAt = "2025-02-30T00:00:00Z";
    },
    "expected a UTC ISO timestamp",
  ],
];
for (const [name, change, finding] of invalid) {
  test(name, () => {
    const { file } = setup(change);
    const result = run(file);
    expect(result.code).toBe(1);
    expect(result.report.status).toBe("invalid");
    expect(result.report.errors.join("\n")).toContain(finding);
  });
}

function reopen(receipt, source, explicit) {
  source.records.push({
    id: "reopen-1",
    text: "User requests another parser case after completion.",
    at: "2025-01-01T11:00:00Z",
    outcome: { item: "parser", state: "open", reopens: explicit },
  });
  receipt.sources[0].expectedRecords = 4;
  receipt.accounting.push({ source: "current", record: "reopen-1", items: ["parser"] });
  receipt.items[0].state = "open";
  receipt.items[0].evidence = [{ source: "current", record: "reopen-1" }];
}

test("requires a declared later reopening; accepts it without restoring the old done state", () => {
  const bad = setup((r, s) => reopen(r, s, false));
  expect(run(bad.file).report.errors.join("\n")).toContain(
    "reopening needs a declared later request",
  );
  const good = setup((r, s) => reopen(r, s, true));
  expect(run(good.file).code).toBe(0);
});

test("conflicting outcomes at one timestamp cannot be resolved by input order", () => {
  const { file } = setup((r, s) => {
    reopen(r, s, true);
    s.records.at(-1).at = "2025-01-01T10:00:00Z";
  });
  const result = run(file);
  expect(result.code).toBe(1);
  expect(result.report.errors.join("\n")).toContain("conflicting outcomes at the same time");
});

test("a missing earlier transcript preserves a valid partial low-quota receipt", () => {
  const { file } = setup((r) => {
    r.coverage = "partial";
    r.sources.push({
      id: "earlier",
      file: "unavailable.json",
      snapshot: "Earlier session unavailable",
      expectedRecords: null,
      gaps: ["Export unavailable at quota stop"],
    });
  });
  const result = run(file);
  expect(result.code).toBe(2);
  expect(result.report).toMatchObject({ status: "partial", records: 4, items: 3, errors: [] });
  expect(result.report.gaps.join("\n")).toContain("snapshot unavailable");
});

test("declared partial coverage never becomes a complete result", () => {
  const { file } = setup((r) => {
    r.coverage = "partial";
  });
  expect(run(file).code).toBe(2);
});

test("an explicit checked empty PR inventory passes; context-only records need a reason", () => {
  const { file } = setup((r, s) => {
    r.git.ownedPrs = [];
    r.git.dependencyPrs = [];
    s.records.push({ id: "context-1", text: "A routine acknowledgement." });
    r.sources[0].expectedRecords = 4;
    r.accounting.push({
      source: "current",
      record: "context-1",
      context: "Acknowledgement adds no task or decision.",
    });
    s.records[2].text =
      "Checked example/widget: no owned or dependency PRs, no commits without a PR.";
  });
  expect(run(file).code).toBe(0);
});

test("tracks an owned commit without a PR and rejects absent ownership or an invalid object ID", () => {
  const commit = {
    repo: "example/widget",
    branch: "feature/parser",
    sha: "a".repeat(40),
    owner: "session-example",
    evidence: [{ source: "current", record: "git-1" }],
    next: "Create the PR record before landing.",
  };
  const good = setup((r) => {
    r.git.commitsWithoutPr.push(commit);
  });
  expect(run(good.file).code).toBe(0);
  const bad = setup((r) => {
    r.git.commitsWithoutPr.push({ ...commit, owner: "session-other", sha: "not-a-sha" });
  });
  const result = run(bad.file);
  expect(result.code).toBe(1);
  expect(result.report.errors.join("\n")).toContain("owner differs from receipt owner");
  expect(result.report.errors.join("\n")).toContain("expected a full Git object ID");
});

test("malformed receipts and sources report errors without echoing input content", () => {
  for (const name of ["receipt.json", "source.example.json"]) {
    const { directory, file } = setup();
    writeFileSync(join(directory, name), '{"private-content-sentinel": invalid}');
    const result = run(file);
    expect(result.code).toBe(1);
    expect(result.report.errors.join("\n")).toContain("invalid");
    expect(result.stdout).not.toContain("private-content-sentinel");
  }
});

test("self-owned PRs cannot disappear into the dependency inventory", () => {
  const { file } = setup((r) => {
    r.git.dependencyPrs.push(r.git.ownedPrs.pop());
  });
  const result = run(file);
  expect(result.code).toBe(1);
  expect(result.report.errors.join("\n")).toContain("self-owned PR belongs in ownedPrs");
});

test("rejected credential URLs do not expose credentials in diagnostics", () => {
  const { file } = setup((r) => {
    r.git.ownedPrs[0].url = "https://user:credential-sentinel@github.com/example/widget/pull/8";
  });
  const result = run(file);
  expect(result.code).toBe(1);
  expect(result.report.errors.join("\n")).toContain("HTTPS URL without credentials");
  expect(result.stdout).not.toContain("credential-sentinel");
});

test("malformed inventory entries retain original diagnostic indexes", () => {
  const { file } = setup((r) => {
    r.git.ownedPrs.unshift(null);
    r.git.ownedPrs[1].owner = "session-other";
    r.git.commitsWithoutPr = [null, { sha: "invalid-object-id" }];
  });
  const result = run(file);
  expect(result.code).toBe(1);
  expect(result.report.errors).toContain("git.ownedPrs[0]: expected an object");
  expect(result.report.errors.join("\n")).toContain("git.ownedPrs[1]: owner differs");
  expect(result.report.errors).toContain("git.commitsWithoutPr[0]: expected an object");
  expect(result.report.errors).toContain("git.commitsWithoutPr[1]: expected a full Git object ID");
});

test("Node and Bun give identical results; repeated execution changes no snapshot or receipt", () => {
  const { directory, file } = setup();
  const bytes = () =>
    Object.fromEntries(
      readdirSync(directory).map((name) => [name, readFileSync(join(directory, name), "utf8")]),
    );
  const before = bytes();
  const first = run(file);
  const second = run(file);
  const node = run(file, "node");
  expect(first.code).toBe(0);
  expect(second.stdout).toBe(first.stdout);
  expect(node.code).toBe(first.code);
  expect(node.stdout).toBe(first.stdout);
  expect(bytes()).toEqual(before);
});
