import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { buildAgentPrompt } from "./access.js";
import { transcriptFromCodexStream } from "./codex.js";
import type { AgentRunRequest, AgentRunner } from "./run.js";
import { observationsFromTranscript, type AgentTranscript } from "./transcript.js";
import type { AgentObservations } from "./types.js";

/**
 * Runs one live trial with `codex exec --json`. The runner writes the client's
 * stream to disk verbatim, timestamps each event as it arrives so the timing
 * metric is measured rather than sequence-derived, and converts the finished
 * log through the same adapter the offline capture path uses.
 *
 * It never scores, replays, or repairs: a session that fails, times out, or
 * cannot be converted is reported as an infrastructure failure so the trial is
 * recorded rather than dropped.
 */

export interface CompletedProcess {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
}

export interface AgentProcess {
  readonly stdout: NodeJS.ReadableStream;
  readonly stderr: NodeJS.ReadableStream;
  readonly completion: Promise<CompletedProcess>;
  kill(signal?: NodeJS.Signals): void;
}

export type AgentProcessSpawner = (options: {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
}) => AgentProcess;

export const spawnAgentProcess: AgentProcessSpawner = ({ command, args, cwd, env }) => {
  const child = spawn(command, [...args], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  return {
    stdout: child.stdout,
    stderr: child.stderr,
    completion: new Promise<CompletedProcess>((resolve) => {
      child.on("close", (code, signal) => {
        resolve({ exitCode: code, signal });
      });
    }),
    kill: (signal?: NodeJS.Signals) => {
      child.kill(signal ?? "SIGTERM");
    },
  };
};

export interface CodexInvocation {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
}

export interface CodexInvocationOptions {
  readonly prompt: string;
  readonly codexCommand?: string;
  /** Prepended to PATH so the agent-ready wrapper is callable by name. */
  readonly binDirectory?: string;
  readonly baseEnv?: NodeJS.ProcessEnv;
  readonly extraArgs?: readonly string[];
}

/**
 * The client invocation for one trial. Prompt, model, sandbox and working
 * directory come from the request; the only optional addition is the wrapper
 * directory on PATH for the agent-ready condition.
 */
export function buildCodexInvocation(
  request: AgentRunRequest,
  options: CodexInvocationOptions,
): CodexInvocation {
  const baseEnv = options.baseEnv ?? process.env;
  const env: NodeJS.ProcessEnv =
    options.binDirectory === undefined
      ? { ...baseEnv }
      : {
          ...baseEnv,
          PATH: `${options.binDirectory}${delimiter}${baseEnv["PATH"] ?? ""}`,
        };
  return {
    command: options.codexCommand ?? "codex",
    args: [
      "exec",
      "--json",
      "--skip-git-repo-check",
      "--sandbox",
      "workspace-write",
      "--model",
      request.config.modelId,
      "--cd",
      request.workspacePath,
      ...(options.extraArgs ?? []),
      options.prompt,
    ],
    cwd: request.workspacePath,
    env,
  };
}

/** The wrapper directory a request's condition needs on PATH, if any. */
export function wrapperDirectoryFor(request: AgentRunRequest): string | undefined {
  return request.access.twinQuery ? join(dirname(request.workspacePath), "bin") : undefined;
}

export interface CodexRunnerOptions {
  /** Directory for the raw client log and its stderr companion. */
  readonly logDirectory: string;
  readonly clientVersion: string;
  readonly codexCommand?: string;
  readonly spawn?: AgentProcessSpawner;
  readonly baseEnv?: NodeJS.ProcessEnv;
  readonly extraArgs?: readonly string[];
  readonly onShellMutation?: "refuse" | "flag";
  readonly now?: () => number;
}

export interface LiveTrialArtifacts {
  readonly logPath: string;
  readonly stderrPath: string;
  readonly transcript?: AgentTranscript;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
}

const MAX_STDERR_CHARS = 64_000;

/**
 * A live runner. `last` holds the artifacts of the most recent session so the
 * orchestrator can persist the log and transcript without re-reading anything.
 */
export class CodexAgentRunner implements AgentRunner {
  last: LiveTrialArtifacts | undefined;

  constructor(private readonly options: CodexRunnerOptions) {}

  async run(request: AgentRunRequest): Promise<AgentObservations> {
    const now = this.options.now ?? Date.now;
    const spawnProcess = this.options.spawn ?? spawnAgentProcess;
    const startedAt = new Date(now()).toISOString();
    const started = now();
    const logPath = join(
      this.options.logDirectory,
      `${request.taskId}--${request.condition}--${String(request.runIndex)}.jsonl`,
    );
    const stderrPath = `${logPath.slice(0, -".jsonl".length)}.stderr.log`;
    await mkdir(dirname(logPath), { recursive: true });

    const binDirectory = wrapperDirectoryFor(request);
    const invocation = buildCodexInvocation(request, {
      prompt: buildAgentPrompt(request, binDirectory),
      ...(this.options.codexCommand !== undefined && {
        codexCommand: this.options.codexCommand,
      }),
      ...(binDirectory !== undefined && { binDirectory }),
      ...(this.options.baseEnv !== undefined && { baseEnv: this.options.baseEnv }),
      ...(this.options.extraArgs !== undefined && { extraArgs: this.options.extraArgs }),
    });

    // Held in an object because TypeScript narrows a `let` assigned only from a
    // timer callback to its initial literal, which would make the check dead.
    const state = { timedOut: false };
    let process: AgentProcess;
    try {
      process = spawnProcess(invocation);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return failedObservations(`could not start ${invocation.command}: ${reason}`, logPath);
    }

    const lines: string[] = [];
    // One timestamp per event-producing item, in the order the adapter asks.
    const itemTimings: number[] = [];
    let stderr = "";

    const timer = setTimeout(() => {
      state.timedOut = true;
      process.kill("SIGTERM");
    }, request.timeoutMs);

    const stdoutLines = createInterface({ input: process.stdout, crlfDelay: Infinity });
    stdoutLines.on("line", (line) => {
      lines.push(line);
      let parsed: unknown;
      try {
        parsed = JSON.parse(line) as unknown;
      } catch {
        return;
      }
      if (typeof parsed !== "object" || parsed === null) return;
      const event = parsed as { readonly type?: unknown; readonly item?: unknown };
      if (event.type !== "item.completed") return;
      const item = event.item as { readonly type?: unknown } | undefined;
      const itemType = item?.type;
      if (itemType === "agent_message" || itemType === "reasoning") return;
      itemTimings.push(now() - started);
    });
    process.stderr.on("data", (chunk: Buffer | string) => {
      if (stderr.length >= MAX_STDERR_CHARS) return;
      stderr += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    });

    let completion: CompletedProcess;
    try {
      completion = await process.completion;
    } finally {
      clearTimeout(timer);
      stdoutLines.close();
    }

    const stream = lines.length > 0 ? `${lines.join("\n")}\n` : "";
    await writeFile(logPath, stream, "utf8");
    await writeFile(stderrPath, stderr, "utf8");

    const fatal: string[] = [];
    if (state.timedOut) fatal.push(`the client exceeded ${String(request.timeoutMs)} ms`);
    if (completion.exitCode !== 0) {
      fatal.push(
        `the client exited ${completion.exitCode === null ? "without a status" : String(completion.exitCode)}${completion.signal === null ? "" : ` (${completion.signal})`}`,
      );
    }

    let transcript: AgentTranscript | undefined;
    try {
      const result = await transcriptFromCodexStream(stream, {
        taskId: request.taskId,
        condition: request.condition,
        workspaceRoot: request.workspacePath,
        startedAt,
        capturedAt: new Date(now()).toISOString(),
        modelId: request.config.modelId,
        clientVersion: this.options.clientVersion,
        timing: (index) => itemTimings[index],
        onShellMutation: this.options.onShellMutation ?? "flag",
      });
      transcript = result.transcript;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      fatal.push(`the session could not be converted: ${reason}`);
    }

    this.last = {
      logPath,
      stderrPath,
      ...(transcript !== undefined && { transcript }),
      exitCode: completion.exitCode,
      timedOut: state.timedOut,
    };

    if (transcript === undefined) {
      return failedObservations(fatal.join("; "), logPath);
    }

    const observations = observationsFromTranscript(transcript);
    const notes = [
      observations.notes,
      ...fatal,
      ...(stderr.length > 0 ? [`client stderr: ${stderr.trim().slice(0, 2_000)}`] : []),
    ].filter((note): note is string => note !== undefined && note.length > 0);

    return {
      ...observations,
      infrastructureFailure: fatal.length > 0,
      ...(notes.length > 0 && { notes: notes.join("; ") }),
    };
  }
}

function failedObservations(note: string, logPath: string): AgentObservations {
  return {
    finalResponse: "",
    toolCalls: [],
    fileReads: [],
    fileWrites: [],
    tokenMetrics: { input: null, output: null, cached: null, reasoning: null },
    infrastructureFailure: true,
    notes: `${note}; raw log at ${logPath}`,
  };
}
