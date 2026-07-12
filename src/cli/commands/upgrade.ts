import { loadContract } from "../../contract/pipeline.js";
import { parseYaml } from "../../contract/parseYaml.js";
import { validateSchema } from "../../contract/schema.js";
import { validateSemantics } from "../../contract/semantic.js";
import type { RawContract } from "../../contract/types.js";
import { renderDiagnosticsHuman } from "../../diagnostics/humanRender.js";
import { renderDiagnosticsJson } from "../../diagnostics/jsonRender.js";
import { ExitCode, resolveExitCode } from "../../diagnostics/exitCodes.js";
import { hasErrors } from "../../diagnostics/types.js";
import type { Diagnostic } from "../../diagnostics/types.js";
import type { FileSystem } from "../../filesystem/types.js";
import { FileSystemError } from "../../filesystem/types.js";
import { planUpgrade } from "../../upgrade/upgrade.js";
import type { CliOutcome } from "./validate.js";

export interface UpgradeArgs {
  readonly json: boolean;
  readonly write: boolean;
  readonly config?: string;
}

type UpgradeMode = "dry-run" | "write";

/** Plans or applies conservative, additive improvements to a valid contract. */
export async function runUpgrade(
  fs: FileSystem,
  args: UpgradeArgs,
  startDir?: string,
): Promise<CliOutcome> {
  const mode: UpgradeMode = args.write ? "write" : "dry-run";
  const loaded = await loadContract({
    fs,
    startDir,
    ...(args.config !== undefined && { explicitConfigPath: args.config }),
  });
  if (!loaded.ok) return renderFailure(args.json, loaded.diagnostics);

  const { contractPath, repoRoot } = loaded.value;
  let originalText: string;
  try {
    originalText = await fs.readTextFile(contractPath);
  } catch (error) {
    return renderFailure(args.json, [
      {
        code: "CONTRACT_READ_FAILED",
        severity: "error",
        summary: "Failed to re-read the contract while planning an upgrade.",
        detail: error instanceof FileSystemError ? error.message : "Unknown read error.",
        sourcePath: contractPath,
        remediation: "Check file permissions and retry the upgrade.",
      },
    ]);
  }

  const parsed = parseYaml(originalText, contractPath);
  if (!parsed.ok) return renderFailure(args.json, parsed.diagnostics);
  const rawContract = parsed.value.value as RawContract;
  const plan = await planUpgrade(fs, repoRoot, contractPath, originalText, rawContract);
  const diagnostics: Diagnostic[] = [...loaded.diagnostics, ...plan.diagnostics];

  if (plan.changes.length === 0) {
    diagnostics.push({
      code: "UPGRADE_NO_CHANGES_NEEDED",
      severity: "warning",
      summary: "The contract already includes every safe v0.4 recommendation.",
      detail: "No automatic additions or value updates were planned.",
      sourcePath: contractPath,
      remediation: "No action is required. Review any separate manual-review warnings.",
    });
  }

  let written = false;
  if (args.write && plan.changes.length > 0) {
    const proposedDiagnostics = await validateProposedContract(
      fs,
      repoRoot,
      contractPath,
      plan.proposedText,
    );
    if (hasErrors(proposedDiagnostics)) {
      diagnostics.push({
        code: "INTERNAL_INVARIANT_VIOLATION",
        severity: "error",
        summary: "The planned upgrade did not produce a valid contract.",
        detail: "Agent-Ready refused to write the proposed contract.",
        sourcePath: contractPath,
        remediation: "Please report this as an Agent-Ready bug.",
        related: proposedDiagnostics,
      });
    } else {
      try {
        await fs.writeTextFile(contractPath, plan.proposedText, { allowedRoot: repoRoot });
        written = true;
      } catch (error) {
        diagnostics.push({
          code: "UPGRADE_WRITE_FAILED",
          severity: "error",
          summary: "Failed to write the upgraded contract.",
          detail: error instanceof FileSystemError ? error.message : "Unknown write error.",
          sourcePath: contractPath,
          remediation: "Check file permissions and available disk space, then retry.",
        });
      }
    }
  }

  const exitCode = resolveExitCode(diagnostics);
  if (args.json) {
    const body = {
      ok: exitCode === ExitCode.SUCCESS,
      contractPath,
      repoRoot,
      mode,
      written,
      changes: plan.changes,
      diff: plan.diff,
      diagnostics: renderDiagnosticsJson(diagnostics),
    };
    return { exitCode, stdout: JSON.stringify(body, null, 2) + "\n", stderr: "" };
  }

  const lines = [`Upgrade (${mode}) - contract: ${contractPath}`, ""];
  if (plan.changes.length === 0) {
    lines.push("  No automatic changes proposed.");
  } else {
    for (const change of plan.changes) lines.push(`  ${change.field}: ${change.summary}`);
    lines.push("", plan.diff.trimEnd());
    lines.push(
      "",
      written
        ? "Upgraded agent-ready.yaml successfully."
        : "Dry run only. Re-run with --write to apply these changes.",
    );
  }
  if (diagnostics.length > 0) lines.push("", renderDiagnosticsHuman(diagnostics));
  return { exitCode, stdout: lines.join("\n") + "\n", stderr: "" };
}

async function validateProposedContract(
  fs: FileSystem,
  repoRoot: string,
  contractPath: string,
  text: string,
): Promise<readonly Diagnostic[]> {
  const parsed = parseYaml(text, contractPath);
  if (!parsed.ok) return parsed.diagnostics;
  const schema = validateSchema(parsed.value.value, contractPath, parsed.value.locate);
  if (!schema.ok) return schema.diagnostics;
  return validateSemantics(schema.value, { fs, repoRoot, sourcePath: contractPath });
}

function renderFailure(json: boolean, diagnostics: readonly Diagnostic[]): CliOutcome {
  const exitCode = resolveExitCode(diagnostics);
  if (json) {
    return {
      exitCode,
      stdout:
        JSON.stringify({ ok: false, diagnostics: renderDiagnosticsJson(diagnostics) }, null, 2) +
        "\n",
      stderr: "",
    };
  }
  return { exitCode, stdout: "", stderr: renderDiagnosticsHuman(diagnostics) + "\n" };
}
