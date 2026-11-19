import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { transcriptFromClaudeCodeStream } from "../../research/phase1-benchmark/harness/claudeCode.js";
import { prepareConditionWorkspace } from "../../research/phase1-benchmark/harness/prepare.js";
import { shellMutationRisk } from "../../research/phase1-benchmark/harness/transcriptCapture.js";
import {
  loadProtocol,
  repositoryById,
  taskById,
} from "../../research/phase1-benchmark/harness/protocol.js";
import {
  executeTrial,
  type RunConfiguration,
} from "../../research/phase1-benchmark/harness/run.js";
import { FakeCommandExecutor, FixtureFetcher } from "./harnessDoubles.js";
import {
  applyRecordedWrites,
  TranscriptReplayRunner,
} from "../../research/phase1-benchmark/harness/transcript.js";

const MODEL_ID = "claude-sonnet-4-5";
const CLIENT_VERSION = "2.1.316 (Claude Code)";
const CONFIG: RunConfiguration = {
  modelId: MODEL_ID,
  agentClientVersion: CLIENT_VERSION,
  temperature: 0,
};
const STARTED_AT = "2026-11-17T00:00:00.000Z";

let baseDirectory: string;

beforeEach(async () => {
  baseDirectory = await mkdtemp(join(tmpdir(), "phase1-claude-adapter-test-"));
});

afterEach(async () => {
  await rm(baseDirectory, { recursive: true, force: true });
});

async function editWorkspace(): Promise<string> {
  const protocol = await loadProtocol();
  const task = taskById(protocol, "axios-02-add-devdep");
  const workspace = await prepareConditionWorkspace({
    repository: repositoryById(protocol, task.repositoryId),
    condition: "raw",
    baseDirectory,
    fetcher: new FixtureFetcher(),
  });
  return workspace.path;
}

function initEvent(cwd: string): Record<string, unknown> {
  return {
    type: "system",
    subtype: "init",
    model: MODEL_ID,
    claude_code_version: CLIENT_VERSION,
    cwd,
  };
}

function writeToolUse(filePath: string, content: string): Record<string, unknown> {
  return {
    type: "assistant",
    message: {
      role: "assistant",
      content: [
        { type: "tool_use", id: "toolu_1", name: "Write", input: { file_path: filePath, content } },
      ],
    },
  };
}

function bashToolUse(command: string): Record<string, unknown> {
  return {
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "tool_use", id: "toolu_bash", name: "Bash", input: { command } }],
    },
  };
}

function resultEvent(result: string): Record<string, unknown> {
  return {
    type: "result",
    subtype: "success",
    is_error: false,
    result,
    usage: {
      input_tokens: 1200,
      output_tokens: 80,
      cache_read_input_tokens: 400,
      cache_creation_input_tokens: 100,
    },
  };
}

describe("Claude Code capture adapter", () => {
  it("converts a stream with a Write into a transcript whose replay satisfies an edit-task oracle", async () => {
    const workspacePath = await editWorkspace();
    const packageJson = JSON.stringify(
      { name: "fixture", dependencies: { semver: "^7.6.0" } },
      null,
      2,
    );

    const capture = await transcriptFromClaudeCodeStream(
      [
        initEvent(workspacePath),
        writeToolUse(join(workspacePath, "package.json"), packageJson),
        resultEvent("Added semver."),
      ],
      {
        taskId: "axios-02-add-devdep",
        condition: "raw",
        workspaceRoot: workspacePath,
        startedAt: STARTED_AT,
        capturedAt: "2026-11-17T00:01:00.000Z",
        timing: (index) => index * 1000,
      },
    );

    expect(capture.timingIsSequenceDerived).toBe(false);
    expect(capture.transcript.provenance.captured).toBe(true);
    expect(capture.transcript.agent).toEqual({
      client: "claude-code",
      version: CLIENT_VERSION,
      modelId: MODEL_ID,
    });
    expect(capture.transcript.usage).toEqual({
      input: 1200,
      output: 80,
      cached: 500,
      reasoning: null,
    });

    const protocol = await loadProtocol();
    const task = taskById(protocol, "axios-02-add-devdep");
    const result = await executeTrial({
      runManifestId: "claude-adapter-fixture",
      task,
      repositoryId: task.repositoryId,
      condition: "raw",
      runIndex: 0,
      config: CONFIG,
      workspace: await prepareConditionWorkspace({
        repository: repositoryById(protocol, task.repositoryId),
        condition: "raw",
        baseDirectory,
        fetcher: new FixtureFetcher(),
      }),
      runner: new TranscriptReplayRunner(capture.transcript),
      commandExecutor: new FakeCommandExecutor(),
      now: () => Date.parse(STARTED_AT),
    });

    expect(result.record.success).toBe(true);
    expect(result.score.forbidden).toEqual([]);
    expect(await readFile(join(result.request.workspacePath, "package.json"), "utf8")).toContain(
      '"semver": "^7.6.0"',
    );
  });

  it("grounds an Edit in the workspace file and materializes the result", async () => {
    const workspacePath = await editWorkspace();
    const capture = await transcriptFromClaudeCodeStream(
      [
        initEvent(workspacePath),
        {
          type: "assistant",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_1",
                name: "Edit",
                input: {
                  file_path: join(workspacePath, "package.json"),
                  old_string: '"name":"fixture"',
                  new_string: '"name":"fixture","dependencies":{"semver":"^7.6.0"}',
                },
              },
            ],
          },
        },
        resultEvent("Edited the manifest."),
      ],
      {
        taskId: "axios-02-add-devdep",
        condition: "raw",
        workspaceRoot: workspacePath,
        startedAt: STARTED_AT,
        capturedAt: "2026-11-17T00:01:00.000Z",
        timing: (index) => index * 1000,
      },
    );

    const [event] = capture.transcript.events;
    if (event?.kind !== "write") throw new Error("Edit was not converted to a write");
    expect(JSON.parse(event.content)).toMatchObject({
      name: "fixture",
      dependencies: { semver: "^7.6.0" },
    });

    await applyRecordedWrites(capture.transcript, workspacePath);
    expect(await readFile(join(workspacePath, "package.json"), "utf8")).toContain("^7.6.0");
  });

  it("marks a capture without measured timings as sequence-derived", async () => {
    const workspacePath = await editWorkspace();
    const capture = await transcriptFromClaudeCodeStream(
      [
        initEvent(workspacePath),
        writeToolUse(join(workspacePath, "package.json"), "{}\n"),
        resultEvent("Done."),
      ],
      {
        taskId: "axios-02-add-devdep",
        condition: "raw",
        workspaceRoot: workspacePath,
        startedAt: STARTED_AT,
        capturedAt: "2026-11-17T00:01:00.000Z",
      },
    );

    expect(capture.timingIsSequenceDerived).toBe(true);
    expect(capture.transcript.notes).toContain("sequence-derived");
  });

  it("classifies shell commands conservatively", () => {
    expect(shellMutationRisk("git status --short")).toBe("none");
    expect(shellMutationRisk("cat package.json | grep name")).toBe("none");
    expect(shellMutationRisk("git checkout -- .")).toBe("certain");
    expect(shellMutationRisk("echo '{}' > package.json")).toBe("certain");
    expect(shellMutationRisk('sed -i "s/a/b/" package.json')).toBe("certain");
    expect(shellMutationRisk("npm install semver")).toBe("certain");
    expect(shellMutationRisk("node ./scripts/patch.js")).toBe("possible");
  });

  it("refuses a capture whose Bash certainly changed files, and flags it when told to", async () => {
    const workspacePath = await editWorkspace();
    const stream = [
      initEvent(workspacePath),
      bashToolUse('sed -i "s/fixture/other/" package.json'),
      resultEvent("Rewrote the manifest."),
    ];

    await expect(
      transcriptFromClaudeCodeStream(stream, {
        taskId: "axios-02-add-devdep",
        condition: "raw",
        workspaceRoot: workspacePath,
        startedAt: STARTED_AT,
        capturedAt: "2026-11-17T00:01:00.000Z",
        timing: (index) => index * 1000,
      }),
    ).rejects.toThrow(/Bash certainly changed files/);

    const flagged = await transcriptFromClaudeCodeStream(stream, {
      taskId: "axios-02-add-devdep",
      condition: "raw",
      workspaceRoot: workspacePath,
      startedAt: STARTED_AT,
      capturedAt: "2026-11-17T00:01:00.000Z",
      timing: (index) => index * 1000,
      onShellMutation: "flag",
    });

    expect(flagged.transcript.shellMutationRisk).toBe(true);
    expect(flagged.transcript.notes).toContain("Bash may have changed files");
    expect(flagged.transcript.events).toHaveLength(1);
    expect(flagged.transcript.events[0]?.kind).toBe("shell");
  });

  it("does not flag a read-only Bash command but flags an interpreter", async () => {
    const workspacePath = await editWorkspace();
    const options = {
      taskId: "axios-02-add-devdep",
      condition: "raw" as const,
      workspaceRoot: workspacePath,
      startedAt: STARTED_AT,
      capturedAt: "2026-11-17T00:01:00.000Z",
      timing: (index: number) => index * 1000,
    };

    const readOnly = await transcriptFromClaudeCodeStream(
      [initEvent(workspacePath), bashToolUse("cat package.json"), resultEvent("Read it.")],
      options,
    );
    expect(readOnly.transcript.shellMutationRisk).toBeUndefined();
    expect(readOnly.transcript.notes).toBeUndefined();

    const interpreter = await transcriptFromClaudeCodeStream(
      [
        initEvent(workspacePath),
        bashToolUse("node ./scripts/patch.js"),
        resultEvent("Ran the script."),
      ],
      options,
    );
    expect(interpreter.transcript.shellMutationRisk).toBe(true);
  });

  it("refuses a path outside the workspace and a capture without usage", async () => {
    const workspacePath = await editWorkspace();

    await expect(
      transcriptFromClaudeCodeStream(
        [
          initEvent(workspacePath),
          writeToolUse(join(baseDirectory, "outside.json"), "{}"),
          resultEvent("Done."),
        ],
        {
          taskId: "axios-02-add-devdep",
          condition: "raw",
          workspaceRoot: workspacePath,
          startedAt: STARTED_AT,
          capturedAt: "2026-11-17T00:01:00.000Z",
        },
      ),
    ).rejects.toThrow(/outside the workspace/);

    await expect(
      transcriptFromClaudeCodeStream([initEvent(workspacePath)], {
        taskId: "axios-02-add-devdep",
        condition: "raw",
        workspaceRoot: workspacePath,
        startedAt: STARTED_AT,
        capturedAt: "2026-11-17T00:01:00.000Z",
      }),
    ).rejects.toThrow(/usage/);
  });
});
