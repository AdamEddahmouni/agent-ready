import { readFile } from "node:fs/promises";
import { HarnessAbortError } from "./errors.js";
import type { CommandExecutor } from "./score.js";
import {
  createWorkspaceReader,
  resolveWorkspacePath,
  scoreRun,
  type ScoreRunResult,
} from "./score.js";
import { recordRawRun, type RawRunRecord } from "./record.js";
import type { PreparedConditionWorkspace } from "./prepare.js";
import type {
  AgentObservations,
  Condition,
  ProtocolVersion,
  TaskDefinition,
  TokenMetrics,
} from "./types.js";
import { selectedVerificationFor } from "./verificationSelection.js";

export interface RunConfiguration {
  readonly modelId: string;
  readonly agentClientVersion: string;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly systemPrompt?: string;
}

export interface ConditionAccess {
  readonly condition: Condition;
  readonly shell: boolean;
  readonly fileRead: boolean;
  readonly fileWrite: boolean;
  readonly snapshot: boolean;
  readonly twinQuery: boolean;
}

export interface AgentRunRequest {
  readonly runManifestId: string;
  readonly repositoryId: string;
  readonly taskId: string;
  readonly condition: Condition;
  readonly runIndex: number;
  /** Identical text in both conditions; condition differences live in `access`. */
  readonly prompt: string;
  /** Identical configuration object in both conditions. */
  readonly config: RunConfiguration;
  readonly workspacePath: string;
  /** Present only when `access.snapshot` is true. */
  readonly snapshotPath?: string;
  readonly access: ConditionAccess;
  readonly timeoutMs: number;
}

export interface AgentRunner {
  run(request: AgentRunRequest): Promise<AgentObservations>;
}

const RAW_ACCESS: ConditionAccess = Object.freeze({
  condition: "raw",
  shell: true,
  fileRead: true,
  fileWrite: true,
  snapshot: false,
  twinQuery: false,
});

const AGENT_READY_ACCESS: ConditionAccess = Object.freeze({
  condition: "agent-ready",
  shell: true,
  fileRead: true,
  fileWrite: true,
  snapshot: true,
  twinQuery: true,
});

export function conditionAccess(condition: Condition): ConditionAccess {
  return condition === "raw" ? RAW_ACCESS : AGENT_READY_ACCESS;
}

/**
 * The only condition-specific input is the access descriptor and, for
 * agent-ready, the snapshot path. Prompt, model, configuration, workspace,
 * run index, and timeout are shared verbatim.
 */
export function buildAgentRunRequest(options: {
  readonly runManifestId: string;
  readonly task: TaskDefinition;
  readonly repositoryId: string;
  readonly condition: Condition;
  readonly runIndex: number;
  readonly config: RunConfiguration;
  readonly workspace: PreparedConditionWorkspace;
}): AgentRunRequest {
  const access = conditionAccess(options.condition);
  if (access.snapshot && options.workspace.snapshotPath === undefined) {
    throw new Error("agent-ready trials require a prepared snapshot path");
  }

  return {
    runManifestId: options.runManifestId,
    repositoryId: options.repositoryId,
    taskId: options.task.id,
    condition: options.condition,
    runIndex: options.runIndex,
    prompt: options.task.prompt,
    config: Object.freeze({ ...options.config }),
    workspacePath: options.workspace.path,
    ...(access.snapshot && options.workspace.snapshotPath !== undefined
      ? { snapshotPath: options.workspace.snapshotPath }
      : {}),
    access,
    timeoutMs: options.task.timeoutMinutes * 60_000,
  };
}

const NULL_TOKEN_METRICS: TokenMetrics = {
  input: null,
  output: null,
  cached: null,
  reasoning: null,
};

export interface TrialResult {
  readonly record: RawRunRecord;
  readonly score: ScoreRunResult;
  readonly request: AgentRunRequest;
  readonly observations: AgentObservations;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function baselinePackageJson(
  workspace: PreparedConditionWorkspace,
): Promise<Record<string, string> | undefined> {
  try {
    const path = resolveWorkspacePath(workspace.path, "package.json");
    return { "package.json": await readFile(path, "utf8") };
  } catch {
    // A missing or unreadable baseline is not hidden: forbidden-action
    // detection fails closed if a package.json write needs comparison.
    return undefined;
  }
}

function failedObservations(error: unknown): AgentObservations {
  return {
    finalResponse: "",
    toolCalls: [],
    fileReads: [],
    fileWrites: [],
    tokenMetrics: NULL_TOKEN_METRICS,
    infrastructureFailure: true,
    notes: `agent runner failed: ${errorMessage(error)}`,
  };
}

/**
 * Runs one prepared trial, scores it mechanically, and validates the raw
 * record before returning it. A runner failure is recorded as an
 * infrastructure failure rather than silently dropping the trial.
 */
export async function executeTrial(options: {
  readonly runManifestId: string;
  readonly protocolVersion: ProtocolVersion;
  readonly task: TaskDefinition;
  readonly repositoryId: string;
  readonly condition: Condition;
  readonly runIndex: number;
  readonly config: RunConfiguration;
  readonly workspace: PreparedConditionWorkspace;
  readonly runner: AgentRunner;
  readonly commandExecutor: CommandExecutor;
  readonly adjudication?: Parameters<typeof scoreRun>[0]["adjudication"];
  readonly commandTimeoutMs?: number;
  readonly now?: () => number;
}): Promise<TrialResult> {
  const now = options.now ?? Date.now;
  const request = buildAgentRunRequest(options);
  const baselineFiles = await baselinePackageJson(options.workspace);

  const startTime = new Date(now()).toISOString();
  let observations: AgentObservations;
  try {
    observations = await options.runner.run(request);
  } catch (error) {
    // A mismatch or unusable input is a harness defect: abort instead of
    // recording a trial that was never actually run.
    if (error instanceof HarnessAbortError) throw error;
    observations = failedObservations(error);
  }
  const endTime = new Date(now()).toISOString();

  const score = await scoreRun({
    task: options.task,
    workspace: createWorkspaceReader(options.workspace.path),
    workspaceRoot: options.workspace.path,
    finalResponse: observations.finalResponse,
    toolCalls: observations.toolCalls,
    fileWrites: observations.fileWrites,
    commandExecutor: options.commandExecutor,
    ...(baselineFiles !== undefined && { baselineFiles }),
    ...(options.adjudication !== undefined && { adjudication: options.adjudication }),
    ...(options.commandTimeoutMs !== undefined && {
      commandTimeoutMs: options.commandTimeoutMs,
    }),
  });

  const notes: string[] = [];
  if (observations.notes !== undefined && observations.notes.length > 0) {
    notes.push(observations.notes);
  }
  if (!score.oracle.passed) notes.push(`oracle: ${score.oracle.reasons.join("; ")}`);
  for (const violation of score.forbidden) {
    notes.push(`forbidden ${violation.action} (${violation.class}): ${violation.detail}`);
  }

  const infrastructureFailure = observations.infrastructureFailure === true;
  const selectedVerification = selectedVerificationFor(options.task, observations.toolCalls);
  const raw: RawRunRecord = {
    protocolVersion: options.protocolVersion,
    runManifestId: options.runManifestId,
    taskId: options.task.id,
    condition: options.condition,
    runIndex: options.runIndex,
    startTime,
    endTime,
    timeToFirstCorrectModification: score.timeToFirstCorrectModification,
    success: score.success && !infrastructureFailure,
    toolCalls: [...observations.toolCalls],
    fileReads: [...observations.fileReads],
    fileWrites: [...observations.fileWrites],
    tokenMetrics: observations.tokenMetrics,
    assumptions: [...(observations.assumptions ?? [])],
    dependencyReasoningFindings: [...(observations.dependencyReasoningFindings ?? [])],
    verificationAttempts: [...(observations.verificationAttempts ?? [])],
    verificationSelectionResult:
      options.protocolVersion === 3 && selectedVerification === undefined
        ? null
        : observations.verificationSelectionResult === true || selectedVerification === true,
    finalPatch: observations.finalPatch ?? null,
    verificationResults: [...(observations.verificationResults ?? [])],
    infrastructureFailure,
    ...(notes.length > 0 && { notes: notes.join("\n") }),
  };

  return {
    record: recordRawRun(raw),
    score,
    request,
    observations,
  };
}
