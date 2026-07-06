import { loadContract } from "../../contract/pipeline.js";
import { isDiagnosticCode } from "../../diagnostics/codes.js";
import type { DiagnosticCode } from "../../diagnostics/codes.js";
import { ExitCode } from "../../diagnostics/exitCodes.js";
import { resolveExitCode } from "../../diagnostics/exitCodes.js";
import { renderDiagnosticsHuman } from "../../diagnostics/humanRender.js";
import { renderDiagnosticsJson } from "../../diagnostics/jsonRender.js";
import type { DiagnosticJson } from "../../diagnostics/jsonRender.js";
import type { FileSystem } from "../../filesystem/types.js";
import type { CliOutcome } from "./validate.js";
import { EXPLANATION_REGISTRY } from "./explainRegistry.js";
import type { Explanation } from "./explainRegistry.js";

export interface ExplainArgs {
  readonly json: boolean;
  readonly code: string;
  readonly config?: string;
}

/**
 * Given a diagnostic code, prints an extended plain-language explanation
 * with sections for what it means, why it happens, how to fix it, and
 * related codes. Optionally loads a contract via --config for
 * field-specific "Your contract" context.
 *
 * Read-only: never modifies the repository, never executes commands,
 * never invokes Git. See ADR-0024 for the full design rationale.
 */
export async function runExplain(
  fs: FileSystem,
  args: ExplainArgs,
  startDir?: string,
): Promise<CliOutcome> {
  // Validate the --code value.
  if (!isDiagnosticCode(args.code)) {
    const msg = `agent-ready explain: unknown diagnostic code '${args.code}'.\n\n` +
      "Run `agent-ready explain --code <CODE>` with one of the recognized codes.\n" +
      "Use `agent-ready --help` or see docs/specification/diagnostics.md for the full list.";
    return { exitCode: ExitCode.VALIDATION_FAILED, stdout: "", stderr: msg + "\n" };
  }

  const code: DiagnosticCode = args.code;
  const explanation = EXPLANATION_REGISTRY.get(code);

  if (explanation === undefined) {
    // Defensive: every code has a registry entry (enforced by unit test),
    // but if somehow missing, surface as internal error.
    return {
      exitCode: ExitCode.INTERNAL_ERROR,
      stdout: "",
      stderr: `agent-ready explain: internal error — no registry entry for code '${code}'.\n`,
    };
  }

  // Optional contract loading.
  type ContractCtx =
    | { loaded: true; contractPath: string; repoRoot: string; contract: Record<string, unknown>; diagnostics: readonly DiagnosticJson[] }
    | { loaded: false; diagnostics: readonly DiagnosticJson[] }
    | undefined;

  let contractResult: ContractCtx;

  if (args.config !== undefined) {
    const result = await loadContract({
      fs,
      startDir,
      explicitConfigPath: args.config,
    });
    if (result.ok) {
      contractResult = {
        loaded: true,
        contractPath: result.value.contractPath,
        repoRoot: result.value.repoRoot,
        contract: result.value.contract as unknown as Record<string, unknown>,
        diagnostics: renderDiagnosticsJson(result.diagnostics),
      };
    } else {
      contractResult = {
        loaded: false,
        diagnostics: renderDiagnosticsJson(result.diagnostics),
      };
    }
  }

  return render(args, code, explanation, contractResult);
}

type ContractCtx =
  | { loaded: true; contractPath: string; repoRoot: string; contract: Record<string, unknown>; diagnostics: readonly DiagnosticJson[] }
  | { loaded: false; diagnostics: readonly DiagnosticJson[] }
  | undefined;

function render(
  args: ExplainArgs,
  code: DiagnosticCode,
  explanation: Explanation,
  contractResult: ContractCtx,
): CliOutcome {
  if (args.json) {
    return renderJson(args, code, explanation, contractResult);
  }
  return renderHuman(args, code, explanation, contractResult);
}

function renderJson(
  args: ExplainArgs,
  code: DiagnosticCode,
  explanation: Explanation,
  contractResult: ContractCtx,
): CliOutcome {
  const body: Record<string, unknown> = {
    ok: contractResult === undefined || contractResult.loaded,
    code,
    severity: codeToSeverity(code),
    what: explanation.what,
    why: explanation.why,
    fix: explanation.fix,
  };

  if (explanation.related !== undefined && explanation.related.length > 0) {
    body["related"] = explanation.related;
  }

  if (contractResult !== undefined) {
    body["contractPath"] =
      contractResult.loaded ? contractResult.contractPath : args.config;
    if (contractResult.loaded) {
      body["repoRoot"] = contractResult.repoRoot;
      if (explanation.fields !== undefined && explanation.fields.length > 0) {
        body["contractFields"] = resolveContractFields(
          contractResult.contract,
          explanation.fields,
        );
      }
    }
    body["diagnostics"] = contractResult.diagnostics;
  } else {
    body["diagnostics"] = [];
  }

  const exitCode = contractResult !== undefined && !contractResult.loaded
    ? resolveExitCodeForContractFailure(contractResult.diagnostics)
    : ExitCode.SUCCESS;

  return { exitCode, stdout: JSON.stringify(body, null, 2) + "\n", stderr: "" };
}

function renderHuman(
  _args: ExplainArgs,
  code: DiagnosticCode,
  explanation: Explanation,
  contractResult: ContractCtx,
): CliOutcome {
  const lines: string[] = [
    `agent-ready explain ${code}`,
    "",
    "What it means:",
    indent(explanation.what),
    "",
    "Why it happens:",
    indent(explanation.why),
    "",
    "How to fix it:",
    indent(explanation.fix),
  ];

  if (explanation.related !== undefined && explanation.related.length > 0) {
    lines.push("", "Related codes:", `  ${explanation.related.join(", ")}`);
  }

  // Append "Your contract" section when --config given and loaded.
  if (contractResult?.loaded) {
    lines.push(
      "",
      `Your contract (${contractResult.contractPath}):`,
    );
    if (explanation.fields !== undefined && explanation.fields.length > 0) {
      for (const field of explanation.fields) {
        const value = resolvePointerFromContract(contractResult.contract, field);
        if (value === undefined) {
          lines.push(`  ${field}: (not declared)`);
        } else {
          lines.push(`  ${field} = ${formatValue(value)}`);
        }
      }
    } else {
      lines.push("  (this diagnostic has no specific contract-field relationship)");
    }
  }

  const stdout = lines.join("\n") + "\n";
  let stderr = "";

  const exitCode =
    contractResult !== undefined && !contractResult.loaded
      ? resolveExitCodeForContractFailure(contractResult.diagnostics)
      : ExitCode.SUCCESS;

  // When contract load failed, output explanation to stdout + diagnostics to stderr.
  if (contractResult !== undefined && !contractResult.loaded) {
    const diagText = renderDiagnosticsHuman(
      (contractResult.diagnostics as unknown as { code: string }[]) as never,
    );
    stderr = diagText.length > 0 ? diagText + "\n" : "";
  }

  return { exitCode, stdout, stderr };
}

// ── helpers ────────────────────────────────────────────────────────────────

function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

function formatValue(value: unknown): string {
  return JSON.stringify(value);
}

function codeToSeverity(code: DiagnosticCode): "error" | "warning" {
  if (code === "ADAPTER_NOT_YET_IMPLEMENTED" ||
      code === "VERIFICATION_NOT_DECLARED" ||
      code === "RUN_DECLARED_BUT_DOCTOR_UNSUPPORTED") {
    return "warning";
  }
  return "error";
}

interface ContractFieldEntry {
  readonly field: string;
  readonly value: unknown;
}

function resolveContractFields(
  contract: Record<string, unknown>,
  fields: readonly string[],
): ContractFieldEntry[] {
  const result: ContractFieldEntry[] = [];
  for (const pointer of fields) {
    const value = resolvePointerFromContract(contract, pointer);
    result.push({ field: pointer, value });
  }
  return result;
}

/**
 * Naive JSON Pointer resolver against a NormalizedContract (shallow
 * object-tree walk). Supports only root-level keys and one level of
 * nesting (e.g. "/version", "/environment/runtimes", "/paths/protected").
 * Returns undefined when the pointer path doesn't resolve.
 */
function resolvePointerFromContract(
  contract: Record<string, unknown>,
  pointer: string,
): unknown {
  const segments = pointer.split("/").filter((s) => s.length > 0);
  let current: Record<string, unknown> = contract;
  for (const seg of segments) {
    if (!(seg in current)) {
      return undefined;
    }
    const next = current[seg];
    if (next === null || typeof next !== "object" || Array.isArray(next)) {
      return next;
    }
    current = next as Record<string, unknown>;
  }
  return current;
}

function resolveExitCodeForContractFailure(
  diagnostics: readonly DiagnosticJson[],
): ExitCode {
  // resolveExitCode expects Diagnostic[], but DiagnosticJson has the
  // same severity field shape, so the filter works correctly.
  return resolveExitCode(diagnostics as unknown as never);
}
