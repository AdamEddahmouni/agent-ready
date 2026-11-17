import { describe, expect, it } from "vitest";
import {
  detectForbiddenActions,
  evaluateOracle,
  isInstallCommand,
  partialOracleFor,
  scoreRun,
  type CommandExecution,
  type CommandExecutor,
  type OracleContext,
  type WorkspaceReader,
} from "../../research/phase1-benchmark/harness/score.js";
import type {
  FileWriteRecord,
  Oracle,
  TaskDefinition,
} from "../../research/phase1-benchmark/harness/types.js";

class MapWorkspace implements WorkspaceReader {
  constructor(private readonly files: Readonly<Record<string, string>>) {}

  async readTextFile(relativePath: string): Promise<string> {
    const content = this.files[relativePath];
    if (content === undefined) throw new Error(`missing fixture file ${relativePath}`);
    return await Promise.resolve(content);
  }
}

class FakeCommandExecutor implements CommandExecutor {
  readonly calls: { command: string; cwd: string; timeoutMs: number }[] = [];

  constructor(
    private readonly execution: CommandExecution = {
      exitCode: 0,
      timedOut: false,
      stdout: "",
      stderr: "",
    },
  ) {}

  async run(command: string, cwd: string, timeoutMs: number): Promise<CommandExecution> {
    this.calls.push({ command, cwd, timeoutMs });
    return await Promise.resolve(this.execution);
  }
}

function context(overrides: Partial<OracleContext> = {}): OracleContext {
  return {
    workspace: new MapWorkspace({}),
    workspaceRoot: "/repo",
    finalResponse: "",
    commandExecutor: new FakeCommandExecutor(),
    ...overrides,
  };
}

function task(oracle: Oracle, forbidden: readonly string[] = []): TaskDefinition {
  return {
    id: "fixture-task",
    repositoryId: "axios",
    prompt: "fixture prompt",
    successOracle: oracle,
    forbidden,
    verificationSurface: [],
    timeoutMinutes: 15,
  };
}

function write(path: string, content: string, atMs = 0): FileWriteRecord {
  return { path, content, atMs };
}

describe("oracle scoring", () => {
  it("response-json-path-equals parses the final message and resolves a dotted path", async () => {
    const oracle = {
      type: "response-json-path-equals",
      path: "nested.script",
      value: "test",
    } as const;
    expect(
      (await evaluateOracle(oracle, context({ finalResponse: '{"nested":{"script":"test"}}' })))
        .passed,
    ).toBe(true);
    expect(
      (await evaluateOracle(oracle, context({ finalResponse: '{"nested":{"script":"build"}}' })))
        .passed,
    ).toBe(false);
    expect((await evaluateOracle(oracle, context({ finalResponse: "not json" }))).passed).toBe(
      false,
    );
    expect((await evaluateOracle(oracle, context({ finalResponse: '{"nested":{}}' }))).passed).toBe(
      false,
    );
  });

  it("file-contains checks an exact substring", async () => {
    const oracle = {
      type: "file-contains",
      path: "package.json",
      substring: '"check:sponsor-data":',
    } as const;
    expect(
      (
        await evaluateOracle(
          oracle,
          context({
            workspace: new MapWorkspace({
              "package.json": '{"scripts":{"check:sponsor-data":"node check.js"}}',
            }),
          }),
        )
      ).passed,
    ).toBe(true);
    expect(
      (
        await evaluateOracle(
          oracle,
          context({ workspace: new MapWorkspace({ "package.json": "{}" }) }),
        )
      ).passed,
    ).toBe(false);
    expect((await evaluateOracle(oracle, context())).passed).toBe(false);
  });

  it("file-json-equals resolves RFC 6901 pointers including escapes and arrays", async () => {
    const workspace = new MapWorkspace({
      "data.json": JSON.stringify({
        dependencies: { "@scope/pkg": "^1.0.0" },
        items: [{ value: 7 }],
        "a/b": 1,
        "a~b": 2,
      }),
    });
    const oracle: Oracle = {
      type: "file-json-equals",
      file: "data.json",
      pointer: "/dependencies/@scope~1pkg",
      value: "^1.0.0",
    };
    expect((await evaluateOracle(oracle, context({ workspace }))).passed).toBe(true);
    expect(
      (
        await evaluateOracle(
          { type: "file-json-equals", file: "data.json", pointer: "/items/0/value", value: 7 },
          context({ workspace }),
        )
      ).passed,
    ).toBe(true);
    expect(
      (
        await evaluateOracle(
          { type: "file-json-equals", file: "data.json", pointer: "/a~1b", value: 1 },
          context({ workspace }),
        )
      ).passed,
    ).toBe(true);
    expect(
      (
        await evaluateOracle(
          { type: "file-json-equals", file: "data.json", pointer: "/a~0b", value: 2 },
          context({ workspace }),
        )
      ).passed,
    ).toBe(true);
    expect(
      (
        await evaluateOracle(
          { type: "file-json-equals", file: "data.json", pointer: "/items/1", value: 7 },
          context({ workspace }),
        )
      ).passed,
    ).toBe(false);
    expect(
      (
        await evaluateOracle(
          { type: "file-json-equals", file: "data.json", pointer: "bad", value: 7 },
          context({ workspace }),
        )
      ).passed,
    ).toBe(false);
  });

  it("command-exit-zero runs in the resolved workspace cwd and reports failure or timeout", async () => {
    const commands = new FakeCommandExecutor();
    const oracle = {
      type: "command-exit-zero",
      command: "npm run check",
      cwd: "packages/app",
    } as const;
    expect(
      (await evaluateOracle(oracle, context({ commandExecutor: commands, commandTimeoutMs: 123 })))
        .passed,
    ).toBe(true);
    expect(commands.calls).toEqual([
      { command: "npm run check", cwd: "/repo/packages/app", timeoutMs: 123 },
    ]);

    expect(
      (
        await evaluateOracle(
          oracle,
          context({
            commandExecutor: new FakeCommandExecutor({
              exitCode: 1,
              timedOut: false,
              stdout: "",
              stderr: "failed",
            }),
          }),
        )
      ).passed,
    ).toBe(false);
    expect(
      (
        await evaluateOracle(
          oracle,
          context({
            commandExecutor: new FakeCommandExecutor({
              exitCode: null,
              timedOut: true,
              stdout: "",
              stderr: "",
            }),
          }),
        )
      ).passed,
    ).toBe(false);

    const rootCommand = new FakeCommandExecutor();
    await evaluateOracle(
      { type: "command-exit-zero", command: "npm test" },
      context({ commandExecutor: rootCommand }),
    );
    expect(rootCommand.calls[0]?.cwd).toBe("/repo");
  });

  it("manual-rubric fails closed without the matching adjudication", async () => {
    const oracle = {
      type: "manual-rubric",
      rubricId: "rubric-1",
      rubric: "Correct when the answer is exact.",
    } as const;
    expect((await evaluateOracle(oracle, context())).passed).toBe(false);
    expect(
      (await evaluateOracle(oracle, context({ adjudication: { rubricId: "other", passed: true } })))
        .passed,
    ).toBe(false);
    expect(
      (
        await evaluateOracle(
          oracle,
          context({ adjudication: { rubricId: "rubric-1", passed: true } }),
        )
      ).passed,
    ).toBe(true);
    expect(
      (
        await evaluateOracle(
          oracle,
          context({ adjudication: { rubricId: "rubric-1", passed: false } }),
        )
      ).passed,
    ).toBe(false);
  });

  it("all-of requires every clause and retains clause results", async () => {
    const oracle: Oracle = {
      type: "all-of",
      clauses: [
        { type: "file-contains", path: "package.json", substring: '"check":true' },
        { type: "response-json-path-equals", path: "ok", value: true },
      ],
    };
    const passing = await evaluateOracle(
      oracle,
      context({
        workspace: new MapWorkspace({ "package.json": '{"check":true}' }),
        finalResponse: '{"ok":true}',
      }),
    );
    expect(passing.passed).toBe(true);
    expect(passing.clauses).toHaveLength(2);

    const failing = await evaluateOracle(
      oracle,
      context({
        workspace: new MapWorkspace({ "package.json": '{"check":false}' }),
        finalResponse: '{"ok":true}',
      }),
    );
    expect(failing.passed).toBe(false);
    expect(failing.reasons.some((reason) => reason.startsWith("clause 1:"))).toBe(true);
  });
});

describe("partial-oracle timing", () => {
  it("excludes command and response clauses from the observable partial oracle", () => {
    expect(partialOracleFor({ type: "command-exit-zero", command: "npm test" })).toBeNull();
    expect(
      partialOracleFor({ type: "response-json-path-equals", path: "ok", value: true }),
    ).toBeNull();
    expect(
      partialOracleFor({
        type: "all-of",
        clauses: [
          { type: "file-contains", path: "package.json", substring: "check" },
          { type: "command-exit-zero", command: "npm test" },
        ],
      }),
    ).toEqual({
      type: "all-of",
      clauses: [{ type: "file-contains", path: "package.json", substring: "check" }],
    });
  });

  it("records seconds to the first write that satisfies the partial oracle", async () => {
    const oracle: Oracle = {
      type: "all-of",
      clauses: [
        {
          type: "file-json-equals",
          file: "package.json",
          pointer: "/dependencies/semver",
          value: "^7.6.0",
        },
        { type: "command-exit-zero", command: "npm test" },
      ],
    };
    const result = await scoreRun({
      task: task(oracle),
      workspace: new MapWorkspace({
        "package.json": '{"dependencies":{"semver":"^7.6.0"}}',
      }),
      workspaceRoot: "/repo",
      finalResponse: "",
      toolCalls: [],
      fileWrites: [
        write("package.json", '{"dependencies":{}}', 1000),
        write("package.json", '{"dependencies":{"semver":"^7.6.0"}}', 2500),
      ],
      commandExecutor: new FakeCommandExecutor(),
      baselineFiles: { "package.json": "{}" },
    });
    expect(result.success).toBe(true);
    expect(result.timeToFirstCorrectModification).toBe(2.5);
  });
});

describe("forbidden-action detection", () => {
  const oracle: Oracle = {
    type: "file-json-equals",
    file: "package.json",
    pointer: "/dependencies/semver",
    value: "^7.6.0",
  };
  const baseline = { "package.json": '{"dependencies":{"left":"^1.0.0"}}' };

  it("flags any file write for modifying-any-file and modifying-files", () => {
    const writes = [write("src/index.ts", "x")];
    for (const action of ["modifying any file", "modifying files"] as const) {
      expect(
        detectForbiddenActions({ task: task(oracle, [action]), toolCalls: [], fileWrites: writes }),
      ).toHaveLength(1);
    }
    expect(
      detectForbiddenActions({
        task: task(oracle, ["modifying any file"]),
        toolCalls: [],
        fileWrites: [],
      }),
    ).toHaveLength(0);
  });

  it("flags package-manager install commands but not script invocations", () => {
    for (const command of [
      "npm install semver",
      "npm --prefix packages/app install",
      "npm ci",
      "npm i",
      "pnpm add lodash",
      "yarn add lodash",
      "yarn",
    ]) {
      expect(isInstallCommand(command), command).toBe(true);
    }
    for (const command of ["npm test", "npm run install", "pnpm run test", "yarn test"]) {
      expect(isInstallCommand(command), command).toBe(false);
    }

    const violations = detectForbiddenActions({
      task: task(oracle, ["running install"]),
      toolCalls: [{ name: "shell", command: "npm install semver" }],
      fileWrites: [],
    });
    expect(violations[0]?.class).toBe("run-install");
  });

  it("allows the task's declared dependency pointer and rejects unrelated dependency changes", () => {
    const allowed = detectForbiddenActions({
      task: task(oracle, ["changing unrelated dependencies"]),
      toolCalls: [],
      fileWrites: [write("package.json", '{"dependencies":{"left":"^1.0.0","semver":"^7.6.0"}}')],
      baselineFiles: baseline,
    });
    expect(allowed).toHaveLength(0);

    const unrelated = detectForbiddenActions({
      task: task(oracle, ["changing unrelated dependencies"]),
      toolCalls: [],
      fileWrites: [write("package.json", '{"dependencies":{"left":"^2.0.0","semver":"^7.6.0"}}')],
      baselineFiles: baseline,
    });
    expect(unrelated[0]?.class).toBe("change-unrelated-dependencies");

    const missingBaseline = detectForbiddenActions({
      task: task(oracle, ["changing unrelated dependencies"]),
      toolCalls: [],
      fileWrites: [write("package.json", '{"dependencies":{"semver":"^7.6.0"}}')],
    });
    expect(missingBaseline[0]?.class).toBe("change-unrelated-dependencies");
  });

  it("flags lockfile writes", () => {
    const violations = detectForbiddenActions({
      task: task(oracle, ["modifying lockfile"]),
      toolCalls: [],
      fileWrites: [write("package-lock.json", "{}")],
    });
    expect(violations[0]?.class).toBe("modify-lockfile");
    expect(
      detectForbiddenActions({
        task: task(oracle, ["modifying lockfile"]),
        toolCalls: [],
        fileWrites: [write("package.json", "{}")],
      }),
    ).toHaveLength(0);
  });

  it("flags writes outside package.json", () => {
    const violations = detectForbiddenActions({
      task: task(oracle, ["modifying files other than package.json"]),
      toolCalls: [],
      fileWrites: [write("src/index.ts", "x")],
    });
    expect(violations[0]?.class).toBe("modify-other-than-package-json");
    expect(
      detectForbiddenActions({
        task: task(oracle, ["modifying files other than package.json"]),
        toolCalls: [],
        fileWrites: [write("./package.json", "{}")],
      }),
    ).toHaveLength(0);
  });

  it("fails closed on an unclassified forbidden action", () => {
    const violations = detectForbiddenActions({
      task: task(oracle, ["doing something the harness does not know"]),
      toolCalls: [],
      fileWrites: [],
    });
    expect(violations[0]?.class).toBe("unclassified");
  });
});
