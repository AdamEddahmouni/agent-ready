import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  captureTranscript,
  runCaptureCli,
  writeTranscript,
} from "../../research/phase1-benchmark/capture.js";
import { prepareConditionWorkspace } from "../../research/phase1-benchmark/harness/prepare.js";
import {
  loadProtocol,
  repositoryById,
  taskById,
} from "../../research/phase1-benchmark/harness/protocol.js";
import { parseTranscript } from "../../research/phase1-benchmark/harness/transcript.js";
import { FixtureFetcher } from "./harnessDoubles.js";

const TASK_ID = "axios-02-add-devdep";
const STARTED_AT = "2026-11-17T00:00:00.000Z";

let baseDirectory: string;

beforeEach(async () => {
  baseDirectory = await mkdtemp(join(tmpdir(), "phase1-capture-entry-test-"));
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(baseDirectory, { recursive: true, force: true });
});

async function workspace(): Promise<string> {
  const protocol = await loadProtocol();
  const task = taskById(protocol, TASK_ID);
  const prepared = await prepareConditionWorkspace({
    repository: repositoryById(protocol, task.repositoryId),
    condition: "raw",
    baseDirectory,
    fetcher: new FixtureFetcher(),
  });
  return prepared.path;
}

/** The minimal Codex stream: one read, one reported file change, one turn. */
function codexLog(): string {
  const events = [
    { type: "thread.started", thread_id: "thread-1" },
    { type: "turn.started" },
    { type: "item.completed", item: { type: "command_execution", command: "cat package.json" } },
    {
      type: "item.completed",
      item: { type: "file_change", changes: [{ path: "package.json", kind: "update" }] },
    },
    { type: "item.completed", item: { type: "agent_message", text: "Added the dependency." } },
    {
      type: "turn.completed",
      usage: {
        input_tokens: 100,
        cached_input_tokens: 0,
        output_tokens: 10,
        reasoning_output_tokens: 0,
      },
    },
  ];
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

describe("capture entry", () => {
  it("converts a saved client log into a validated transcript on disk", async () => {
    const workspacePath = await workspace();
    await writeFile(
      join(workspacePath, "package.json"),
      '{"name":"fixture","devDependencies":{"semver":"^7.6.0"}}\n',
      "utf8",
    );
    const logPath = join(baseDirectory, "codex.jsonl");
    await writeFile(logPath, codexLog(), "utf8");

    const outcome = await captureTranscript({
      client: "codex",
      logPath,
      taskId: TASK_ID,
      condition: "raw",
      workspaceRoot: workspacePath,
      startedAt: STARTED_AT,
      capturedAt: "2026-11-17T00:01:00.000Z",
      modelId: "gpt-5-codex",
      clientVersion: "0.166.0",
    });

    const out = join(baseDirectory, "transcripts", "axios-02.json");
    await writeTranscript(out, outcome.transcript);

    const written = parseTranscript(JSON.parse(await readFile(out, "utf8")) as unknown);
    expect(written.provenance.captured).toBe(true);
    expect(written.provenance.clientLogFormat).toBe("jsonl");
    expect(written.agent).toEqual({
      client: "codex-cli",
      version: "0.166.0",
      modelId: "gpt-5-codex",
    });
    expect(written.events.map((event) => event.kind)).toEqual(["shell", "write"]);
    expect(outcome.timingIsSequenceDerived).toBe(true);
  });

  it("refuses a Codex capture without a model and a task the protocol does not define", async () => {
    const workspacePath = await workspace();
    const logPath = join(baseDirectory, "codex.jsonl");
    await writeFile(logPath, codexLog(), "utf8");
    const base = {
      client: "codex" as const,
      logPath,
      condition: "raw" as const,
      workspaceRoot: workspacePath,
      startedAt: STARTED_AT,
    };

    await expect(captureTranscript({ ...base, taskId: TASK_ID })).rejects.toThrow(/--model-id/);
    await expect(
      captureTranscript({ ...base, taskId: "not-a-task", modelId: "gpt-5-codex" }),
    ).rejects.toThrow(/no protocol task/);
  });

  it("rejects malformed CLI arguments and accepts a complete invocation", async () => {
    const workspacePath = await workspace();
    const logPath = join(baseDirectory, "codex.jsonl");
    await writeFile(logPath, codexLog(), "utf8");
    const out = join(baseDirectory, "transcript.json");

    expect(await runCaptureCli(["--client", "codex"])).toBe(1);
    expect(
      await runCaptureCli([
        "--client",
        "other-cli",
        "--log",
        logPath,
        "--task",
        TASK_ID,
        "--condition",
        "raw",
        "--workspace",
        workspacePath,
        "--started-at",
        STARTED_AT,
        "--out",
        out,
      ]),
    ).toBe(1);

    expect(
      await runCaptureCli([
        "--client",
        "codex",
        "--log",
        logPath,
        "--task",
        TASK_ID,
        "--condition",
        "raw",
        "--workspace",
        workspacePath,
        "--started-at",
        STARTED_AT,
        "--model-id",
        "gpt-5-codex",
        "--out",
        out,
      ]),
    ).toBe(0);
    expect(parseTranscript(JSON.parse(await readFile(out, "utf8")) as unknown).events.length).toBe(
      2,
    );
  });
});
