import { describe, expect, it } from "vitest";
import {
  expectedVerificationCommands,
  selectedVerificationFor,
  tokenizeCommand,
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

const check = { type: "command-exit-zero", command: "npm run check:sponsor-data" } as const;

describe("expectedVerificationCommands", () => {
  it("takes every command-exit-zero clause, including nested all-of clauses", () => {
    const oracle: Oracle = {
      type: "all-of",
      clauses: [
        { type: "file-contains", path: "package.json", substring: "x" },
        check,
        { type: "all-of", clauses: [{ type: "command-exit-zero", command: "npm test" }] },
      ],
    };

    expect(expectedVerificationCommands(task({ successOracle: oracle }))).toEqual([
      "npm run check:sponsor-data",
      "npm test",
    ]);
  });

  it("ignores a script the verification surface merely names", () => {
    expect(
      expectedVerificationCommands(task({ verificationSurface: ["package.json scripts.test"] })),
    ).toEqual([]);
  });
});

describe("tokenizeCommand", () => {
  it("splits chained commands and keeps quoted text as one word", () => {
    expect(tokenizeCommand(`cd pkg && rg -n "a|npm run check:sponsor-data" package.json`)).toEqual([
      ["cd", "pkg"],
      ["rg", "-n", "a|npm run check:sponsor-data", "package.json"],
    ]);
  });
});

describe("selectedVerificationFor", () => {
  it("counts a run that executed the oracle command, including through a shell wrapper", () => {
    const definition = task({ successOracle: check });

    expect(
      selectedVerificationFor(definition, [shell("/bin/bash -lc 'npm run check:sponsor-data'")]),
    ).toBe(true);
    expect(
      selectedVerificationFor(definition, [shell(`cd /srv/repo && npm run check:sponsor-data`)]),
    ).toBe(true);
  });

  it("counts a prefixed invocation of the same program", () => {
    const definition = task({ successOracle: check });

    expect(
      selectedVerificationFor(definition, [shell("env CI=1 npm run check:sponsor-data")]),
    ).toBe(true);
  });

  it("does not count the command echoed, grepped or written to a log", () => {
    const definition = task({ successOracle: check });

    expect(selectedVerificationFor(definition, [shell(`echo "npm run check:sponsor-data"`)])).toBe(
      false,
    );
    expect(selectedVerificationFor(definition, [shell(`rg "npm run check:sponsor-data"`)])).toBe(
      false,
    );
    expect(
      selectedVerificationFor(definition, [shell(`bash -lc 'rg -n "npm run check:sponsor-data"'`)]),
    ).toBe(false);
  });

  it("does not count a near-miss command", () => {
    const definition = task({ successOracle: check });

    expect(selectedVerificationFor(definition, [shell("npm run check:sponsor")])).toBe(false);
    expect(selectedVerificationFor(definition, [shell("npm test")])).toBe(false);
  });

  it("does not score a read-only task as verified because the agent ran its test script", () => {
    const definition = task({ verificationSurface: ["package.json scripts.test"] });

    expect(selectedVerificationFor(definition, [shell("npm test")])).toBeUndefined();
  });
});
