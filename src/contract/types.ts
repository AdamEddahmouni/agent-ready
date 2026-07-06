/**
 * Public contract shape: the result of parsing YAML and validating it
 * against schemas/v1/agent-ready.schema.json. Field names and structure
 * mirror the schema exactly. This is intentionally distinct from
 * NormalizedContract (see below): the raw contract still reflects
 * whatever ordering and optionality the author wrote, while the
 * normalized contract resolves defaults and deterministic ordering.
 */
export type AdapterName = "agentsMd" | "claude" | "cursor" | "copilot" | "gemini";

export const ADAPTER_NAMES: readonly AdapterName[] = [
  "agentsMd",
  "claude",
  "cursor",
  "copilot",
  "gemini",
];

export interface RawCommand {
  readonly run: string;
  readonly description?: string;
}

export interface RawPackageManager {
  readonly name: "npm" | "pnpm" | "yarn";
  readonly version: string;
}

export interface RawEnvironment {
  readonly runtimes?: Readonly<Record<string, string>>;
  readonly packageManager?: RawPackageManager;
}

export interface RawVerification {
  readonly required: readonly string[];
}

export interface RawPaths {
  readonly protected?: readonly string[];
  readonly generated?: readonly string[];
  readonly ignored?: readonly string[];
}

export interface RawInstructions {
  readonly sources?: readonly string[];
  readonly content?: string;
}

export interface RawAdapterDeclaration {
  readonly enabled: boolean;
}

export interface RawContract {
  readonly version: number;
  readonly project: {
    readonly name: string;
    readonly description?: string;
  };
  readonly environment?: RawEnvironment;
  readonly commands?: Readonly<Record<string, RawCommand>>;
  readonly verification?: RawVerification;
  readonly paths?: RawPaths;
  readonly instructions?: RawInstructions;
  readonly adapters?: Partial<Readonly<Record<AdapterName, RawAdapterDeclaration>>>;
}

/**
 * The currently supported contract version. Any other positive integer is
 * syntactically valid per the JSON Schema but rejected as unsupported
 * during semantic validation (CONTRACT_VERSION_UNSUPPORTED).
 */
export const SUPPORTED_CONTRACT_VERSION = 1;

// --- Normalized domain model -----------------------------------------------

export interface NormalizedCommand {
  readonly name: string;
  readonly run: string;
  readonly description?: string;
}

export interface NormalizedRuntime {
  readonly name: string;
  readonly range: string;
}

export interface NormalizedEnvironment {
  readonly runtimes: readonly NormalizedRuntime[];
  readonly packageManager?: RawPackageManager;
}

export interface NormalizedPaths {
  readonly protected: readonly string[];
  readonly generated: readonly string[];
  readonly ignored: readonly string[];
}

export interface NormalizedAdapter {
  readonly name: AdapterName;
  readonly enabled: boolean;
}

/**
 * Fully validated, defaulted, and deterministically ordered contract.
 * Independent of CLI presentation and of any parser-specific types.
 * Safe to serialize directly for `inspect --json`.
 */
export interface NormalizedContract {
  readonly version: 1;
  readonly project: {
    readonly name: string;
    readonly description?: string;
  };
  readonly environment: NormalizedEnvironment;
  readonly commands: readonly NormalizedCommand[];
  readonly verification: {
    readonly required: readonly string[];
  };
  readonly paths: NormalizedPaths;
  readonly instructions: {
    readonly sources: readonly string[];
    readonly content?: string;
  };
  readonly adapters: readonly NormalizedAdapter[];
}
