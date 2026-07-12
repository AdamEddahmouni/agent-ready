import type { NormalizedContract } from "../contract/types.js";
import type { Diagnostic } from "../diagnostics/types.js";
import type { FileSystem } from "../filesystem/types.js";
import { planGeneration, resolvePlannedOutputs } from "./generate.js";
import type { PlannedOutputStatus } from "./types.js";

export interface GenerateCheckFile {
  readonly adapter: string;
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly status: PlannedOutputStatus;
  readonly content: string;
}
export interface GenerateCheckResult {
  readonly ok: boolean;
  readonly files: readonly GenerateCheckFile[];
  readonly diagnostics: readonly Diagnostic[];
}

/** Shared read-only drift check used by generate --check and verify --check-generate. */
export async function checkGeneratedFiles(
  fs: FileSystem,
  contract: NormalizedContract,
  repoRoot: string,
): Promise<GenerateCheckResult> {
  const plan = planGeneration(contract, repoRoot);
  const outputs = await resolvePlannedOutputs(fs, plan.entries);
  return {
    ok:
      outputs.every((output) => output.status === "up-to-date") &&
      !plan.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    files: outputs.map((output) => ({
      adapter: output.adapter,
      relativePath: output.relativePath,
      absolutePath: output.absolutePath,
      status: output.status,
      content: output.content,
    })),
    diagnostics: plan.diagnostics,
  };
}
