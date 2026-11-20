import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import type { ProtocolBundle } from "./harness/types.js";

export const RUN_MANIFEST_SCHEMA_PATH = fileURLToPath(
  new URL("../../schemas/research/phase1-benchmark-run-manifest-v1.schema.json", import.meta.url),
);

export interface RunManifestRepository {
  readonly id: string;
  readonly commit: string;
}

export interface RunManifest {
  readonly protocolVersion: 1;
  readonly id: string;
  readonly createdAt: string;
  readonly model: {
    readonly id: string;
    readonly configuration: Readonly<Record<string, unknown>>;
  };
  readonly agentClient: {
    readonly name: string;
    readonly version: string;
  };
  readonly environment: {
    readonly os: string;
    readonly node: string;
  };
  readonly agentReadyCommit: string;
  readonly repositories: readonly RunManifestRepository[];
  readonly runs: {
    readonly perTaskPerCondition: number;
    readonly perCondition: number;
    readonly total: number;
  };
  readonly budgets: Readonly<Record<string, number>>;
  readonly randomizationSeed: string;
  readonly notes?: string;
}

export type RunManifestValidationResult =
  | { readonly ok: true; readonly manifest: RunManifest }
  | { readonly ok: false; readonly errors: readonly string[] };

let compiled: ValidateFunction | undefined;

function runManifestValidator(): ValidateFunction {
  if (compiled === undefined) {
    const schema = JSON.parse(readFileSyncSchema()) as object;
    const ajv = new Ajv2020({ allErrors: true, strict: true });
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

function readFileSyncSchema(): string {
  // The schema is small, frozen, and read once per process; a synchronous read
  // keeps validator construction independent of an async loader.
  return readFileSync(RUN_MANIFEST_SCHEMA_PATH, "utf8");
}

/** Validates one run manifest against the frozen protocol schema. */
export function validateRunManifest(input: unknown): RunManifestValidationResult {
  const validate = runManifestValidator();
  if (!validate(input)) {
    const errors = (validate.errors ?? []).map((error) => {
      const path = error.instancePath.length > 0 ? error.instancePath : "/";
      return `${path}: ${error.message ?? "invalid"}`;
    });
    return { ok: false, errors };
  }
  return { ok: true, manifest: input as RunManifest };
}

export class RunManifestValidationError extends Error {
  readonly errors: readonly string[];

  constructor(errors: readonly string[]) {
    super(`run manifest failed schema validation: ${errors.join("; ")}`);
    this.name = "RunManifestValidationError";
    this.errors = errors;
  }
}

/** Loads and schema-validates a run manifest; invalid input is never returned. */
export async function loadRunManifest(path: string): Promise<RunManifest> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  const result = validateRunManifest(parsed);
  if (!result.ok) throw new RunManifestValidationError(result.errors);
  return result.manifest;
}

function containsPlaceholder(value: unknown): boolean {
  if (typeof value === "string") return value.includes("REPLACE_WITH_");
  if (Array.isArray(value)) return (value as unknown[]).some(containsPlaceholder);
  if (value !== null && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some(containsPlaceholder);
  }
  return false;
}

function assertBudget(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`run manifest budget ${name} must be a finite non-negative number`);
  }
}

/**
 * Cross-checks a schema-valid manifest against the frozen protocol. This is
 * the gate that stops a template or a manifest with stale repository pins from
 * being used for a pilot or an official run.
 */
export function validateRunManifestAgainstProtocol(
  manifest: RunManifest,
  protocol: ProtocolBundle,
): void {
  if (containsPlaceholder(manifest)) {
    throw new Error("run manifest still contains REPLACE_WITH_ placeholders");
  }
  if (/^0{40}$/.test(manifest.agentReadyCommit)) {
    throw new Error("run manifest agentReadyCommit must not be the all-zero template value");
  }

  const expectedRepositories = new Map(
    protocol.repositories.map((repository) => [repository.id, repository.commit]),
  );
  const actualRepositories = new Map<string, string>();
  for (const repository of manifest.repositories) {
    if (actualRepositories.has(repository.id)) {
      throw new Error(`run manifest has duplicate repository id ${JSON.stringify(repository.id)}`);
    }
    actualRepositories.set(repository.id, repository.commit);
  }
  for (const [id, commit] of expectedRepositories) {
    const actual = actualRepositories.get(id);
    if (actual === undefined) {
      throw new Error(`run manifest is missing protocol repository ${JSON.stringify(id)}`);
    }
    if (actual !== commit) {
      throw new Error(
        `run manifest repository ${JSON.stringify(id)} pins ${actual}, expected ${commit}`,
      );
    }
  }
  if (actualRepositories.size !== expectedRepositories.size) {
    throw new Error(
      `run manifest declares ${String(actualRepositories.size)} repositories, protocol v1 has ${String(expectedRepositories.size)}`,
    );
  }

  const expectedPerTaskPerCondition = protocol.manifest.runsPerTaskPerCondition;
  if (manifest.runs.perTaskPerCondition !== expectedPerTaskPerCondition) {
    throw new Error(
      `run manifest runs.perTaskPerCondition must be ${String(expectedPerTaskPerCondition)}`,
    );
  }
  const expectedPerCondition = protocol.tasks.length * expectedPerTaskPerCondition;
  if (manifest.runs.perCondition !== expectedPerCondition) {
    throw new Error(`run manifest runs.perCondition must be ${String(expectedPerCondition)}`);
  }
  const expectedTotal = expectedPerCondition * protocol.manifest.conditions.length;
  if (manifest.runs.total !== expectedTotal) {
    throw new Error(`run manifest runs.total must be ${String(expectedTotal)}`);
  }

  for (const required of ["maxTotalTokens", "maxTotalCostUsd"] as const) {
    const value = manifest.budgets[required];
    if (value === undefined) {
      throw new Error(`run manifest budgets must declare ${required}`);
    }
    assertBudget(required, value);
  }
  for (const [name, value] of Object.entries(manifest.budgets)) {
    assertBudget(name, value);
  }
}
