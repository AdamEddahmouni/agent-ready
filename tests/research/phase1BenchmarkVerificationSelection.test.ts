import { describe, expect, it } from "vitest";
import {
  expectedVerification,
  selectedVerificationFor,
} from "../../research/phase1-benchmark/harness/verificationSelection.js";
import type {
  Oracle,
  TaskDefinition,
  ToolCallRecord,
} from "../../research/phase1-benchmark/harness/types.js";

function task(overrides: Partial<TaskDefinition> = {}): TaskDefinition {
  return {
    id: "task",
    repositoryId: "axios",
    prompt: "the task prompt",
    successOracle: { type: "file-contains", path: "package.json", substring: "x" },
    forbidden: [],
    verificationSurface: [],
    timeoutMinutes: 20,
    ...overrides,
  };
}

function shell(command: string): ToolCallRecord {
  return { name: "shell", command };
}

describe("expectedVerification", () => {
  it("takes every command-exit-zero clause, including nested all-of clauses", () => {
    const oracle: Oracle = {
      type: "all-of",
      clauses: [
        { type: "file-contains", path: "package.json", substring: "x" },
        { type: "command-exit-zero", command: "npm run check:sponsor-data" },
        {
          type: "all-of",
          clauses: [{ type: "command-exit-zero", command: "npm test" }],
        },
      ],
    };

    expect(expectedVerification(task({ successOracle: oracle })).commands).toEqual([
      "npm run check:sponsor-data",
      "npm test",
    ]);
  });

  it("reads script names out of the verification surface", () => {
    const definition = task({
      verificationSurface: ["package.json scripts.test", "docs/data.json"],
    });
    expect(expectedVerification(definition).scripts).toEqual(["test"]);
  });
});

describe("selectedVerificationFor", () => {
  it("counts a run that ran the oracle command, including inside a shell wrapper", () => {
    const definition = task({
      successOracle: { type: "command-exit-zero", command: "npm run check:sponsor-data" },
    });

    expect(
      selectedVerificationFor(definition, [shell("/bin/bash -lc 'npm run check:sponsor-data'")]),
    ).toBe(true);
  });

  it("counts a trigger through either package-manager spelling", () => {
    const definition = task({ verificationSurface: ["package.json scripts.test"] });

    expect(selectedVerificationFor(definition, [shell("npm test")])).toBe(true);
    expect(selectedVerificationFor(definition, [shell("cd packages/a && npm run test")])).toBe(
      true,
    );
  });

  it("does not count an unrelated command", () => {
    const definition = task({ verificationSurface: ["package.json scripts.test"] });

    expect(selectedVerificationFor(definition, [shell("npm run build")])).toBe(false);
    expect(
      selectedVerificationFor(definition, [{ name: "write_file", path: "package.json" }]),
    ).toBe(false);
  });

  it("returns undefined when the task declares no check", () => {
    expect(selectedVerificationFor(task(), [shell("npm test")])).toBeUndefined();
  });
});
