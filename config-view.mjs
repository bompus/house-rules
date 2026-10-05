// Human output is grouped and aligned; JSON output bypasses this renderer.
import { styleText } from "node:util";

const clean = (value) => String(value ?? "").replace(/\p{Cc}/gu, " ");
function display() {
  const color =
    process.stdout.isTTY && !Object.hasOwn(process.env, "NO_COLOR") && process.env.TERM !== "dumb";
  const paint = (style, text) => (color ? styleText(style, text, { validateStream: false }) : text);
  const width = Math.max(24, Math.min(process.stdout.columns ?? 100, 120));
  const wrap = (text, size) => {
    const words = clean(text).split(/\s+/);
    const lines = [""];
    for (let word of words) {
      while (word.length > size) {
        if (lines.at(-1)) lines.push("");
        lines[lines.length - 1] = word.slice(0, size);
        word = word.slice(size);
        lines.push("");
      }
      if (lines.at(-1).length + word.length + 1 > size) lines.push("");
      lines[lines.length - 1] += (lines.at(-1) ? " " : "") + word;
    }
    return lines;
  };
  const table = (headers, rows) => {
    const first = Math.max(headers[0].length, ...rows.map((row) => clean(row[0]).length));
    const second = Math.max(headers[1].length, ...rows.map((row) => clean(row[1]).length));
    if (first + second + 14 > width) {
      return rows
        .flatMap((row) => [
          ...wrap(`${row[0]}  [${row[1]}]`, width - 2).map((l) => `  ${paint("bold", l)}`),
          ...wrap(row[2], width - 4).map((l) => `    ${l}`),
          "",
        ])
        .join("\n");
    }
    const third = width - first - second - 8;
    const line = (a, b, c) => {
      const state = b.padEnd(second);
      return `  ${a.padEnd(first)}  ${paint(b === "on" ? "green" : b === "off" ? "dim" : "cyan", state)}  ${c}`;
    };
    const heading = paint("dim", line(...headers));
    return [
      heading,
      ...rows.flatMap(([a, b, c]) =>
        wrap(c, third).map((text, index) =>
          line(index ? "" : clean(a), index ? "" : clean(b), text),
        ),
      ),
    ].join("\n");
  };
  return { paint, table, wrap, width };
}

export function renderHelp() {
  const { paint, table } = display();
  return [
    "",
    `  ${paint("dim", "╭─")} ${paint("cyan", paint("bold", "HOUSE RULES"))}  ${paint("dim", "configuration")}`,
    "",
    "  node compose.mjs config <command> [options]",
    "",
    table(
      ["Command", "Writes", "Purpose"],
      [
        ["catalog", "no", "Browse modifiers, skills and rule sections."],
        ["status", "no", "See selections, personal origins and current revision."],
        ["validate", "no", "Check configuration and compose every selected layer."],
        ["preview", "no", "Review proposed selections; --rules prints composed rules."],
        ["set", "opt-in", "Preview changes, then save with --apply --expect <revision>."],
      ],
    ),
    "",
    "  Selection",
    "    --enable-modifier <name>    --disable-modifier <name>",
    "    --enable-skill <name>       --disable-skill <name>",
    "    --questions plain|coded|cards",
    "",
    "  Output",
    "    --config <path>   --json   --rules (preview only)",
    "",
    "  Repeat toggle flags to change several selections together.",
    "  Saving config does not regenerate output or connect agent hosts.",
    "",
  ].join("\n");
}

export function renderConfig(report) {
  const { paint, table, wrap, width } = display();
  const lines = [
    "",
    `  ${paint("dim", "╭─")} ${paint("cyan", paint("bold", "HOUSE RULES"))}  ${paint("dim", report.command)}`,
    "",
  ];
  const section = (label) => lines.push(`  ${paint("bold", label)}`, "");
  const detail = (text) => lines.push(...wrap(text, width - 2).map((l) => `  ${l}`));
  detail(`Config  ${report.configPath}${report.exists ? "" : " (not created)"}`);
  detail(`Revision  ${report.applied?.revision ?? report.revision}`);
  lines.push("");
  const enabled = report.modifiers.filter((m) => m.enabled).length;
  detail(
    `${enabled}/${report.modifiers.length} modifiers enabled   ${report.skills.filter((s) => s.enabled).length}/${report.skills.length} skills selected   ${report.rules.length} rule sections`,
  );
  detail(`Configured questions  ${report.questions}   Host loading  ${report.hostLoading}`);
  lines.push("");
  if (["set", "preview"].includes(report.command)) {
    section(
      report.applied
        ? report.applied.changed
          ? "Configuration saved"
          : "Already configured"
        : "Change preview",
    );
    if (!report.changes.length) detail("No selection changes.");
    for (const change of report.changes) {
      detail(change.key);
      const removed = change.before.filter((name) => !change.after.includes(name));
      const added = change.after.filter((name) => !change.before.includes(name));
      for (const [sign, names, style] of [
        ["-", removed, "red"],
        ["+", added, "green"],
      ]) {
        for (const name of names) lines.push(`    ${paint(style, `${sign} ${clean(name)}`)}`);
      }
      if (!removed.length && !added.length) detail("Selection order changed.");
    }
    lines.push("");
    if (!report.applied) {
      detail(
        report.command === "set"
          ? `To save, repeat with --apply --expect ${report.revision}`
          : `To save, run config set with the same selection flags plus --apply --expect ${report.revision}`,
      );
      detail("Review personal rule overrides below before choosing a question format.");
    } else
      detail(
        "Next, recompose output with compose.mjs or rerun the installer. Existing skills directories are retained; host connection is separate.",
      );
    lines.push("");
  }
  if (report.command === "validate") detail("Configuration and composition are valid.");
  else if (["status", "catalog"].includes(report.command)) {
    section("Modifiers");
    lines.push(
      table(
        ["Name", "State", "Purpose"],
        report.modifiers.map((m) => [m.name, m.enabled ? "on" : "off", m.description]),
      ),
      "",
    );
    section("Skills");
    lines.push(
      table(
        ["Name", "State", report.command === "catalog" ? "Purpose" : "Origin"],
        report.skills.map((s) => [
          s.name,
          s.enabled ? "on" : "off",
          report.command === "catalog" ? s.description : s.origin,
        ]),
      ),
      "",
    );
    section("Effective rules");
    lines.push(
      table(
        ["Section", "State", "Source"],
        report.rules.map((r) => [r.heading, "active", r.origin]),
      ),
      "",
    );
    section("Personal layers");
    for (const layer of report.layers) detail(layer);
  }
  const personal = report.rules.filter(
    (rule) => rule.source !== "core" && !rule.source.startsWith("modifier "),
  );
  if (["preview", "set"].includes(report.command) && personal.length) {
    section("Personal rule overrides and additions");
    lines.push(
      table(
        ["Section", "State", "Source"],
        personal.map((r) => [r.heading, "active", r.origin]),
      ),
      "",
    );
  }
  for (const name of report.unavailable)
    detail(`Retained exclusion with no current source: ${name}`);
  for (const warning of report.warnings) detail(`Warning: ${warning}`);
  lines.push("");
  detail("Status describes composed selections. It does not verify an agent's loaded context.");
  lines.push(`  ${paint("dim", "╰─")}`);
  return lines.join("\n");
}
