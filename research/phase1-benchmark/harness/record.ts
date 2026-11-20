import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import type { Condition, ProtocolVersion, TokenMetrics } from "./types.js";

/**
 * Raw records are validated against the schema of the protocol version they
 * cite. v1 and v2 differ only in the frozen `axios-01` oracle, but a record
 * from one version must never be silently accepted as a record of the other, so
 * the version is read from the document and its own schema is applied.
 */

const RAW_RUN_SCHEMA_PATHS: Readonly<Record<ProtocolVersion, string>> = {
  1: fileURLToPath(
    new URL("../../../schemas/research/phase1-benchmark-raw-run-v1.schema.json", import.meta.url),
  ),
  2: fileURLToPath(
    new URL("../../../schemas/research/phase1-benchmark-raw-run-v2.schema.json", import.meta.url),
  ),
};

/** The v1 schema path, kept for callers that predate v2. */
export const RAW_RUN_SCHEMA_PATH = RAW_RUN_SCHEMA_PATHS[1];

export interface RawRunRecord {
  readonly protocolVersion: ProtocolVersion;
  readonly runManifestId: string;
  readonly taskId: string;
  readonly condition: Condition;
  readonly runIndex: number;
  readonly startTime: string;
  readonly endTime: string;
  readonly timeToFirstCorrectModification?: number | null;
  readonly success: boolean;
  readonly toolCalls: readonly Record<string, unknown>[];
  readonly fileReads: readonly Record<string, unknown>[];
  readonly fileWrites: readonly Record<string, unknown>[];
  readonly tokenMetrics: TokenMetrics;
  readonly assumptions: readonly Record<string, unknown>[];
  readonly dependencyReasoningFindings: readonly Record<string, unknown>[];
  readonly verificationAttempts?: readonly Record<string, unknown>[];
  readonly verificationSelectionResult: boolean;
  readonly finalPatch?: string | null;
  readonly verificationResults?: readonly Record<string, unknown>[];
  readonly infrastructureFailure: boolean;
  readonly notes?: string;
}

export type RawRunValidationResult =
  | { readonly ok: true; readonly record: RawRunRecord }
  | { readonly ok: false; readonly errors: readonly string[] };

const compiled = new Map<ProtocolVersion, ValidateFunction>();

function rawRunValidator(version: ProtocolVersion): ValidateFunction {
  const cached = compiled.get(version);
  if (cached !== undefined) return cached;

  const schema = JSON.parse(readFileSync(RAW_RUN_SCHEMA_PATHS[version], "utf8")) as object;
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  // The schema uses `format: "date-time"` without pulling in ajv-formats.
  // A strict ISO check is enough for the harness's own timestamps and avoids
  // adding a runtime dependency for one format.
  ajv.addFormat("date-time", {
    type: "string",
    validate: (value: string) => {
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
        return false;
      }
      return !Number.isNaN(Date.parse(value));
    },
  });
  const validate = ajv.compile(schema);
  compiled.set(version, validate);
  return validate;
}

function declaredVersion(input: unknown): ProtocolVersion | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const version = (input as Record<string, unknown>)["protocolVersion"];
  return version === 1 || version === 2 ? version : undefined;
}

/** Validates one raw run record against the frozen schema of its own version. */
export function validateRawRun(input: unknown): RawRunValidationResult {
  const version = declaredVersion(input);
  if (version === undefined) {
    return { ok: false, errors: ["/protocolVersion: must be 1 or 2"] };
  }
  const validate = rawRunValidator(version);
  if (!validate(input)) {
    const errors = (validate.errors ?? []).map((error) => {
      const path = error.instancePath.length > 0 ? error.instancePath : "/";
      return `${path}: ${error.message ?? "invalid"}`;
    });
    return { ok: false, errors };
  }
  return { ok: true, record: input as RawRunRecord };
}

export class RawRunValidationError extends Error {
  readonly errors: readonly string[];

  constructor(errors: readonly string[]) {
    super(`raw run record failed schema validation: ${errors.join("; ")}`);
    this.name = "RawRunValidationError";
    this.errors = errors;
  }
}

/** Validates and returns a typed record; callers must not persist an invalid one. */
export function recordRawRun(input: unknown): RawRunRecord {
  const result = validateRawRun(input);
  if (!result.ok) throw new RawRunValidationError(result.errors);
  return result.record;
}
