import { describe, expect, it } from "vitest";
import {
  expectedVerificationCommands,
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

describe("expectedVerificationCommands", () => {
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

    expect(expectedVerificationCommands(task({ successOracle: oracle }))).toEqual([
      "npm run check:sponsor-data",
      "npm test",
    ]);
  });

  it("ignores a script the verification surface merely names", () => {
    const definition = task({ verificationSurface: ["package.json scripts.test"] });
    expect(expectedVerificationCommands(definition)).toEqual([]);
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

  it("does not count a near-miss command", () => {
    const definition = task({
      successOracle: { type: "command-exit-zero", command: "npm run check:sponsor-data" },
    });

    expect(selectedVerificationFor(definition, [shell("npm run check:sponsor")])).toBe(false);
    expect(selectedVerificationFor(definition, [shell("npm test")])).toBe(false);
  });

  it("does not score a read-only task as verified because the agent ran its test script", () => {
    const definition = task({ verificationSurface: ["package.json scripts.test"] });

    expect(selectedVerificationFor(definition, [shell("npm test")])).toBeUndefined();
    expect(selectedVerificationFor(definition, [shell("rg test package.json")])).toBeUndefined();
  });
});
