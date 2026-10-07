// Numbered selection flow. Only the existing revision-checked config writer saves.
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs, stripVTControlCharacters } from "node:util";
import { configurationPath, modifierList } from "./composition.mjs";
import {
  changeSelection,
  configCommand,
  readConfiguration,
  selectionChanges,
  selectionReport,
  writeConfiguration,
} from "./config.mjs";
import { renderConfig } from "./config-view.mjs";

const HELP = `Choose guidance with numbered prompts:
  house-rules setup [--config PATH] [--plain]
  house-rules setup [--config PATH] --json

toggle N [N ...] or toggle NAME changes the listed choices.
questions plain|coded|cards chooses the question format.
search TEXT, clear search, show selected, show all, help N
next, back, save (on Review), refresh (after a stale revision), cancel

Only an explicit save changes configuration. Output and hosts are separate.
For scripting, use house-rules config help and config set --apply --expect.
--json returns the existing config status report without prompting or writing.`;

// Terminal output must not execute control sequences from personal metadata or paths.
const safe = (value) => String(value).replace(/\p{Cc}/gu, " ");
const quote = (value) =>
  process.platform === "win32"
    ? `'${value.replaceAll("'", "''")}'`
    : `'${value.replaceAll("'", "'\\''")}'`;

export async function setupCommand(argv) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        config: { type: "string" },
        plain: { type: "boolean" },
        json: { type: "boolean" },
        help: { type: "boolean" },
      },
    }));
  } catch (error) {
    error.exitCode = 2;
    throw error;
  }
  if (values.help) return console.log(HELP);
  if (values.json)
    return configCommand([
      "status",
      "--json",
      ...(values.config ? ["--config", values.config] : []),
    ]);
  let snapshot = readConfiguration(configurationPath(values.config));
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error("setup requires a terminal for input and output; no selections saved.");
    console.log(HELP);
    process.exitCode = 2;
    return;
  }

  const intent = new Map();
  let questions,
    stage = 0,
    query = "",
    selectedOnly = false,
    stale = false;
  const options = () => {
    const result = {};
    if (questions !== undefined) result.questions = questions;
    for (const { kind, name, enabled } of intent.values()) {
      const key = `${enabled ? "enable" : "disable"}-${kind}`;
      (result[key] ??= []).push(name);
    }
    return result;
  };
  const draft = () => {
    try {
      const next = changeSelection(snapshot.config, options(), snapshot.path);
      return { next, report: selectionReport(next, snapshot.path) };
    } catch (error) {
      return { error };
    }
  };
  // A valid projection supplies the catalog when stored selections need repair.
  // It is never saved; only explicit user intent is applied to the original snapshot.
  const known = new Set(modifierList().map((m) => m.name));
  const catalog = () => {
    const projection = structuredClone(snapshot.config);
    projection.modifiers = (projection.modifiers ?? []).filter((name) => known.has(name));
    if (
      projection.modifiers.includes("question-cards") &&
      !projection.modifiers.includes("coded-offers")
    )
      projection.modifiers.push("coded-offers");
    return selectionReport(projection, snapshot.path);
  };
  let baseline = catalog(); // Malformed layers, composition or legacy names still stop setup.
  const rows = () => {
    const current = draft();
    const report = current.report ?? baseline;
    const unavailable = (snapshot.config.modifiers ?? []).filter((name) => !known.has(name));
    const modifiers = [
      ...report.modifiers.filter((m) => !["coded-offers", "question-cards"].includes(m.name)),
      ...unavailable.map((name) => ({
        name,
        enabled: true,
        description: "Unavailable modifier; remove to repair the selection.",
      })),
    ].map((row) => ({ ...row, kind: "modifier" }));
    return [...modifiers, ...report.skills.map((row) => ({ ...row, kind: "skill" }))].map(
      (row, index) => ({
        ...row,
        number: index + 1,
        enabled: intent.get(`${row.kind}:${row.name}`)?.enabled ?? row.enabled,
      }),
    );
  };
  const print = (text = "") => {
    const width = Math.max(24, Math.min(process.stdout.columns || 80, 120));
    for (const line of stripVTControlCharacters(String(text)).split("\n")) {
      let rest = safe(line);
      while (rest.length > width) {
        let cut = rest.lastIndexOf(" ", width);
        if (cut < 1) cut = width;
        console.log(rest.slice(0, cut));
        rest = rest.slice(cut).trimStart();
      }
      console.log(rest);
    }
  };
  const printCommand = (command) => {
    if (/\p{Cc}/u.test(command)) {
      print(
        "The path contains control characters. Use config help with the original path arguments.",
      );
      return;
    }
    // Keep one logical line so terminal wrapping does not change copied shell syntax.
    console.log(command);
  };
  const show = () => {
    print(`Choose guidance / ${["Modifiers", "Skills", "Review"][stage]}`);
    print(`Config: ${snapshot.path}`);
    const current = draft();
    if (current.error) print(`Selection needs repair: ${current.error.message}`);
    if (stale)
      print("Configuration changed. Use refresh for a new comparison, then review and save again.");
    if (stage === 2 && current.report) {
      print(
        renderConfig({
          command: "preview",
          configPath: snapshot.path,
          revision: snapshot.revision,
          changes: selectionChanges(snapshot.config, current.next),
          applied: null,
          exists: snapshot.text !== null,
          ...current.report,
        }),
      );
      const flags = Object.entries(options()).flatMap(([key, names]) =>
        (Array.isArray(names) ? names : [names]).flatMap((name) => [`--${key}`, quote(name)]),
      );
      print(
        "Reproduce with the existing config command (POSIX shell on Unix, PowerShell on Windows):",
      );
      printCommand(
        `house-rules config set --config ${quote(snapshot.path)} ${flags.join(" ")} --apply --expect ${quote(snapshot.revision)}`,
      );
      print("Review personal rule overrides. Setup does not interpret or edit their prose.");
      print(
        "Only selections will be saved. Output is not regenerated and hosts are not connected by setup.",
      );
      print("save / back / cancel");
      return;
    }
    print("Core rules: always on. Modifiers are opt-in; skills are on unless excluded.");
    if (stage === 1) {
      const skills = rows().filter((row) => row.kind === "skill");
      print(
        `${skills.filter((row) => !row.enabled).length} of ${skills.length} available skills excluded.`,
      );
    }
    print(`Question format: ${questions ?? baseline.questions}. Use questions plain|coded|cards.`);
    const visible = rows().filter(
      (row) =>
        row.kind === (stage === 0 ? "modifier" : "skill") &&
        (!selectedOnly || row.enabled) &&
        `${row.name} ${row.description}`.toLowerCase().includes(query.toLowerCase()),
    );
    for (const row of visible) {
      print(
        `${row.number}. [${row.enabled ? "on" : "off"}] ${row.name}${row.explicitOnly ? " (explicit only)" : ""}`,
      );
      print(`   ${row.description.split(/(?<=\.)\s/)[0]}`);
    }
    if (!visible.length)
      print(`No matches for ${JSON.stringify(query)}. Use clear search or show all.`);
    if (baseline.unavailable.length)
      print(`Retained unavailable exclusions: ${baseline.unavailable.join(", ")}`);
    print("toggle N [N ...] / search TEXT / help N / next / back / cancel");
  };
  const input = createInterface({ input: process.stdin, terminal: false });
  const lines = input[Symbol.asyncIterator]();
  let interrupted = false;
  const interrupt = () => {
    interrupted = true;
    process.exitCode = 130;
    input.close();
  };
  process.once("SIGINT", interrupt);
  try {
    print(
      snapshot.text === null
        ? "New personal layer; no file has been created."
        : "Existing selections loaded.",
    );
    print(
      `CLI package version: ${JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version}`,
    );
    show();
    while (true) {
      process.stdout.write("setup> ");
      const line = await lines.next();
      if (line.done || interrupted) {
        print("Cancelled; no selections saved.");
        return;
      }
      const command = line.value.trim();
      try {
        if (command === "cancel") {
          print("Cancelled; no selections saved.");
          return;
        }
        if (command === "next") {
          if (stage === 1 && draft().error) throw draft().error;
          stage = Math.min(2, stage + 1);
          query = "";
          selectedOnly = false;
        } else if (command === "back") {
          stage = Math.max(0, stage - 1);
          query = "";
          selectedOnly = false;
        } else if (command.startsWith("search ")) query = command.slice(7);
        else if (command === "clear search") query = "";
        else if (command === "show selected") selectedOnly = true;
        else if (command === "show all") {
          query = "";
          selectedOnly = false;
        } else if (command.startsWith("questions ")) {
          const preset = command.slice(10);
          if (!["plain", "coded", "cards"].includes(preset))
            throw new Error("Choose questions plain|coded|cards.");
          questions = preset;
        } else if (command.startsWith("toggle ") || command.startsWith("help ")) {
          const help = command.startsWith("help ");
          const names = command.slice(help ? 5 : 7).split(/\s+/);
          const available = rows();
          const chosen = names.map((name) => {
            const matches = available.filter(
              (row) => String(row.number) === name || row.name === name,
            );
            if (matches.length !== 1)
              throw new Error(`Choose an unambiguous listed number or name: ${name}`);
            return matches[0];
          });
          if (
            !help &&
            new Set(chosen.map((row) => `${row.kind}:${row.name}`)).size !== chosen.length
          )
            throw new Error("List each choice only once in a toggle command.");
          if (
            !help &&
            chosen.some((row) => row.kind === "modifier" && !known.has(row.name) && !row.enabled)
          )
            throw new Error("An unavailable modifier can only be removed.");
          for (const row of chosen) {
            if (help) {
              print(`${row.name}: ${row.description}`);
              print(
                `Source: ${row.origin ?? "shipped modifier"}${row.explicitOnly ? "; explicit invocation only" : ""}`,
              );
              if (row.kind === "skill")
                print(
                  "Exclusion applies to this name in every layer, including a personal override.",
                );
            } else {
              const enabled = !(intent.get(`${row.kind}:${row.name}`)?.enabled ?? row.enabled);
              intent.set(`${row.kind}:${row.name}`, { kind: row.kind, name: row.name, enabled });
            }
          }
        } else if (command === "refresh") {
          if (!stale)
            throw new Error(
              "Refresh is available after a changed configuration; review the current draft first.",
            );
          snapshot = readConfiguration(snapshot.path);
          baseline = catalog();
          stale = false;
          print(
            "Fresh configuration loaded; retained selection intent is shown for review. Nothing saved.",
          );
        } else if (command === "save") {
          if (stage !== 2) throw new Error("Use next to reach Review before saving.");
          if (stale) throw new Error("Use refresh and review the new comparison before saving.");
          const current = draft();
          if (current.error) throw current.error;
          if (!selectionChanges(snapshot.config, current.next).length) {
            print("No selection changes; configuration was not written.");
            return;
          }
          try {
            writeConfiguration(snapshot, current.next, snapshot.revision);
          } catch (error) {
            if (readConfiguration(snapshot.path).revision !== snapshot.revision) stale = true;
            throw error;
          }
          const saved = readConfiguration(snapshot.path);
          if (JSON.stringify(saved.config) !== JSON.stringify(current.next))
            throw new Error("Saved configuration changed; inspect config status.");
          selectionReport(saved.config, saved.path);
          print(`Selections saved: ${saved.path}`);
          print(
            "Output was not regenerated and hosts were not connected by setup. Recompose with:",
          );
          printCommand(
            `house-rules --config ${quote(saved.path)} --out ${quote(join(dirname(saved.path), "rules.md"))}`,
          );
          return;
        } else
          throw new Error(
            "Unknown command. Use toggle, questions, search, help, next, back, save or cancel.",
          );
      } catch (error) {
        print(`Cannot continue: ${error.message}`);
      }
      show();
    }
  } finally {
    process.removeListener("SIGINT", interrupt);
    input.close();
  }
}
