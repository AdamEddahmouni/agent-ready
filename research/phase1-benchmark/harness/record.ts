import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import type { Condition, TokenMetrics } from "./types.js";

export const RAW_RUN_SCHEMA_PATH = fileURLToPath(
  new URL("../../../schemas/research/phase1-benchmark-raw-run-v1.schema.json", import.meta.url),
);

export interface RawRunRecord {
  readonly protocolVersion: 1;
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

let compiled: ValidateFunction | undefined;

function rawRunValidator(): ValidateFunction {
  if (compiled === undefined) {
    const schema = JSON.parse(readFileSync(RAW_RUN_SCHEMA_PATH, "utf8")) as object;
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
    compiled = ajv.compile(schema);
  }
  return compiled;
}

/** Validates one raw run record against the frozen protocol schema. */
export function validateRawRun(input: unknown): RawRunValidationResult {
  const validate = rawRunValidator();
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
