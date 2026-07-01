import { renderDiagnosticsHuman } from "../../diagnostics/humanRender.js";
import { renderDiagnosticsJson } from "../../diagnostics/jsonRender.js";
import { resolveExitCode } from "../../diagnostics/exitCodes.js";
import type { ExitCode } from "../../diagnostics/exitCodes.js";
import type { FileSystem } from "../../filesystem/types.js";
import { loadContract } from "../../contract/pipeline.js";

export interface ValidateArgs {
  readonly json: boolean;
  readonly config?: string;
}

export interface CliOutcome {
  readonly exitCode: ExitCode;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Runs the full validation pipeline. Never executes repository commands
 * and never modifies the repository.
 */
export async function runValidate(
  fs: FileSystem,
  args: ValidateArgs,
  startDir?: string,
): Promise<CliOutcome> {
  const result = await loadContract({
    fs,
    startDir,
    ...(args.config !== undefined && { explicitConfigPath: args.config }),
  });
  const diagnostics = result.diagnostics;
  const exitCode = resolveExitCode(diagnostics);

  if (args.json) {
    const body = result.ok
      ? {
          ok: true,
          contractPath: result.value.contractPath,
          repoRoot: result.value.repoRoot,
          diagnostics: renderDiagnosticsJson(diagnostics),
        }
      : { ok: false, diagnostics: renderDiagnosticsJson(diagnostics) };
    return { exitCode, stdout: JSON.stringify(body, null, 2) + "\n", stderr: "" };
  }

  if (result.ok) {
    const lines = [
      `Contract is valid: ${result.value.contractPath}`,
      `  project: ${result.value.contract.project.name}`,
      `  commands declared: ${String(result.value.contract.commands.length)}`,
      `  verification steps: ${String(result.value.contract.verification.required.length)}`,
    ];
    if (diagnostics.length > 0) {
      lines.push("", renderDiagnosticsHuman(diagnostics));
    }
    return { exitCode, stdout: lines.join("\n") + "\n", stderr: "" };
  }

  return { exitCode, stdout: "", stderr: renderDiagnosticsHuman(diagnostics) + "\n" };
}
