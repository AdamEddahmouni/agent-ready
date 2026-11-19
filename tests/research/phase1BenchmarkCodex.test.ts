import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { transcriptFromCodexStream } from "../../research/phase1-benchmark/harness/codex.js";
import { prepareConditionWorkspace } from "../../research/phase1-benchmark/harness/prepare.js";
import {
  loadProtocol,
  repositoryById,
  taskById,
} from "../../research/phase1-benchmark/harness/protocol.js";
import {
  executeTrial,
  type RunConfiguration,
} from "../../research/phase1-benchmark/harness/run.js";
import { TranscriptReplayRunner } from "../../research/phase1-benchmark/harness/transcript.js";
import { FakeCommandExecutor, FixtureFetcher } from "./harnessDoubles.js";

const MODEL_ID = "gpt-5-codex";
const CLIENT_VERSION = "0.166.0";
const CONFIG: RunConfiguration = {
  modelId: MODEL_ID,
  agentClientVersion: CLIENT_VERSION,
  temperature: 0,
};
const STARTED_AT = "2026-11-17T00:00:00.000Z";

let baseDirectory: string;

beforeEach(async () => {
  baseDirectory = await mkdtemp(join(tmpdir(), "phase1-codex-adapter-test-"));
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

function commandItem(command: string, exitCode = 0): Record<string, unknown> {
  return {
    type: "item.completed",
    item: {
      id: "item_1",
      type: "command_execution",
      command,
      aggregated_output: "",
      exit_code: exitCode,
      status: "completed",
    },
  };
}

function fileChangeItem(filePath: string, kind = "update"): Record<string, unknown> {
  return {
    type: "item.completed",
    item: {
      id: "item_2",
      type: "file_change",
      changes: [{ path: filePath, kind }],
      status: "completed",
    },
  };
}

function turnCompleted(): Record<string, unknown> {
  return {
    type: "turn.completed",
    usage: {
      input_tokens: 9000,
      cached_input_tokens: 3000,
      output_tokens: 120,
      reasoning_output_tokens: 40,
    },
  };
}

const STREAM_HEAD = [
  { type: "thread.started", thread_id: "0199a213-81c0-7800-8aa1-bbab2a035a53" },
  { type: "turn.started" },
];

function options(workspacePath: string): Parameters<typeof transcriptFromCodexStream>[1] {
  return {
    taskId: "axios-02-add-devdep",
    condition: "raw",
    workspaceRoot: workspacePath,
    startedAt: STARTED_AT,
    capturedAt: "2026-11-17T00:01:00.000Z",
    modelId: MODEL_ID,
    clientVersion: CLIENT_VERSION,
    timing: (index) => index * 1000,
  };
}

describe("Codex capture adapter", () => {
  it("records a reported file change from the workspace and replays it through an edit-task oracle", async () => {
    const workspacePath = await editWorkspace();
    const packageJson = JSON.stringify(
      { name: "fixture", dependencies: { semver: "^7.6.0" } },
      null,
      2,
    );
    await writeFile(join(workspacePath, "package.json"), packageJson, "utf8");

    const capture = await transcriptFromCodexStream(
      [
        ...STREAM_HEAD,
        commandItem("cat package.json"),
        fileChangeItem(join(workspacePath, "package.json")),
        fileChangeItem(join(workspacePath, "package.json")),
        {
          type: "item.completed",
          item: { id: "item_3", type: "agent_message", text: "Added semver." },
        },
        turnCompleted(),
      ],
      options(workspacePath),
    );

    expect(capture.timingIsSequenceDerived).toBe(false);
    expect(capture.transcript.provenance.captured).toBe(true);
    expect(capture.transcript.events.map((event) => event.kind)).toEqual(["shell", "write"]);
    expect(capture.transcript.agent).toEqual({
      client: "codex-cli",
      version: CLIENT_VERSION,
      modelId: MODEL_ID,
    });
    expect(capture.transcript.usage).toEqual({
      input: 9000,
      output: 120,
      cached: 3000,
      reasoning: 40,
    });
    expect(capture.transcript.shellMutationRisk).toBeUndefined();

    const protocol = await loadProtocol();
    const task = taskById(protocol, "axios-02-add-devdep");
    const result = await executeTrial({
      runManifestId: "codex-adapter-fixture",
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

  it("refuses a deletion and a file change it cannot read", async () => {
    const workspacePath = await editWorkspace();

    await expect(
      transcriptFromCodexStream(
        [
          ...STREAM_HEAD,
          fileChangeItem(join(workspacePath, "package.json"), "delete"),
          turnCompleted(),
        ],
        options(workspacePath),
      ),
    ).rejects.toThrow(/refusing to capture a deletion/);

    await expect(
      transcriptFromCodexStream(
        [...STREAM_HEAD, fileChangeItem(join(workspacePath, "missing.ts")), turnCompleted()],
        options(workspacePath),
      ),
    ).rejects.toThrow(/unreadable/);
  });

  it("refuses a Bash command that certainly wrote files, and flags it when told to", async () => {
    const workspacePath = await editWorkspace();
    const stream = [
      ...STREAM_HEAD,
      commandItem('sed -i "s/fixture/other/" package.json'),
      turnCompleted(),
    ];

    await expect(transcriptFromCodexStream(stream, options(workspacePath))).rejects.toThrow(
      /Bash certainly changed files/,
    );

    const flagged = await transcriptFromCodexStream(stream, {
      ...options(workspacePath),
      onShellMutation: "flag",
    });
    expect(flagged.transcript.shellMutationRisk).toBe(true);
    expect(flagged.transcript.notes).toContain("could not be checked");
  });

  it("records an item type it does not model as other instead of dropping it", async () => {
    const workspacePath = await editWorkspace();
    const capture = await transcriptFromCodexStream(
      [
        ...STREAM_HEAD,
        commandItem("cat package.json"),
        {
          type: "item.completed",
          item: { id: "item_7", type: "code_review", status: "completed" },
        },
        { type: "item.completed", item: { id: "item_8", status: "completed" } },
        turnCompleted(),
      ],
      options(workspacePath),
    );

    expect(capture.transcript.events.map((event) => event.kind)).toEqual([
      "shell",
      "other",
      "other",
    ]);
    expect(
      capture.transcript.events.flatMap((event) => (event.kind === "other" ? [event.name] : [])),
    ).toEqual(["code_review", "unrecognized-item"]);
  });

  it("refuses a capture without turn usage and marks a capture without timing", async () => {
    const workspacePath = await editWorkspace();

    await expect(
      transcriptFromCodexStream(
        [...STREAM_HEAD, commandItem("cat package.json")],
        options(workspacePath),
      ),
    ).rejects.toThrow(/turn.completed usage/);

    const untimed = await transcriptFromCodexStream(
      [...STREAM_HEAD, commandItem("cat package.json"), turnCompleted()],
      {
        ...options(workspacePath),
        timing: undefined,
        clientVersion: undefined,
      },
    );
    expect(untimed.timingIsSequenceDerived).toBe(true);
    expect(untimed.transcript.notes).toContain("sequence-derived");
    expect(untimed.transcript.agent.version).toBe("unknown");
  });
});
