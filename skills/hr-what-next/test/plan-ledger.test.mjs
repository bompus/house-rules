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
