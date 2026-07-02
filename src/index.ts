/**
 * Public programmatic API for Agent-Ready.
 *
 * Stability: pre-1.0. Everything exported here is public but
 * experimental; shapes may change between minor versions until 1.0,
 * with changes documented in CHANGELOG.md. Anything not exported from
 * this entry point (e.g. ajv internals, CLI argument parsing) is
 * internal and carries no compatibility guarantee at all.
 */

// Contract pipeline
export { loadContract } from "./contract/pipeline.js";
export type { LoadContractOptions, LoadedContract } from "./contract/pipeline.js";

export { parseYaml, MAX_CONTRACT_BYTES } from "./contract/parseYaml.js";
export type { ParsedContractSource } from "./contract/parseYaml.js";

export { validateSchema, AGENT_READY_SCHEMA } from "./contract/schema.js";

export { validateSemantics } from "./contract/semantic.js";
export type { SemanticContext } from "./contract/semantic.js";

export { normalizeContract, NormalizationError } from "./contract/normalize.js";

export { normalizePathPattern } from "./contract/paths.js";
export type { PathValidationOptions } from "./contract/paths.js";

export { discoverRepositoryContext, CANONICAL_CONTRACT_FILENAME } from "./contract/discovery.js";
export type { DiscoveryOptions, RepositoryContext } from "./contract/discovery.js";

export { SUPPORTED_CONTRACT_VERSION, ADAPTER_NAMES } from "./contract/types.js";
export type {
  RawContract,
  RawCommand,
  RawEnvironment,
  RawPackageManager,
  RawVerification,
  RawPaths,
  RawInstructions,
  RawAdapterDeclaration,
  AdapterName,
  NormalizedContract,
  NormalizedCommand,
  NormalizedRuntime,
  NormalizedEnvironment,
  NormalizedPaths,
  NormalizedAdapter,
} from "./contract/types.js";

// Diagnostics
export { DIAGNOSTIC_CODES, isDiagnosticCode } from "./diagnostics/codes.js";
export type { DiagnosticCode } from "./diagnostics/codes.js";
export { ok, fail, hasErrors } from "./diagnostics/types.js";
export type {
  Diagnostic,
  DiagnosticResult,
  Severity,
  SourceLocation,
} from "./diagnostics/types.js";
export { renderDiagnosticsHuman } from "./diagnostics/humanRender.js";
export { renderDiagnosticsJson } from "./diagnostics/jsonRender.js";
export type { DiagnosticJson } from "./diagnostics/jsonRender.js";
export { ExitCode, resolveExitCode } from "./diagnostics/exitCodes.js";

// File-system boundary
export { NodeFileSystem } from "./filesystem/nodeFileSystem.js";
export { InMemoryFileSystem } from "./filesystem/inMemoryFileSystem.js";
export { FileSystemError } from "./filesystem/types.js";
export type { FileStat, FileSystem } from "./filesystem/types.js";

// Agent-instruction generation
export { planGeneration, resolvePlannedOutputs } from "./generate/generate.js";
export { renderAgentsMd } from "./generate/adapters/agentsMd.js";
export { renderClaude } from "./generate/adapters/claude.js";
export { renderCursor } from "./generate/adapters/cursor.js";
export { renderCopilot } from "./generate/adapters/copilot.js";
export { renderGemini } from "./generate/adapters/gemini.js";
export { GENERATED_FILE_MARKER, hasManagedMarker } from "./generate/marker.js";
export type {
  GeneratedFile,
  AdapterRenderer,
  RendererRegistry,
  PlanEntry,
  GenerationPlan,
  PlannedOutputStatus,
  PlannedOutput,
} from "./generate/types.js";
