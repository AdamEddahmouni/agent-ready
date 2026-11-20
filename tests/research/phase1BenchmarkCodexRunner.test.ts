import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  CodexAgentRunner,
  type AgentProcess,
  type AgentProcessSpawner,
  type CompletedProcess,
} from "../../research/phase1-benchmark/harness/codexRunner.js";
import type { AgentRunRequest } from "../../research/phase1-benchmark/harness/run.js";
import { removeTree } from "../../src/filesystem/removeTree.js";

/**
 * The runner is exercised against the committed axios-03 session log, with the
 * paths rewritten to a throwaway checkout. Nothing here invokes a model: the
 * spawner replays the recorded stream.
 */

const CAPTURE =
  "research/phase1-benchmark/captures/axios-03-add-sponsor-data-check-codex-gpt-6.2-sol.jsonl";
const TRANSCRIPT =
  "research/phase1-benchmark/captures/axios-03-add-sponsor-data-check-codex-gpt-6.2-sol.json";

interface FakeProcessScript {
  readonly lines: readonly string[];
  readonly exitCode?: number | null;
  readonly signal?: NodeJS.Signals | null;
  readonly neverCompletes?: boolean;
}

function fakeSpawner(script: FakeProcessScript): AgentProcessSpawner {
  return (): AgentProcess => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    let resolveCompletion!: (value: CompletedProcess) => void;
    const completion = new Promise<CompletedProcess>((resolve) => {
      resolveCompletion = resolve;
    });
    const finish = (exitCode: number | null, signal: NodeJS.Signals | null): void => {
      stdout.end();
      stderr.end();
      resolveCompletion({ exitCode, signal });
    };
    setImmediate(() => {
      for (const line of script.lines) stdout.write(`${line}\n`);
      if (script.neverCompletes !== true) finish(script.exitCode ?? 0, script.signal ?? null);
    });
    return {
      stdout,
      stderr,
      completion,
      kill: () => {
        finish(null, "SIGTERM");
      },
    };
  };
}

async function checkoutWithCapturedState(): Promise<{ workspace: string; lines: string[] }> {
  const base = await mkdtemp(join(tmpdir(), "phase1-codex-runner-"));
  const workspace = join(base, "repo");
  await mkdir(workspace, { recursive: true });
  await writeFile(join(workspace, "package.json"), '{"name":"fixture"}\n', "utf8");
  execFileSync("git", ["init", "--quiet"], { cwd: workspace });
  execFileSync("git", ["add", "."], { cwd: workspace });
  execFileSync(
    "git",
    ["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-m", "init"],
    {
      cwd: workspace,
      stdio: "ignore",
    },
  );

  const transcript = JSON.parse(await readFile(TRANSCRIPT, "utf8")) as {
    readonly events: readonly {
      readonly kind: string;
      readonly path?: string;
      readonly content?: string;
    }[];
  };
  const write = transcript.events.find((event) => event.kind === "write");
  if (write?.path === undefined || write.content === undefined) {
    throw new Error("capture has no recorded write to replay");
  }
  await writeFile(join(workspace, write.path), write.content, "utf8");

  const raw = (await readFile(CAPTURE, "utf8")).split("\n").filter((line) => line.length > 0);
  const pilotPath = "/tmp/phase1-pilot";
  const lines = raw.map((line) => {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    return JSON.stringify(parsed).replaceAll(
      /\/tmp\/phase1-pilot\/[^"]*?\/repo/g,
      workspace.replaceAll("\\", "\\\\"),
    );
  });
  expect(lines.join("\n")).not.toContain(pilotPath);
  return { workspace, lines };
}

function request(overrides: Partial<AgentRunRequest> = {}): AgentRunRequest {
  return {
    runManifestId: "runner-test",
    repositoryId: "axios",
    taskId: "axios-03-add-sponsor-data-check",
    condition: "raw",
    runIndex: 0,
    prompt: "add the check script",
    config: { modelId: "gpt-6.2-sol", agentClientVersion: "0.166.0" },
    workspacePath: "/tmp/unused/repo",
    access: {
      condition: "raw",
      shell: true,
      fileRead: true,
      fileWrite: true,
      snapshot: false,
      twinQuery: false,
    },
    timeoutMs: 5_000,
    ...overrides,
  };
}

describe("codex trial runner", () => {
  it("runs the recorded session, writes the log, and measures event timing", async () => {
    const { workspace, lines } = await checkoutWithCapturedState();
    const logDirectory = await mkdtemp(join(tmpdir(), "phase1-codex-logs-"));
    try {
      let seenArgs: readonly string[] = [];
      let seenEnv: NodeJS.ProcessEnv = {};
      const spawn = fakeSpawner({ lines });
      const runner = new CodexAgentRunner({
        logDirectory,
        clientVersion: "0.166.0",
        spawn: (options) => {
          seenArgs = options.args;
          seenEnv = options.env;
          return spawn(options);
        },
        baseEnv: { PATH: "/usr/bin" },
      });

      const observations = await runner.run(request({ workspacePath: workspace }));

      expect(observations.infrastructureFailure).toBe(false);
      expect(observations.tokenMetrics.input).toBe(54_211);
      expect(observations.tokenMetrics.output).toBe(251);
      expect(observations.finalResponse.length).toBeGreaterThan(0);
      expect(observations.toolCalls.some((call) => call.name === "shell")).toBe(true);
      expect(observations.toolCalls.some((call) => call.name === "write_file")).toBe(true);
      expect(observations.notes ?? "").not.toContain("sequence-derived");

      expect(seenArgs).toContain("--cd");
      expect(seenArgs).toContain(workspace);
      expect(seenArgs[seenArgs.length - 1]).toContain("add the check script");
      expect(seenEnv["PATH"]).toBe("/usr/bin");

      const last = runner.last;
      expect(last?.transcript?.provenance.captured).toBe(true);
      expect(last?.exitCode).toBe(0);
      const log = await readFile(last?.logPath ?? "", "utf8");
      expect(log.split("\n").filter((line) => line.length > 0)).toHaveLength(lines.length);
    } finally {
      await removeTree(logDirectory);
      await removeTree(dirname(workspace));
    }
  });

  it("records a non-zero exit as an infrastructure failure with the log kept", async () => {
    const { workspace, lines } = await checkoutWithCapturedState();
    const logDirectory = await mkdtemp(join(tmpdir(), "phase1-codex-logs-"));
    try {
      const runner = new CodexAgentRunner({
        logDirectory,
        clientVersion: "0.166.0",
        spawn: fakeSpawner({ lines, exitCode: 2 }),
      });
      const observations = await runner.run(request({ workspacePath: workspace }));
      expect(observations.infrastructureFailure).toBe(true);
      expect(observations.notes ?? "").toContain("exited 2");
      expect(runner.last?.logPath).toBeDefined();
    } finally {
      await removeTree(logDirectory);
      await removeTree(dirname(workspace));
    }
  });

  it("kills a session that exceeds the trial timeout", async () => {
    const base = await mkdtemp(join(tmpdir(), "phase1-codex-timeout-"));
    const logDirectory = await mkdtemp(join(tmpdir(), "phase1-codex-logs-"));
    try {
      const runner = new CodexAgentRunner({
        logDirectory,
        clientVersion: "0.166.0",
        spawn: fakeSpawner({ lines: [], neverCompletes: true }),
      });
      const observations = await runner.run(
        request({ workspacePath: join(base, "repo"), timeoutMs: 20 }),
      );
      expect(observations.infrastructureFailure).toBe(true);
      expect(observations.notes ?? "").toContain("exceeded 20 ms");
    } finally {
      await removeTree(logDirectory);
      await removeTree(base);
    }
  });

  it("reports a log it cannot convert instead of dropping the trial", async () => {
    const base = await mkdtemp(join(tmpdir(), "phase1-codex-unconvertible-"));
    const logDirectory = await mkdtemp(join(tmpdir(), "phase1-codex-logs-"));
    try {
      const lines = [
        JSON.stringify({
          type: "item.completed",
          item: {
            id: "item_1",
            type: "file_change",
            changes: [{ path: "missing.ts", kind: "update" }],
          },
        }),
        JSON.stringify({
          type: "turn.completed",
          usage: {
            input_tokens: 1,
            output_tokens: 1,
            cached_input_tokens: 0,
            reasoning_output_tokens: 0,
          },
        }),
      ];
      const runner = new CodexAgentRunner({
        logDirectory,
        clientVersion: "0.166.0",
        spawn: fakeSpawner({ lines }),
      });
      const observations = await runner.run(request({ workspacePath: join(base, "repo") }));
      expect(observations.infrastructureFailure).toBe(true);
      expect(observations.notes ?? "").toContain("could not be converted");
    } finally {
      await removeTree(logDirectory);
      await removeTree(base);
    }
  });
});
