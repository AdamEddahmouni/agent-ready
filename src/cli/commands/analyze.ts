import { analyzeDocumentation } from "../../analyze/analyzeDocumentation.js";
import { loadContract } from "../../contract/pipeline.js";
import { resolveExitCode } from "../../diagnostics/exitCodes.js";
import { renderDiagnosticsHuman } from "../../diagnostics/humanRender.js";
import { renderDiagnosticsJson } from "../../diagnostics/jsonRender.js";
import type { Diagnostic } from "../../diagnostics/types.js";
import type { FileSystem } from "../../filesystem/types.js";
import type { CliOutcome } from "./validate.js";

export interface AnalyzeArgs {
  readonly json: boolean;
  readonly config?: string;
}

/**
 * Checks declared instruction sources for deterministic documentation drift.
 * Never writes files, invokes Git, or executes contract-declared commands.
 */
export async function runAnalyze(
  fs: FileSystem,
  args: AnalyzeArgs,
  startDir?: string,
): Promise<CliOutcome> {
  const result = await loadContract({
    fs,
    startDir,
    ...(args.config !== undefined && { explicitConfigPath: args.config }),
  });
  if (!result.ok) return finish(args, result.diagnostics);

  const { contract, contractPath, repoRoot } = result.value;
  const analysis = await analyzeDocumentation(fs, repoRoot, contract.instructions.sources);
  const diagnostics: Diagnostic[] = [...result.diagnostics, ...analysis.diagnostics];
  return finish(args, diagnostics, {
    contractPath,
    repoRoot,
    sources: analysis.sources,
    linksChecked: analysis.linksChecked,
    findings: analysis.findings,
  });
}

interface AnalyzeContext {
  readonly contractPath?: string;
  readonly repoRoot?: string;
  readonly sources?: readonly { path: string; linksChecked: number }[];
  readonly linksChecked?: number;
  readonly findings?: readonly {
    kind: "broken" | "outside-repository";
    sourcePath: string;
    destination: string;
    resolvedPath?: string;
    line: number;
    column: number;
  }[];
}

function finish(
  args: AnalyzeArgs,
  diagnostics: readonly Diagnostic[],
  context: AnalyzeContext = {},
): CliOutcome {
  const exitCode = resolveExitCode(diagnostics);
  const ok = !diagnostics.some((diagnostic) => diagnostic.severity === "error");

  if (args.json) {
    return {
      exitCode,
      stdout:
        JSON.stringify(
          {
            ok,
            ...(context.contractPath !== undefined && { contractPath: context.contractPath }),
            ...(context.repoRoot !== undefined && { repoRoot: context.repoRoot }),
            ...(context.sources !== undefined && { sources: context.sources }),
            ...(context.linksChecked !== undefined && { linksChecked: context.linksChecked }),
            ...(context.findings !== undefined && { findings: context.findings }),
            diagnostics: renderDiagnosticsJson(diagnostics),
          },
          null,
          2,
        ) + "\n",
      stderr: "",
    };
  }

  if (ok) {
    const lines = [
      "No documentation drift found.",
      `  instruction sources checked: ${String(context.sources?.length ?? 0)}`,
      `  local links checked: ${String(context.linksChecked ?? 0)}`,
    ];
    if (diagnostics.length > 0) lines.push("", renderDiagnosticsHuman(diagnostics));
    return { exitCode, stdout: lines.join("\n") + "\n", stderr: "" };
  }

  return { exitCode, stdout: "", stderr: renderDiagnosticsHuman(diagnostics) + "\n" };
}
