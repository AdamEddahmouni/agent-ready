import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { removeTree } from "../../research/phase1-benchmark/harness/removeTree.js";
import { prepareConditionWorkspace } from "../../research/phase1-benchmark/harness/prepare.js";
import {
  loadProtocol,
  repositoryById,
  taskById,
} from "../../research/phase1-benchmark/harness/protocol.js";
import { validateRawRun } from "../../research/phase1-benchmark/harness/record.js";
import {
  buildAgentRunRequest,
  executeTrial,
  type RunConfiguration,
} from "../../research/phase1-benchmark/harness/run.js";
import {
  observationsFromTranscript,
  parseTranscript,
  TranscriptProvenanceError,
  TranscriptReplayRunner,
  TranscriptRunMismatchError,
  TranscriptValidationError,
  type AgentTranscript,
} from "../../research/phase1-benchmark/harness/transcript.js";
import { FakeCommandExecutor, FixtureFetcher } from "./harnessDoubles.js";

const FIXTURE_PATH = join(
  process.cwd(),
  "tests/fixtures/research/transcript-axios-01-identify-test-script.json",
);
const EDIT_FIXTURE_PATH = join(
  process.cwd(),
  "tests/fixtures/research/transcript-axios-02-add-devdep.json",
);

async function loadFixture(): Promise<AgentTranscript> {
  return parseTranscript(JSON.parse(await readFile(FIXTURE_PATH, "utf8")) as unknown);
}

const CONFIG: RunConfiguration = {
  modelId: "claude-sonnet-4-5",
  agentClientVersion: "2.1.316 (Claude Code)",
  temperature: 0,
};

let baseDirectory: string;

beforeEach(async () => {
  baseDirectory = await mkdtemp(join(tmpdir(), "phase1-transcript-test-"));
});

afterEach(async () => {
  await removeTree(baseDirectory);
});

describe("Phase 1 agent transcript", () => {
  it("replays a session-shaped transcript through the scorer into a schema-valid raw record", async () => {
    const transcript = await loadFixture();
    const protocol = await loadProtocol();
    const task = taskById(protocol, transcript.taskId);
    const repository = repositoryById(protocol, task.repositoryId);
    const workspace = await prepareConditionWorkspace({
      repository,
      condition: transcript.condition,
      baseDirectory,
      fetcher: new FixtureFetcher(),
    });

    const observations = observationsFromTranscript(transcript);
    expect(observations.fileReads.map((read) => read.path)).toEqual(["package.json"]);
    expect(observations.toolCalls.map((call) => call.name)).toEqual([
      "read_file",
      "search",
      "shell",
      "thinking",
    ]);
    expect(observations.toolCalls[2]?.command).toContain("require('./package.json')");
    expect(observations.tokenMetrics).toEqual(transcript.usage);

    const runner = new TranscriptReplayRunner(transcript, { allowAuthored: true });
    const result = await executeTrial({
      runManifestId: "transcript-fixture-manifest",
      task,
      repositoryId: repository.id,
      condition: transcript.condition,
      runIndex: 0,
      config: CONFIG,
      workspace,
      runner,
      commandExecutor: new FakeCommandExecutor(),
      now: () => Date.parse("2026-11-17T00:00:00.000Z"),
    });

    expect(result.record.success).toBe(true);
    expect(result.score.forbidden).toEqual([]);
    expect(result.record.timeToFirstCorrectModification).toBeNull();
    expect(result.record.verificationSelectionResult).toBe(true);
    expect(validateRawRun(result.record).ok).toBe(true);
  });

  it("applies recorded writes so an edit-task oracle sees the recorded state", async () => {
    const transcript = parseTranscript(
      JSON.parse(await readFile(EDIT_FIXTURE_PATH, "utf8")) as unknown,
    );
    const protocol = await loadProtocol();
    const task = taskById(protocol, transcript.taskId);
    const repository = repositoryById(protocol, task.repositoryId);
    const workspace = await prepareConditionWorkspace({
      repository,
      condition: transcript.condition,
      baseDirectory,
      fetcher: new FixtureFetcher(),
    });

    const result = await executeTrial({
      runManifestId: "transcript-fixture-manifest",
      task,
      repositoryId: repository.id,
      condition: transcript.condition,
      runIndex: 0,
      config: CONFIG,
      workspace,
      runner: new TranscriptReplayRunner(transcript, { allowAuthored: true }),
      commandExecutor: new FakeCommandExecutor(),
      now: () => Date.parse("2026-11-17T00:00:00.000Z"),
    });

    expect(result.record.success).toBe(true);
    expect(result.score.forbidden).toEqual([]);
    expect(result.record.fileWrites).toHaveLength(1);
    expect(result.record.timeToFirstCorrectModification).toBe(1);
    expect(await readFile(join(workspace.path, "package.json"), "utf8")).toContain(
      '"semver": "^7.6.0"',
    );
  });

  it("aborts a mismatched replay instead of recording an infrastructure failure", async () => {
    const transcript = parseTranscript(
      JSON.parse(await readFile(EDIT_FIXTURE_PATH, "utf8")) as unknown,
    );
    const protocol = await loadProtocol();
    const task = taskById(protocol, "axios-01-identify-test-script");
    const repository = repositoryById(protocol, task.repositoryId);

    await expect(
      executeTrial({
        runManifestId: "transcript-fixture-manifest",
        task,
        repositoryId: repository.id,
        condition: transcript.condition,
        runIndex: 0,
        config: CONFIG,
        workspace: await prepareConditionWorkspace({
          repository,
          condition: transcript.condition,
          baseDirectory,
          fetcher: new FixtureFetcher(),
        }),
        runner: new TranscriptReplayRunner(transcript, { allowAuthored: true }),
        commandExecutor: new FakeCommandExecutor(),
        now: () => Date.parse("2026-11-17T00:00:00.000Z"),
      }),
    ).rejects.toThrow(TranscriptRunMismatchError);
  });

  it("still records an ordinary runner failure as an infrastructure failure", async () => {
    const protocol = await loadProtocol();
    const task = taskById(protocol, "axios-02-add-devdep");
    const repository = repositoryById(protocol, task.repositoryId);

    const result = await executeTrial({
      runManifestId: "transcript-fixture-manifest",
      task,
      repositoryId: repository.id,
      condition: "raw",
      runIndex: 0,
      config: CONFIG,
      workspace: await prepareConditionWorkspace({
        repository,
        condition: "raw",
        baseDirectory,
        fetcher: new FixtureFetcher(),
      }),
      runner: {
        run(): Promise<never> {
          return Promise.reject(new Error("workspace checkout vanished"));
        },
      },
      commandExecutor: new FakeCommandExecutor(),
      now: () => Date.parse("2026-11-17T00:00:00.000Z"),
    });

    expect(result.record.infrastructureFailure).toBe(true);
    expect(result.record.success).toBe(false);
  });

  it("refuses an authored transcript unless a test says otherwise", async () => {
    const transcript = await loadFixture();
    expect(transcript.provenance.captured).toBe(false);
    expect(() => new TranscriptReplayRunner(transcript)).toThrow(TranscriptProvenanceError);
    expect(
      () => new TranscriptReplayRunner({ ...transcript, provenance: { captured: true } }),
    ).not.toThrow();
  });

  it("refuses to replay a transcript as a different task, condition, model, or client", async () => {
    const transcript = await loadFixture();
    const protocol = await loadProtocol();
    const task = taskById(protocol, transcript.taskId);
    const repository = repositoryById(protocol, task.repositoryId);
    const workspace = await prepareConditionWorkspace({
      repository,
      condition: transcript.condition,
      baseDirectory,
      fetcher: new FixtureFetcher(),
    });

    const request = buildAgentRunRequest({
      runManifestId: "transcript-fixture-manifest",
      task,
      repositoryId: repository.id,
      condition: "raw",
      runIndex: 0,
      config: CONFIG,
      workspace,
    });
    const runner = new TranscriptReplayRunner(transcript, { allowAuthored: true });

    await expect(
      runner.run({ ...request, taskId: "jest-01-count-workspace-packages" }),
    ).rejects.toThrow(/taskId/);
    await expect(runner.run({ ...request, condition: "agent-ready" })).rejects.toThrow(/condition/);
    await expect(
      runner.run({ ...request, config: { ...CONFIG, modelId: "other-model" } }),
    ).rejects.toThrow(/modelId/);
    await expect(
      runner.run({ ...request, config: { ...CONFIG, agentClientVersion: "other-client/0" } }),
    ).rejects.toThrow(/agentClientVersion/);
  });

  it("rejects a transcript that drifts from the frozen shape or cites unsafe paths", async () => {
    const base = JSON.parse(await readFile(FIXTURE_PATH, "utf8")) as Record<string, unknown>;
    const withEvents = (events: unknown): Record<string, unknown> => ({ ...base, events });

    expect(() => parseTranscript({ ...base, transcriptVersion: 2 })).toThrow(
      TranscriptValidationError,
    );
    expect(() => parseTranscript(withEvents([{ kind: "telepathy", atMs: 1 }]))).toThrow(
      TranscriptValidationError,
    );
    expect(() =>
      parseTranscript(withEvents([{ kind: "read", path: "../outside.json", atMs: 1 }])),
    ).toThrow(/repository-relative/);
    expect(() =>
      parseTranscript(
        withEvents([
          { kind: "read", path: "package.json", atMs: 10 },
          { kind: "search", query: "scripts", atMs: 5 },
        ]),
      ),
    ).toThrow(/non-decreasing/);
    expect(() => parseTranscript({ ...base, usage: { input: 1, output: 1, cached: 1 } })).toThrow(
      TranscriptValidationError,
    );
  });
});
