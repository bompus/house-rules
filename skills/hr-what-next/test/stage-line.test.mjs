import { expect, test } from "bun:test";
import { splitStage } from "../scripts/stage-line.mjs";

test("a semicolon, recheck: or done-when: inside a code span after the real trigger: stays in the trigger clause", () => {
  for (const quoted of ["`a; b`", "`recheck: 2099-01-01`", "`done-when: pr-merged x/y#1`"]) {
    const { trigger, rest } = splitStage(
      `Approved, not built: export trigger: upstream release ${quoted} ships`,
    );
    expect(trigger).toContain(quoted);
    expect(trigger).toContain("ships");
    expect(rest).not.toContain("ships");
  }
});

test("the clause still ends at a real semicolon, recheck: or done-when: outside code", () => {
  expect(splitStage("export trigger: PR 4 lands; asked in Offer X-1").trigger).toBe(" PR 4 lands");
  expect(splitStage("export trigger: PR 4 lands recheck: 2099-01-01").trigger).toBe(" PR 4 lands ");
  expect(splitStage("export trigger: PR 4 lands done-when: pr-merged a/b#4").trigger).toBe(
    " PR 4 lands ",
  );
});

test("a trigger: written inside a code span is not the field", () => {
  const text = "export, the `trigger: x` field described trigger: PR 4 lands";
  expect(splitStage(text).trigger).toBe(" PR 4 lands");
  expect(splitStage("export, the `see trigger: x` field").trigger).toBe("");
});

test("code spans of any backtick run length are masked, and an escaped backtick opens none", () => {
  expect(splitStage("export, the ``trigger: x`` field").trigger).toBe("");
  const quoted = splitStage("Approved, not built: export trigger: ``a; b`` ships").trigger;
  expect(quoted).toContain("ships");
  expect(quoted).toContain("``a; b``");
  expect(splitStage("export trigger: ``a; b`` ships; asked in Offer X-1").trigger).toBe(
    " ``a; b`` ships",
  );
  expect(splitStage("export \\`trigger: PR 4 lands").trigger).toBe(" PR 4 lands");
});
