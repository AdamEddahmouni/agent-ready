import { readFileSync } from "node:fs";
import { lstat, mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import { resolveWorkspacePath } from "./score.js";
import type {
  AgentObservations,
  Condition,
  FileReadRecord,
  FileWriteRecord,
  TokenMetrics,
  ToolCallRecord,
} from "./types.js";
import type { AgentRunRequest, AgentRunner } from "./run.js";

export const TRANSCRIPT_VERSION = 1;

export const TRANSCRIPT_SCHEMA_PATH = fileURLToPath(
  new URL("../../../schemas/research/phase1-benchmark-transcript-v1.schema.json", import.meta.url),
);

export interface TranscriptAgent {
  readonly client: string;
  readonly version: string;
  readonly modelId: string;
}

/**
 * Evidence that the transcript was captured from a real session. `captured`
 * must be true for any replay that counts toward a protocol run; authored
 * fixtures are allowed only in tests, explicitly.
 */
export interface TranscriptProvenance {
  readonly captured: boolean;
  readonly clientLogFormat?: string;
  readonly capturedAt?: string;
  readonly note?: string;
}

export interface TranscriptReadEvent {
  readonly kind: "read";
  readonly path: string;
  /** Milliseconds from the beginning of the trial. */
  readonly atMs: number;
}

export interface TranscriptWriteEvent {
  readonly kind: "write";
  readonly path: string;
  readonly content: string;
  readonly atMs: number;
}

export interface TranscriptShellEvent {
  readonly kind: "shell";
  readonly command: string;
  readonly atMs: number;
  readonly exitCode?: number | null;
  readonly timedOut?: boolean;
}

export interface TranscriptSearchEvent {
  readonly kind: "search";
  readonly query: string;
  readonly atMs: number;
}

export interface TranscriptOtherEvent {
  readonly kind: "other";
  readonly name: string;
  readonly atMs: number;
  readonly detail?: string;
}

export type TranscriptEvent =
  | TranscriptReadEvent
  | TranscriptWriteEvent
  | TranscriptShellEvent
  | TranscriptSearchEvent
  | TranscriptOtherEvent;

export interface AgentTranscript {
  readonly transcriptVersion: 1;
  readonly taskId: string;
  readonly condition: Condition;
  readonly agent: TranscriptAgent;
  readonly provenance: TranscriptProvenance;
  readonly startedAt: string;
  readonly events: readonly TranscriptEvent[];
  readonly finalResponse: string;
  readonly usage: TokenMetrics;
  /** Post-hoc adjudication; absent means fail closed to `false`. */
  readonly verificationSelectionResult?: boolean;
  readonly notes?: string;
}

let compiled: ValidateFunction | undefined;

function transcriptValidator(): ValidateFunction {
  if (compiled === undefined) {
    const schema = JSON.parse(readFileSync(TRANSCRIPT_SCHEMA_PATH, "utf8")) as object;
    compiled = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  }
  return compiled;
}

function isWithinRepository(path: string): boolean {
  if (path.length === 0 || path.startsWith("/") || /^[A-Za-z]:/.test(path)) return false;
  return !path.split("/").includes("..");
}

/**
 * Validates a transcript against the versioned schema plus the semantic rules
 * the schema cannot express: repository-relative paths and non-decreasing
 * timestamps. A transcript that fails either is rejected, never repaired.
 */
export function parseTranscript(input: unknown): AgentTranscript {
  const validate = transcriptValidator();
  if (!validate(input)) {
    const issues = (validate.errors ?? []).map((error) => {
      const path = error.instancePath.length > 0 ? error.instancePath : "/";
      return `${path}: ${error.message ?? "invalid"}`;
    });
    throw new TranscriptValidationError(issues);
  }

  const transcript = input as AgentTranscript;
  const issues: string[] = [];
  let previousAtMs = -1;
  transcript.events.forEach((event, index) => {
    if ("path" in event && !isWithinRepository(event.path)) {
      issues.push(
        `/events/${String(index)}/path: ${JSON.stringify(event.path)} is not repository-relative`,
      );
    }
    if (event.atMs < previousAtMs) {
      issues.push(`/events/${String(index)}/atMs: timestamps must be non-decreasing`);
    }
    previousAtMs = event.atMs;
  });
  if (issues.length > 0) throw new TranscriptValidationError(issues);

  return transcript;
}

export class TranscriptValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`agent transcript failed validation: ${issues.join("; ")}`);
    this.name = "TranscriptValidationError";
    this.issues = issues;
  }
}

/** One tool-call record per event, in recorded order. */
export function observationsFromTranscript(transcript: AgentTranscript): AgentObservations {
  const toolCalls: ToolCallRecord[] = [];
  const fileReads: FileReadRecord[] = [];
  const fileWrites: FileWriteRecord[] = [];

  for (const event of transcript.events) {
    switch (event.kind) {
      case "read":
        toolCalls.push({ name: "read_file", path: event.path, atMs: event.atMs });
        fileReads.push({ path: event.path, atMs: event.atMs });
        break;
      case "write":
        toolCalls.push({ name: "write_file", path: event.path, atMs: event.atMs });
        fileWrites.push({ path: event.path, content: event.content, atMs: event.atMs });
        break;
      case "shell":
        toolCalls.push({
          name: "shell",
          command: event.command,
          atMs: event.atMs,
          ...(event.exitCode !== undefined && { exitCode: event.exitCode }),
          ...(event.timedOut !== undefined && { timedOut: event.timedOut }),
        });
        break;
      case "search":
        toolCalls.push({ name: "search", query: event.query, atMs: event.atMs });
        break;
      case "other":
        toolCalls.push({
          name: event.name,
          atMs: event.atMs,
          ...(event.detail !== undefined && { detail: event.detail }),
        });
        break;
    }
  }

  return {
    finalResponse: transcript.finalResponse,
    toolCalls,
    fileReads,
    fileWrites,
    tokenMetrics: { ...transcript.usage },
    verificationSelectionResult: transcript.verificationSelectionResult ?? false,
    ...(transcript.notes !== undefined && { notes: transcript.notes }),
  };
}

function isErrno(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === code
  );
}

/**
 * Refuses a write that would pass through a symbolic link. The pinned checkout
 * is created by the harness, but a repository can legitimately contain links
 * and none of them may redirect a recorded write outside the workspace.
 */
async function assertNoSymlinkOnPath(workspaceRoot: string, absolutePath: string): Promise<void> {
  let current = workspaceRoot;
  for (const segment of relative(workspaceRoot, absolutePath).split(sep)) {
    current = `${current}${sep}${segment}`;
    const info = await lstat(current).catch((error: unknown) => {
      if (isErrno(error, "ENOENT")) return undefined;
      throw error;
    });
    if (info === undefined) return;
    if (info.isSymbolicLink()) {
      throw new Error(
        `refusing to write through a symbolic link: ${relative(workspaceRoot, current)}`,
      );
    }
  }
}

/**
 * Materializes the recorded writes into the prepared workspace, in recorded
 * order. Without this an edit-task oracle would read the pristine checkout and
 * fail a run the transcript describes as successful.
 */
export async function applyRecordedWrites(
  transcript: AgentTranscript,
  workspaceRoot: string,
): Promise<void> {
  for (const event of transcript.events) {
    if (event.kind !== "write") continue;
    const absolute = resolveWorkspacePath(workspaceRoot, event.path);
    await assertNoSymlinkOnPath(workspaceRoot, absolute);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, event.content, "utf8");
  }
}

/**
 * Replays a recorded transcript as an `AgentRunner`. It never invokes a model
 * or a subprocess. Recorded writes are applied to the prepared workspace so the
 * scorer observes the state the session produced, and the request must match
 * the transcript's task, condition, model, and client, so a transcript cannot
 * be replayed as a run it did not produce.
 */
export class TranscriptReplayRunner implements AgentRunner {
  constructor(
    private readonly transcript: AgentTranscript,
    options: { readonly allowAuthored?: boolean } = {},
  ) {
    if (!transcript.provenance.captured && options.allowAuthored !== true) {
      throw new TranscriptProvenanceError(transcript);
    }
  }

  async run(request: AgentRunRequest): Promise<AgentObservations> {
    const mismatches: string[] = [];
    if (request.taskId !== this.transcript.taskId) {
      mismatches.push(`taskId ${request.taskId} != ${this.transcript.taskId}`);
    }
    if (request.condition !== this.transcript.condition) {
      mismatches.push(`condition ${request.condition} != ${this.transcript.condition}`);
    }
    if (request.config.modelId !== this.transcript.agent.modelId) {
      mismatches.push(`modelId ${request.config.modelId} != ${this.transcript.agent.modelId}`);
    }
    if (request.config.agentClientVersion !== this.transcript.agent.version) {
      mismatches.push(
        `agentClientVersion ${request.config.agentClientVersion} != ${this.transcript.agent.version}`,
      );
    }
    if (mismatches.length > 0) {
      throw new Error(`transcript does not describe this run: ${mismatches.join("; ")}`);
    }
    await applyRecordedWrites(this.transcript, request.workspacePath);
    return await Promise.resolve(observationsFromTranscript(this.transcript));
  }
}

export class TranscriptProvenanceError extends Error {
  constructor(transcript: AgentTranscript) {
    super(
      `transcript for ${transcript.taskId} (${transcript.condition}) is not a real capture; ` +
        "an authored transcript may only be replayed with allowAuthored: true",
    );
    this.name = "TranscriptProvenanceError";
  }
}
