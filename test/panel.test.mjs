import assert from "node:assert/strict";
import { test } from "node:test";
import { changePanelPreferences, validatePanelPreferences } from "../panel.mjs";

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
