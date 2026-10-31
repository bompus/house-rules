import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const skill = join(import.meta.dirname, "..");
const script = join(skill, "scripts", "check-reconciliation.mjs");
/** @type {string[]} */
const directories = [];
/** @typedef {(receipt: any, source: any, ledger: any) => void} Change */
/** @type {(name: string) => any} */
const fixture = (name) => JSON.parse(readFileSync(join(skill, "assets", name), "utf8"));

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

/** @param {Change} [change] */
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
  ]) {
    writeFileSync(join(directory, name), JSON.stringify(data));
  }
  return { directory, file: join(directory, "receipt.json") };
}

/**
 * @param {string} file
 * @param {string} [executable]
 */
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

/** @type {[string, Change, string][]} */
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

/**
 * @param {any} receipt
 * @param {any} source
 * @param {boolean} explicit
 */
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

// A predecessor plan read straight from Markdown: each `## Ledger` line is a record named by its line.
const previousPlan = [
  "Owner: session-before",
  "Status: paused",
  "",
  "## Ledger",
  "- [x] parser fix ... evidence: PR 7",
  "- [ ] widget docs",
  "- [~] cache experiment ... trigger: next release",
  "",
  "## Log",
  "- plain text outside the ledger is not a record",
].join("\n");

/**
 * @param {(receipt: any) => void} [change]
 * @param {string} [plan]
 */
function withPlan(change = () => {}, plan = previousPlan) {
  const paths = setup((receipt) => {
    receipt.sources.push({
      id: "previous",
      file: "previous-plan.md",
      snapshot: "Fictional predecessor plan at handoff",
      expectedRecords: 3,
      gaps: [],
    });
    receipt.accounting.push(
      { source: "previous", record: "L5", context: "done before the handoff; PR 7 landed" },
      { source: "previous", record: "L6", items: ["docs"] },
      { source: "previous", record: "L7", items: ["cache"] },
    );
    for (const [id, record, state] of [
      ["docs", "L6", "open"],
      ["cache", "L7", "deferred"],
    ]) {
      receipt.items.push({
        id,
        owner: "session-example",
        state,
        evidence: [{ source: "previous", record }],
        next: "Carried over from the predecessor plan.",
      });
    }
    change(receipt);
  });
  writeFileSync(join(paths.directory, "previous-plan.md"), plan);
  return paths;
}

test("a predecessor plan's ledger lines are records that need accounting", () => {
  expect(run(withPlan().file).report).toMatchObject({ status: "complete", records: 7, errors: [] });
  const omitted = run(withPlan((r) => r.accounting.pop()).file);
  expect(omitted.report.errors).toContain('unaccounted record ["previous","L7"]');
});

test("an open or deferred predecessor line cannot be set aside as context", () => {
  const result = run(
    withPlan((r) => {
      r.accounting[r.accounting.length - 1] = {
        source: "previous",
        record: "L7",
        context: "reopen only if asked",
      };
      r.items.pop();
    }).file,
  );
  expect(result.code).toBe(1);
  expect(result.report.errors).toEqual([
    expect.stringContaining("previous/L7: an open or deferred ledger line needs an item"),
  ]);
});

test("one item that absorbs several open predecessor lines must say why they are one", () => {
  /** @param {string} [reason] */
  const merged = (reason) =>
    withPlan((r) => {
      r.accounting.at(-1).items = ["docs"];
      r.items.pop();
      if (reason) {
        r.items.at(-1).merges = reason;
      }
    }).file;
  expect(run(merged()).report.errors).toEqual([
    expect.stringContaining("item docs: absorbs 2 open or deferred ledger lines"),
  ]);
  expect(run(merged("both lines describe the same docs page")).report.errors).toEqual([]);
  const repeated = withPlan((r) => {
    r.accounting.at(-2).items = ["docs", "docs"];
  }).file;
  expect(run(repeated).report.errors).toEqual([]);
});

test("a Markdown source without a ledger is an error", () => {
  const result = run(withPlan(() => {}, "Owner: x\nStatus: paused\n").file);
  expect(result.report.errors).toContain("source previous: no `## Ledger` section in the plan");
});

test("item lines outside the ledger section are counted as a gap, not read silently", () => {
  const outside = [
    previousPlan,
    "- [ ] open step one",
    "- [~] deferred step",
    "- [x] finished step ... evidence: PR 8",
  ].join("\n");
  const partial = withPlan((r) => {
    r.coverage = "partial";
  }, outside);
  const result = run(partial.file);
  expect(result.code).toBe(2);
  expect(result.report.status).toBe("partial");
  expect(result.report.gaps).toEqual([
    "source previous: 3 item line(s) outside the `## Ledger` section were not read, 2 of them open or deferred (L11, L12); move them into the ledger section",
  ]);
  const claimed = run(withPlan(() => {}, outside).file);
  expect(claimed.code).toBe(1);
  expect(claimed.report.errors).toContain("complete coverage claimed despite source gaps");
});

test("the outside-ledger gap names the first five lines and counts the rest", () => {
  const lines = Array.from({ length: 8 }, (_, index) => `- [ ] outside ${index}`);
  const result = run(
    withPlan(
      (r) => {
        r.coverage = "partial";
      },
      [previousPlan, ...lines].join("\n"),
    ).file,
  );
  expect(result.report.gaps).toEqual([
    expect.stringContaining(
      "8 item line(s) outside the `## Ledger` section were not read, 8 of them open or deferred (L11, L12, L13, L14, L15 and 3 more)",
    ),
  ]);
});

test("item lines after a deeper heading inside the ledger section stay in the ledger", () => {
  const nested = previousPlan.replace(
    "- [~] cache experiment",
    "### Cache\n- [~] cache experiment",
  );
  const paths = withPlan((r) => {
    r.accounting.at(-1).record = "L8";
    r.items.at(-1).evidence = [{ source: "previous", record: "L8" }];
  }, nested);
  expect(run(paths.file).report).toMatchObject({ status: "complete", errors: [], gaps: [] });
});

// The checker says how much of the plan it read: `covered N/M` is the open and deferred item lines it
// mapped to items over every such line in the plan files it was given. Anything short of all of them,
// or a plan it was not given, is never a clean result.
test("a plan read in full reports covered N/N and passes", () => {
  const result = run(withPlan().file);
  expect(result.code).toBe(0);
  expect(result.report.covered).toBe("2/2");
});

test("an open line left unaccounted is reported in covered and fails", () => {
  const result = run(withPlan((r) => r.accounting.pop()).file);
  expect(result.code).toBe(1);
  expect(result.report.covered).toBe("1/2");
  expect(result.report.errors).toContain('unaccounted record ["previous","L7"]');
});

test("lines outside the ledger count against covered, as in the 16 of 101 case", () => {
  const ledger = Array.from({ length: 16 }, (_, index) => `- [ ] step ${index}`);
  const outside = Array.from({ length: 85 }, (_, index) => `- [ ] later ${index}`);
  const plan = [
    "Owner: x",
    "Status: paused",
    "",
    "## Ledger",
    ...ledger,
    "",
    "## Log",
    ...outside,
  ].join("\n");
  const paths = setup((receipt) => {
    receipt.coverage = "partial";
    receipt.sources.push({
      id: "previous",
      file: "previous-plan.md",
      snapshot: "Plan at handoff",
      expectedRecords: 16,
      gaps: [],
    });
    ledger.forEach((_, index) => {
      receipt.accounting.push({ source: "previous", record: `L${index + 5}`, items: ["merged"] });
    });
    receipt.items.push({
      id: "merged",
      owner: "session-example",
      state: "open",
      merges: "all sixteen are one effort",
      evidence: [{ source: "previous", record: "L5" }],
      next: "Carry on.",
    });
  });
  writeFileSync(join(paths.directory, "previous-plan.md"), plan);
  const result = run(paths.file);
  expect(result.code).toBe(2);
  expect(result.report.status).toBe("partial");
  expect(result.report.covered).toBe("16/101");
});

test("a receipt that reads no plan is partial, not complete, unless it says there is none", () => {
  const claimed = run(
    setup((receipt) => {
      delete receipt.plan;
    }).file,
  );
  expect(claimed.code).toBe(1);
  expect(claimed.report.errors).toContain("complete coverage claimed despite source gaps");
  const unnamed = run(
    setup((receipt) => {
      delete receipt.plan;
      receipt.coverage = "partial";
    }).file,
  );
  expect(unnamed.code).toBe(2);
  expect(unnamed.report.status).toBe("partial");
  expect(unnamed.report.covered).toBe("0/0");
  expect(unnamed.report.gaps).toEqual([expect.stringContaining("no plan ledger was read")]);
  const none = run(setup().file);
  expect(none.code).toBe(0);
  expect(none.report.covered).toBe("0/0");
  const bad = run(
    setup((receipt) => {
      receipt.plan = "see the other file";
    }).file,
  );
  expect(bad.code).toBe(1);
  expect(bad.report.errors).toContain(
    'plan: expected "none: <reason>" when no plan file is a source',
  );
});

test("a ledger section that parses to no item lines is an error", () => {
  const result = run(
    withPlan(() => {}, "Owner: x\nStatus: paused\n\n## Ledger\n\nnothing here\n").file,
  );
  expect(result.code).toBe(1);
  expect(result.report.errors).toContain(
    "source previous: the `## Ledger` section has no item lines",
  );
});

test("table rows in the ledger section are counted as unread lines", () => {
  const plan = [
    previousPlan.split("\n## Log")[0],
    "| step | state |",
    "| --- | --- |",
    "| table step one | open |",
    "| table step two | open |",
  ].join("\n");
  const result = run(
    withPlan((r) => {
      r.coverage = "partial";
    }, plan).file,
  );
  expect(result.code).toBe(2);
  expect(result.report.covered).toBe("2/4");
  expect(result.report.gaps).toEqual([
    expect.stringContaining("2 table row(s) in the plan were not read"),
  ]);
});

/** @param {string[]} extra */
const planWith = (extra) => previousPlan.replace("\n## Log", `\n${extra.join("\n")}\n\n## Log`);

test("checklist lines in other bullet styles are read as items, not dropped", () => {
  for (const line of ["+ [ ] forgotten", "1. [ ] forgotten", "2) [~] forgotten"]) {
    const result = run(withPlan(() => {}, planWith([line])).file);
    expect(result.code).toBe(1);
    expect(result.report.covered).toBe("2/3");
    expect(result.report.errors).toContain('unaccounted record ["previous","L9"]');
  }
});

test("a checklist line with another mark is an unread line, never a clean result", () => {
  const result = run(
    withPlan(
      (r) => {
        r.coverage = "partial";
      },
      planWith(["- [?] forgotten", "- [] also forgotten"]),
    ).file,
  );
  expect(result.code).toBe(2);
  expect(result.report.covered).toBe("2/3");
  expect(result.report.gaps).toEqual([
    expect.stringContaining("1 checklist line(s) with a mark other than space, x, ~ or -"),
  ]);
});

test("tables without leading pipes, and rows that follow a separator-like row, are counted", () => {
  const plain = ["task | state", "--- | ---", "forgotten | open"];
  const established = [
    "| task | state |",
    "| --- | --- |",
    "| one | open |",
    "| --- | --- |",
    "| two | open |",
  ];
  /** @type {[string[], string][]} */
  const cases = [
    [plain, "2/3"],
    [established, "2/5"],
  ];
  for (const [rows, expected] of cases) {
    const result = run(
      withPlan((r) => {
        r.coverage = "partial";
      }, planWith(rows)).file,
    );
    expect(result.code).toBe(2);
    expect(result.report.covered).toBe(expected);
    expect(result.report.gaps).toEqual([expect.stringContaining("table row(s)")]);
  }
});

test("a table example in a fenced block of the ledger is not unread work", () => {
  const fenced = ["```", "| step | state |", "| --- | --- |", "| example | open |", "```"];
  const result = run(withPlan(() => {}, planWith(fenced)).file);
  expect(result.code).toBe(0);
  expect(result.report.covered).toBe("2/2");
});

test("covered survives a later failure to validate the receipt", () => {
  const result = run(
    withPlan((r) => {
      r.items[0].evidence = { some: "bad" };
    }).file,
  );
  expect(result.code).toBe(1);
  expect(result.report.covered).toBe("2/2");
});

test("a table outside the ledger section counts, and so does a row without pipes", () => {
  const withLog = (/** @type {string[]} */ rows) =>
    previousPlan.replace("- plain text outside the ledger is not a record", rows.join("\n"));
  /** @type {[string[], string][]} */
  const cases = [
    [["| task | state |", "| --- | --- |", "| forgotten | open |"], "2/3"],
    [["task | state", "--- | ---", "[ ] forgotten work"], "2/3"],
  ];
  for (const [rows, expected] of cases) {
    const result = run(
      withPlan((r) => {
        r.coverage = "partial";
      }, withLog(rows)).file,
    );
    expect(result.code).toBe(2);
    expect(result.report.covered).toBe(expected);
  }
});

test("a fence closes only with its own delimiter, so a table after it is still read", () => {
  const tricky = [
    "~~~md",
    "```",
    "~~~",
    "",
    "| task | state |",
    "| --- | --- |",
    "| forgotten | open |",
  ];
  const result = run(
    withPlan((r) => {
      r.coverage = "partial";
    }, planWith(tricky)).file,
  );
  expect(result.code).toBe(2);
  expect(result.report.covered).toBe("2/3");
});

test("a checklist line that looks like a table header is still a checklist line", () => {
  const result = run(withPlan(() => {}, planWith(["- [ ] forgotten | open", "--- | ---"])).file);
  expect(result.code).toBe(1);
  expect(result.report.covered).toBe("2/3");
  expect(result.report.errors).toContain('unaccounted record ["previous","L9"]');
});

test("a one-column table, an inline code span that looks like a fence and an emoji mark are all counted", () => {
  /** @type {[string[], string][]} */
  const cases = [
    [["task", "| --- |", "forgotten work"], "2/3"],
    [["```inline``` is not a fence", "| task |", "| --- |", "| forgotten |"], "2/3"],
    [["- [\u{1F4A9}] forgotten"], "2/3"],
  ];
  for (const [rows, expected] of cases) {
    const result = run(
      withPlan((r) => {
        r.coverage = "partial";
      }, planWith(rows)).file,
    );
    expect(result.code).toBe(2);
    expect(result.report.covered).toBe(expected);
  }
});

test("a table or task inside a blockquote is counted like one outside it", () => {
  /** @type {[string[], string][]} */
  const cases = [
    [["> | task | state |", "> | --- | --- |", "> | forgotten | open |"], "2/3"],
    [["> > task | state", "> > --- | ---", "> > forgotten work"], "2/3"],
  ];
  for (const [rows, expected] of cases) {
    const result = run(
      withPlan((r) => {
        r.coverage = "partial";
      }, planWith(rows)).file,
    );
    expect(result.code).toBe(2);
    expect(result.report.covered).toBe(expected);
  }
  const quotedTask = run(withPlan(() => {}, planWith(["> - [ ] forgotten"])).file);
  expect(quotedTask.code).toBe(1);
  expect(quotedTask.report.covered).toBe("2/3");
});

test("a fence opened inside a block quote ends with the quote", () => {
  const rows = ["> ```", "task | state", "--- | ---", "forgotten | open", "> ```"];
  const result = run(
    withPlan((r) => {
      r.coverage = "partial";
    }, planWith(rows)).file,
  );
  expect(result.code).toBe(2);
  expect(result.report.covered).toBe("2/3");
});
