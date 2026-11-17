/**
 * Shared types for the Phase 1 benchmark harness.
 *
 * This directory is research tooling. It is intentionally outside `src/`,
 * so `tsconfig.build.json` never emits it into `dist` and the published
 * package's `files` list never includes it.
 */

export type Condition = "raw" | "agent-ready";

export type JsonValue =
  null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface RepositoryPin {
  readonly id: string;
  readonly url: string;
  readonly commit: string;
  readonly rationale: string;
}

export interface ProtocolManifest {
  readonly protocolVersion: 1;
  readonly title: string;
  readonly conditions: readonly { readonly id: Condition; readonly description: string }[];
  readonly runsPerTaskPerCondition: number;
  readonly immutability: string;
}

export interface ProtocolBundle {
  readonly manifest: ProtocolManifest;
  readonly repositories: readonly RepositoryPin[];
  readonly tasks: readonly TaskDefinition[];
}

export interface ResponseJsonPathEqualsOracle {
  readonly type: "response-json-path-equals";
  readonly path: string;
  readonly value: JsonValue;
}

export interface FileContainsOracle {
  readonly type: "file-contains";
  readonly path: string;
  readonly substring: string;
}

export interface FileJsonEqualsOracle {
  readonly type: "file-json-equals";
  readonly file: string;
  readonly pointer: string;
  readonly value: JsonValue;
}

export interface CommandExitZeroOracle {
  readonly type: "command-exit-zero";
  readonly command: string;
  readonly cwd?: string;
}

export interface ManualRubricOracle {
  readonly type: "manual-rubric";
  readonly rubricId: string;
  readonly rubric: string;
}

export interface AllOfOracle {
  readonly type: "all-of";
  readonly clauses: readonly Oracle[];
}

export type Oracle =
  | ResponseJsonPathEqualsOracle
  | FileContainsOracle
  | FileJsonEqualsOracle
  | CommandExitZeroOracle
  | ManualRubricOracle
  | AllOfOracle;

export interface TaskDefinition {
  readonly id: string;
  readonly repositoryId: string;
  readonly prompt: string;
  readonly responseFormat?: "json";
  readonly successOracle: Oracle;
  readonly forbidden: readonly string[];
  readonly verificationSurface: readonly string[];
  readonly timeoutMinutes: number;
}

export interface TokenMetrics {
  readonly input: number | null;
  readonly output: number | null;
  readonly cached: number | null;
  readonly reasoning: number | null;
}

export interface ToolCallRecord {
  readonly name: string;
  readonly command?: string;
  readonly [key: string]: unknown;
}

export interface FileReadRecord {
  readonly path: string;
  readonly atMs?: number;
  readonly [key: string]: unknown;
}

export interface FileWriteRecord {
  readonly path: string;
  readonly content: string;
  /** Milliseconds from the beginning of the trial. */
  readonly atMs: number;
  readonly [key: string]: unknown;
}

export interface AgentObservations {
  readonly finalResponse: string;
  readonly toolCalls: readonly ToolCallRecord[];
  readonly fileReads: readonly FileReadRecord[];
  readonly fileWrites: readonly FileWriteRecord[];
  readonly tokenMetrics: TokenMetrics;
  readonly assumptions?: readonly Record<string, unknown>[];
  readonly dependencyReasoningFindings?: readonly Record<string, unknown>[];
  readonly verificationAttempts?: readonly Record<string, unknown>[];
  readonly verificationSelectionResult?: boolean;
  readonly finalPatch?: string | null;
  readonly verificationResults?: readonly Record<string, unknown>[];
  readonly infrastructureFailure?: boolean;
  readonly notes?: string;
}
