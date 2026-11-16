import { expect, test } from "bun:test";
import { planSnapshot, recheckField } from "../scripts/plan-ledger.mjs";

test("the re-check field is the first one outside a code span, by whole name, with its value as typed", () => {
  const dates = (/** @type {string} */ text) => recheckField(text);
  expect(dates("Document `recheck: 2099-01-01`; trigger: x; recheck: 2020-01-01")).toEqual({
    written: "2020-01-01",
    date: "2020-01-01",
  });
  expect(dates("Document `recheck: 2020-01-01`; trigger: x; recheck: 2099-01-01").date).toBe(
    "2099-01-01",
  );
  expect(dates("last-recheck: 2020-01-01; recheck: 2099-01-01").date).toBe("2099-01-01");
  expect(dates("last-recheck: 2020-01-01")).toEqual({ written: null, date: null });
  expect(dates("trigger: x; recheck: `2020-01-01`").date).toBe("2020-01-01");
  expect(dates("`recheck: 2020-01-01` only").date).toBe("2020-01-01");
  expect(dates("`recheck: 2020-01-01` and `recheck: 2021-01-01`")).toEqual({
    written: null,
    date: null,
  });
  // An invalid actual field is not replaced by a quoted example, and never throws.
  expect(dates("`recheck: 2020-01-01`; recheck: 2026-02-301")).toEqual({
    written: "2026-02-301",
    date: null,
  });
  for (const bad of ["2026-13-01", "2026-00-01", "2026-02-31", "2026-10-291"]) {
    expect(dates(`recheck: ${bad}`)).toEqual({ written: bad, date: null });
  }
});

test("the re-check date is the date-shaped prefix of the value, so punctuation or emphasis after it does not void it", () => {
  for (const text of [
    "x; recheck: 2020-01-01.",
    "(recheck: 2020-01-01)",
    "**recheck: 2020-01-01**",
    "recheck: 2020-01-01, then look",
    "recheck: 2020-01-01]",
    "*recheck: 2020-01-01*",
  ]) {
    expect(recheckField(text), text).toEqual({ written: "2020-01-01", date: "2020-01-01" });
  }
  expect(recheckField("recheck: 2026-02-31.")).toEqual({ written: "2026-02-31", date: null });
  expect(recheckField("recheck: 2020-01-011.")).toEqual({ written: "2020-01-011", date: null });
  expect(recheckField("recheck: soon.")).toEqual({ written: null, date: null });
});

test("the last re-check field written outside a code span is the current one, whatever its value", () => {
  expect(recheckField("recheck: 2020-01-01; later note, recheck: 2099-12-31").date).toBe(
    "2099-12-31",
  );
  expect(recheckField("recheck: 2099-12-31; then recheck: 2020-01-01").date).toBe("2020-01-01");
  expect(recheckField("recheck: 2020-01-01; then recheck: soon")).toEqual({
    written: null,
    date: null,
  });
  expect(recheckField("recheck: 2020-01-01 `recheck: 2099-12-31`").date).toBe("2020-01-01");
});

test("only a dated quoted field counts for the sole-candidate rule, and an undated quoted label is ignored", () => {
  expect(recheckField("`recheck:` and `recheck: 2020-01-01`").date).toBe("2020-01-01");
  expect(recheckField("`recheck:` label only")).toEqual({ written: null, date: null });
  expect(recheckField("`recheck: 2020-01-01` and `recheck: 2021-01-01`").date).toBe(null);
  expect(recheckField("`recheck:`, `recheck:` and `recheck: 2020-01-01`").date).toBe("2020-01-01");
  // An actual undated field still hides a quoted example.
  expect(recheckField("`recheck: 2020-01-01`; recheck: soon").date).toBe(null);
});

test("the plan snapshot records the same re-check field the hook and the checker read", () => {
  const plan = [
    "Owner: t",
    "Status: active",
    "## Ledger",
    "- [ ] a: Document `recheck: 2099-01-01`; trigger: PR 4 lands; recheck: 2020-01-01",
    "- [ ] b: last-recheck: 2020-01-01; recheck: 2099-01-01",
    "",
  ].join("\n");
  const recheck = planSnapshot(plan).openItems.map((item) => item.recheck);
  expect(recheck).toEqual(["2020-01-01", "2099-01-01"]);
});
