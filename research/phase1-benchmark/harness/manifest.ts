import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";

/**
 * Loads the committed run manifest for a run. The manifest is the environment
 * a trial executes inside, so an unreadable or non-conforming one aborts the
 * run instead of being repaired or defaulted.
 */

export const RUN_MANIFEST_SCHEMA_PATH = fileURLToPath(
  new URL(
    "../../../schemas/research/phase1-benchmark-run-manifest-v1.schema.json",
    import.meta.url,
  ),
);

export const DEFAULT_RUN_MANIFEST_PATH = fileURLToPath(
  new URL("../../../docs/research/phase1-benchmark-run-v1/run-manifest.json", import.meta.url),
);

export interface RunManifestBudgets {
  readonly maxTotalTokens: number;
  readonly maxTotalWallClockMinutes: number;
  readonly maxInfrastructureRetriesPerTrial: number;
}

export interface RunManifest {
  readonly protocolVersion: 1;
  readonly id: string;
  readonly createdAt: string;
  readonly model: {
    readonly id: string;
    readonly configuration: Record<string, unknown>;
  };
  readonly agentClient: { readonly name: string; readonly version: string };
  readonly environment: { readonly os: string; readonly node: string };
  readonly agentReadyCommit: string;
  readonly repositories: readonly { readonly id: string; readonly commit: string }[];
  readonly runs: {
    readonly perTaskPerCondition: number;
    readonly perCondition: number;
    readonly total: number;
  };
  readonly budgets: RunManifestBudgets;
  readonly randomizationSeed: string;
  readonly notes?: string;
}

export class RunManifestError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`run manifest is unusable: ${issues.join("; ")}`);
    this.name = "RunManifestError";
    this.issues = issues;
  }
}

let compiled: ValidateFunction | undefined;

function manifestValidator(): ValidateFunction {
  if (compiled === undefined) {
    const schema = JSON.parse(readFileSync(RUN_MANIFEST_SCHEMA_PATH, "utf8")) as object;
    compiled = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  }
  return compiled;
}

function budgetIssue(manifest: RunManifest, name: keyof RunManifestBudgets): string | undefined {
  const value = manifest.budgets[name];
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return `budgets.${name} must be a positive number`;
  }
  return undefined;
}

/** Validates a parsed manifest against the frozen schema and the caps the runner relies on. */
export function parseRunManifest(input: unknown): RunManifest {
  const validate = manifestValidator();
  if (!validate(input)) {
    const errors = (validate.errors ?? []).map((error) => {
      const path = error.instancePath.length > 0 ? error.instancePath : "/";
      return `${path}: ${error.message ?? "invalid"}`;
    });
    throw new RunManifestError(errors);
  }
  const manifest = input as RunManifest;
  const issues = [
    budgetIssue(manifest, "maxTotalTokens"),
    budgetIssue(manifest, "maxTotalWallClockMinutes"),
    budgetIssue(manifest, "maxInfrastructureRetriesPerTrial"),
  ].filter((issue): issue is string => issue !== undefined);
  if (!/^[0-9a-f]{40}$/.test(manifest.agentReadyCommit)) {
    issues.push("agentReadyCommit must be a full 40-character commit SHA");
  }
  if (issues.length > 0) throw new RunManifestError(issues);
  return manifest;
}

export async function loadRunManifest(path = DEFAULT_RUN_MANIFEST_PATH): Promise<RunManifest> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new RunManifestError([`cannot read ${path}: ${reason}`]);
  }
  return parseRunManifest(JSON.parse(text) as unknown);
}

/**
 * The manifest pins repository commits, and the frozen protocol pins them too.
 * A run where those disagree would test a different repository state than the
 * published protocol says, so it refuses to start.
 */
export function assertManifestMatchesProtocol(
  manifest: RunManifest,
  repositories: readonly { readonly id: string; readonly commit: string }[],
): void {
  const issues: string[] = [];
  const pinned = new Map(manifest.repositories.map((entry) => [entry.id, entry.commit]));
  for (const repository of repositories) {
    if (pinned.get(repository.id) !== repository.commit) {
      issues.push(
        `repository ${repository.id}: manifest pins ${String(pinned.get(repository.id))}, protocol pins ${repository.commit}`,
      );
    }
  }
  if (pinned.size !== repositories.length) {
    issues.push(
      `manifest lists ${String(pinned.size)} repositories, protocol lists ${String(repositories.length)}`,
    );
  }
  if (issues.length > 0) throw new RunManifestError(issues);
}
