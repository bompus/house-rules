#!/usr/bin/env bun
// Render a model comparison report: data JSON in, self-contained HTML out.
//
//   bun render-report.ts <data.json> <out.html>
//
// Data shape and section types: ../SKILL.md. Example data:
// ../assets/example-report.json.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Series = { name: string; slot?: number; reference?: boolean };
type Section = {
  type: string;
  items?: Section[];
  series?: { key: string }[];
  rows?: { key?: string }[];
};
export type ReportData = { title?: string; series: Record<string, Series>; sections: Section[] };

const TYPES = new Set(["curve", "ladder", "bars", "table", "pair"]);

/** Problems that would make the page wrong or unreadable; empty when the data is usable. */
export function check(data: ReportData): string[] {
  const errors: string[] = [];
  const entries = Object.entries(data.series);
  const colored = entries.filter(([, s]) => !s.reference);
  // The template's three dark-surface slots pass the all-pairs color-vision check;
  // a fourth hue does not, so further series must be a dashed reference or a separate chart.
  if (colored.length > 3) {
    errors.push(
      `at most 3 colored series (got ${colored.length}); mark one more "reference": true or put the rest in a separate report`,
    );
  }
  if (entries.filter(([, s]) => s.reference).length > 1) {
    errors.push("at most one reference series");
  }
  const slots = colored.map(([, s]) => s.slot);
  if (
    slots.some((s) => s === undefined || s < 0 || s > 2) ||
    new Set(slots).size !== slots.length
  ) {
    errors.push("each colored series needs a distinct slot 0, 1 or 2");
  }
  const walk = (sections: Section[], path: string) =>
    sections.forEach((s, i) => {
      const where = `${path}[${i}]`;
      if (!TYPES.has(s.type)) {
        errors.push(`${where}: unknown type ${s.type}`);
      }
      for (const k of [
        ...(s.series ?? []).map((r) => r.key),
        ...(s.rows ?? []).map((r) => r.key),
      ]) {
        if (k !== undefined && !data.series[k]) {
          errors.push(`${where}: series key ${k} is not declared`);
        }
      }
      if (s.items) {
        walk(s.items, `${where}.items`);
      }
    });
  walk(data.sections, "sections");
  return errors;
}

export function render(data: ReportData, template: string): string {
  const errors = check(data);
  if (errors.length) {
    throw new Error(errors.join("\n"));
  }
  // Inside <script>, a literal "</" would close the element early.
  return template.replace("__REPORT_DATA__", () => JSON.stringify(data).replaceAll("</", "<\\/"));
}

if (import.meta.main) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    throw new Error("usage: bun render-report.ts <data.json> <out.html>");
  }
  const template = readFileSync(
    join(import.meta.dir, "..", "assets", "report-template.html"),
    "utf8",
  );
  writeFileSync(output, render(JSON.parse(readFileSync(input, "utf8")), template));
  console.log(output);
}
