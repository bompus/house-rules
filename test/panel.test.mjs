import assert from "node:assert/strict";
import { test } from "node:test";
import {
  changePanelPreferences,
  validatePanelPreferences,
} from "../skills/hr-code-review/scripts/panel-preferences.mjs";

import { panelPreferences as preferences } from "./fixture.mjs";

test("portable preferences replace ordered roles without mutating config or input", () => {
  const config = { custom: { retain: true }, panel: { unrelated: true } };
  const input = structuredClone(preferences);
  const next = changePanelPreferences(config, input);
  assert.deepEqual(next, { custom: { retain: true }, panel: preferences });
  next.panel.roles[0].candidates.reverse();
  next.custom.retain = false;
  assert.deepEqual(input, preferences);
  assert.deepEqual(config, { custom: { retain: true }, panel: { unrelated: true } });
});

test("invalid panel versions, fields, aliases and policies refuse", () => {
  const invalid = [
    null,
    [],
    { ...preferences, version: 2 },
    { ...preferences, profile: "fastest" },
    { ...preferences, model: "host-model" },
    { ...preferences, roles: [] },
    { ...preferences, roles: [{ id: "Correctness", candidates: ["review"] }] },
    { ...preferences, roles: [{ id: "review", candidates: ["provider/model"] }] },
    { ...preferences, roles: [{ id: "review", candidates: ["primary", "primary"] }] },
    { ...preferences, roles: [{ id: "review", candidates: [] }] },
    { ...preferences, roles: [{ ...preferences.roles[0], provider: "local" }] },
    { ...preferences, roles: [preferences.roles[0], preferences.roles[0]] },
    { ...preferences, policy: { ...preferences.policy, roundLimit: 0 } },
    { ...preferences, policy: { ...preferences.policy, roundLimit: 1.5 } },
    { ...preferences, policy: { ...preferences.policy, distinctFamilies: "true" } },
    { ...preferences, policy: { ...preferences.policy, fallback: "closest-model" } },
    { ...preferences, policy: { ...preferences.policy, meteredRoutes: "automatic" } },
    { ...preferences, policy: { ...preferences.policy, secret: "unsupported" } },
    { ...preferences, policy: {} },
  ];
  for (const input of invalid) assert.throws(() => validatePanelPreferences(input));
  assert.doesNotThrow(() => validatePanelPreferences(preferences));
});

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  formatPanelPlan,
  resolvePanel,
} from "../skills/hr-code-review/scripts/panel-preferences.mjs";
import { scratch } from "./fixture.mjs";

const bindings = {
  version: 1,
  aliases: {
    "review-primary": { families: ["anthropic"], launch: { runner: "claude" } },
    "review-alternative": { families: ["openai"], launch: { runner: "codex" } },
    "challenge-primary": { families: ["devin"], launch: { runner: "devin" } },
  },
};
const resolve = (extra = {}) =>
  resolvePanel({ user: preferences, bindings, authorFamilies: ["anthropic"], ...extra });

test("author family is excluded and the next candidate fills the seat", () => {
  const plan = resolve();
  assert.equal(plan.ok, true);
  assert.deepEqual(
    plan.seats.map((seat) => [seat.role, seat.alias]),
    [
      ["correctness", "review-alternative"],
      ["contrarian", "challenge-primary"],
    ],
  );
  assert.deepEqual(plan.rejected, [
    {
      role: "correctness",
      alias: "review-primary",
      reason: "shares a model family with the author",
    },
  ]);
  assert.match(formatPanelPlan(plan), /no model has been called/);
});

test("strict exclusion needs author and family evidence", () => {
  assert.equal(resolve({ authorFamilies: [] }).ok, false);
  const unknown = {
    ...bindings,
    aliases: { ...bindings.aliases, "review-alternative": { launch: { runner: "codex" } } },
  };
  const plan = resolve({ bindings: unknown });
  assert.equal(plan.ok, false);
  assert.match(plan.blockers[0].message, /no eligible route for role "correctness"/);
});

test("a missing binding blocks, or drops the role only when reduced panels are allowed", () => {
  const partial = {
    version: 1,
    aliases: { "challenge-primary": bindings.aliases["challenge-primary"] },
  };
  assert.equal(resolve({ bindings: partial }).ok, false);
  const reduced = resolve({
    bindings: partial,
    user: { ...preferences, policy: { ...preferences.policy, allowReducedPanel: true } },
  });
  assert.equal(reduced.ok, true);
  assert.deepEqual(reduced.reduced, ["correctness"]);
});

test("distinct families are found by trying later candidates", () => {
  const shared = {
    version: 1,
    aliases: {
      "review-primary": { families: ["openai"], launch: { runner: "a" } },
      "review-alternative": { families: ["devin"], launch: { runner: "b" } },
      "challenge-primary": { families: ["openai"], launch: { runner: "c" } },
    },
  };
  const user = {
    ...preferences,
    policy: { ...preferences.policy, excludeAuthorFamily: false },
  };
  const plan = resolve({ bindings: shared, user, authorFamilies: [] });
  assert.deepEqual(
    plan.seats.map((seat) => seat.alias),
    ["review-alternative", "challenge-primary"],
  );
  const clash = resolve({
    bindings: {
      ...shared,
      aliases: { ...shared.aliases, "review-alternative": shared.aliases["review-primary"] },
    },
    user,
    authorFamilies: [],
  });
  assert.equal(clash.ok, false);
});

test("metered routes need explicit approval and fallback none keeps one candidate", () => {
  const metered = {
    ...bindings,
    aliases: {
      ...bindings.aliases,
      "review-alternative": { ...bindings.aliases["review-alternative"], metered: true },
    },
  };
  assert.equal(resolve({ bindings: metered }).ok, false);
  assert.equal(
    resolve({ bindings: metered, approvals: { metered: ["review-alternative"] } }).ok,
    true,
  );
  const none = { ...preferences, policy: { ...preferences.policy, fallback: "none" } };
  assert.equal(resolve({ user: none }).ok, false);
});

test("project and task layers replace roles but cannot loosen the user's limits", () => {
  const loose = {
    ...preferences,
    roles: [{ id: "correctness", candidates: ["review-alternative"] }],
    policy: {
      fallback: "approved-only",
      roundLimit: 5,
      meteredRoutes: "included-only",
      distinctFamilies: false,
      excludeAuthorFamily: false,
      allowReducedPanel: true,
    },
  };
  const unapproved = resolve({ project: loose });
  assert.equal(unapproved.ok, false);
  assert.match(unapproved.blockers[0].message, /not approved/);
  const plan = resolve({ project: loose, approvals: { project: true } });
  assert.equal(plan.roundLimit, 1);
  assert.deepEqual(plan.policy, { ...preferences.policy, allowReducedPanel: false });
  assert.deepEqual(
    plan.seats.map((seat) => seat.alias),
    ["review-alternative", "challenge-primary"],
  );
  const reducedUser = {
    ...preferences,
    policy: { ...preferences.policy, allowReducedPanel: true },
  };
  const tight = { ...loose, policy: { ...loose.policy, allowReducedPanel: false } };
  const task = resolve({ user: reducedUser, task: tight });
  assert.equal(task.policy.allowReducedPanel, false);
  assert.equal(resolve({ user: reducedUser }).policy.allowReducedPanel, true);
});

test("the command prints the plan, honours the project approval revision and exits by result", (t) => {
  const dir = scratch(t, "panel-plan-");
  const write = (name, value) => {
    const path = join(dir, name);
    writeFileSync(path, JSON.stringify(value));
    return path;
  };
  const config = write("config.json", { panel: preferences });
  const bound = write("bindings.json", bindings);
  const run = (...args) =>
    spawnSync(
      process.execPath,
      [
        join(import.meta.dirname, "../skills/hr-code-review/scripts/panel-plan.mjs"),
        "--config",
        config,
        "--bindings",
        bound,
        "--json",
        ...args,
      ],
      { encoding: "utf8" },
    );
  const blocked = run();
  assert.equal(blocked.status, 1);
  assert.equal(JSON.parse(blocked.stdout).ok, false);
  const ok = run("--author-family", "anthropic");
  assert.equal(ok.status, 0);
  assert.equal(JSON.parse(ok.stdout).seats.length, 2);
  const project = write("project.json", {
    ...preferences,
    roles: [{ id: "correctness", candidates: ["review-primary"] }],
  });
  const stale = run(
    "--author-family",
    "openai",
    "--project",
    project,
    "--approve-project",
    "0".repeat(64),
  );
  assert.equal(stale.status, 1);
  assert.match(JSON.parse(stale.stdout).blockers[0].message, /not approved/);
  assert.equal(run("--config", join(dir, "missing.json")).status, 2);
});
