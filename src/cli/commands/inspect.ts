import { renderDiagnosticsHuman } from "../../diagnostics/humanRender.js";
import { renderDiagnosticsJson } from "../../diagnostics/jsonRender.js";
import { resolveExitCode } from "../../diagnostics/exitCodes.js";
import type { FileSystem } from "../../filesystem/types.js";
import { loadContract } from "../../contract/pipeline.js";
import type { NormalizedContract } from "../../contract/types.js";
import type { CliOutcome, ValidateArgs } from "./validate.js";

export type InspectArgs = ValidateArgs;

function renderHuman(contract: NormalizedContract): string {
  const lines: string[] = [];
  lines.push(`Project: ${contract.project.name}`);
  if (contract.project.description !== undefined) {
    lines.push(`  ${contract.project.description}`);
  }

  lines.push("", "Environment:");
  if (
    contract.environment.runtimes.length === 0 &&
    contract.environment.packageManager === undefined
  ) {
    lines.push("  (none declared)");
  }
  for (const runtime of contract.environment.runtimes) {
    lines.push(`  runtime ${runtime.name}: ${runtime.range}`);
  }
  if (contract.environment.packageManager !== undefined) {
    lines.push(
      `  package manager: ${contract.environment.packageManager.name}@${contract.environment.packageManager.version}`,
    );
  }

  lines.push("", "Commands:");
  if (contract.commands.length === 0) {
    lines.push("  (none declared)");
  }
  for (const command of contract.commands) {
    lines.push(`  ${command.name}: ${command.run}`);
  }

  lines.push("", "Verification:");
  lines.push(
    `  required: ${contract.verification.required.length > 0 ? contract.verification.required.join(", ") : "(none)"}`,
  );

  lines.push("", "Paths:");
  lines.push(
    `  protected: ${contract.paths.protected.length > 0 ? contract.paths.protected.join(", ") : "(none)"}`,
  );
  lines.push(
    `  generated: ${contract.paths.generated.length > 0 ? contract.paths.generated.join(", ") : "(none)"}`,
  );
  lines.push(
    `  ignored: ${contract.paths.ignored.length > 0 ? contract.paths.ignored.join(", ") : "(none)"}`,
  );

  lines.push("", "Instruction sources:");
  lines.push(
    `  ${contract.instructions.sources.length > 0 ? contract.instructions.sources.join(", ") : "(none)"}`,
  );

  lines.push("", "Adapters:");
  if (contract.adapters.length === 0) {
    lines.push("  (none declared)");
  }
  for (const adapter of contract.adapters) {
    lines.push(`  ${adapter.name}: ${adapter.enabled ? "enabled" : "disabled"}`);
  }

  return lines.join("\n") + "\n";
}

/**
 * Prints the fully normalized contract. Never executes repository
 * commands and never modifies the repository.
 */
export async function runInspect(
  fs: FileSystem,
  args: InspectArgs,
  startDir?: string,
): Promise<CliOutcome> {
  const result = await loadContract({
    fs,
    startDir,
    ...(args.config !== undefined && { explicitConfigPath: args.config }),
  });
  const exitCode = resolveExitCode(result.diagnostics);

  if (!result.ok) {
    const body = args.json
      ? JSON.stringify(
          { ok: false, diagnostics: renderDiagnosticsJson(result.diagnostics) },
          null,
          2,
        ) + "\n"
      : renderDiagnosticsHuman(result.diagnostics) + "\n";
    return { exitCode, stdout: "", stderr: body };
  }

  if (args.json) {
    const body = {
      ok: true,
      repoRoot: result.value.repoRoot,
      contractPath: result.value.contractPath,
      contract: result.value.contract,
    };
    return { exitCode, stdout: JSON.stringify(body, null, 2) + "\n", stderr: "" };
  }

  return { exitCode, stdout: renderHuman(result.value.contract), stderr: "" };
}
