import type { DiagnosticResult } from "../diagnostics/types.js";
import { fail, hasErrors, ok } from "../diagnostics/types.js";
import type { FileSystem } from "../filesystem/types.js";
import { FileSystemError } from "../filesystem/types.js";
import type { DiscoveryOptions } from "./discovery.js";
import { discoverRepositoryContext } from "./discovery.js";
import { parseYaml } from "./parseYaml.js";
import { validateSchema } from "./schema.js";
import { validateSemantics } from "./semantic.js";
import { NormalizationError, normalizeContract } from "./normalize.js";
import type { NormalizedContract } from "./types.js";

export interface LoadContractOptions extends DiscoveryOptions {
  readonly fs: FileSystem;
}

export interface LoadedContract {
  readonly contract: NormalizedContract;
  readonly repoRoot: string;
  readonly contractPath: string;
}

/**
 * Runs the full pipeline: discover -> read -> parse -> schema-validate ->
 * semantically validate -> normalize. Never executes repository commands
 * and never writes to the file system.
 */
export async function loadContract(
  options: LoadContractOptions,
): Promise<DiagnosticResult<LoadedContract>> {
  try {
    return await runPipeline(options);
  } catch (error) {
    return fail([
      {
        code: "INTERNAL_INVARIANT_VIOLATION",
        severity: "error",
        summary: "An unexpected internal error occurred.",
        detail: error instanceof Error ? error.message : "Unknown error.",
        remediation: "Please report this as a bug, including the contract that triggered it.",
      },
    ]);
  }
}

async function runPipeline(
  options: LoadContractOptions,
): Promise<DiagnosticResult<LoadedContract>> {
  const { fs, ...discoveryOptions } = options;

  const discovery = await discoverRepositoryContext(fs, discoveryOptions);
  if ("diagnostic" in discovery) {
    return fail([discovery.diagnostic]);
  }
  const { repoRoot, contractPath } = discovery.context;

  let text: string;
  try {
    text = await fs.readTextFile(contractPath);
  } catch (error) {
    return fail([
      {
        code: "CONTRACT_READ_FAILED",
        severity: "error",
        summary: "Failed to read the contract file.",
        detail: error instanceof FileSystemError ? error.message : "Unknown read error.",
        sourcePath: contractPath,
        remediation: "Check file permissions and that the path is a regular, readable file.",
      },
    ]);
  }

  const parseResult = parseYaml(text, contractPath);
  if (!parseResult.ok) {
    return fail(parseResult.diagnostics);
  }

  const schemaResult = validateSchema(
    parseResult.value.value,
    contractPath,
    parseResult.value.locate,
  );
  if (!schemaResult.ok) {
    return fail(schemaResult.diagnostics);
  }

  const semanticDiagnostics = await validateSemantics(schemaResult.value, {
    fs,
    repoRoot,
    sourcePath: contractPath,
  });
  if (hasErrors(semanticDiagnostics)) {
    return fail(semanticDiagnostics);
  }

  let contract: NormalizedContract;
  try {
    contract = normalizeContract(schemaResult.value);
  } catch (error) {
    if (error instanceof NormalizationError) {
      return fail([
        {
          code: "NORMALIZATION_FAILED",
          severity: "error",
          summary: "Failed to normalize the contract.",
          detail: error.message,
          sourcePath: contractPath,
          remediation: "Please report this as a bug in Agent-Ready.",
        },
      ]);
    }
    throw error;
  }

  return ok({ contract, repoRoot, contractPath }, semanticDiagnostics);
}
