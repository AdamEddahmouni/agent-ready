import type { Diagnostic } from "../diagnostics/types.js";
import type { AdapterName, NormalizedContract } from "../contract/types.js";

/**
 * A single file an adapter renderer produces. `relativePath` is always
 * adapter-hardcoded (e.g. "AGENTS.md"), never contract-supplied.
 */
export interface GeneratedFile {
  readonly relativePath: string;
  readonly content: string;
}

/** Pure function: contract in, rendered file out. No FileSystem access. */
export type AdapterRenderer = (contract: NormalizedContract) => GeneratedFile;

export type RendererRegistry = Partial<Readonly<Record<AdapterName, AdapterRenderer>>>;

/** A single planned output, resolved against `repoRoot` but not yet checked against disk. */
export interface PlanEntry {
  readonly adapter: AdapterName;
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly content: string;
}

/** Result of `planGeneration`: what would be generated, plus any planning-time diagnostics. */
export interface GenerationPlan {
  readonly entries: readonly PlanEntry[];
  readonly diagnostics: readonly Diagnostic[];
}

export type PlannedOutputStatus = "would-write" | "up-to-date" | "unmanaged";

/** A plan entry with its on-disk status resolved (requires reading the file system). */
export interface PlannedOutput extends PlanEntry {
  readonly status: PlannedOutputStatus;
}
