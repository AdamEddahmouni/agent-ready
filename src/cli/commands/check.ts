import { renderDiagnosticsHuman } from "../../diagnostics/humanRender.js";
import { renderDiagnosticsJson } from "../../diagnostics/jsonRender.js";
import { resolveExitCode } from "../../diagnostics/exitCodes.js";
import type { Diagnostic } from "../../diagnostics/types.js";
import type { FileSystem } from "../../filesystem/types.js";
import { loadContract } from "../../contract/pipeline.js";
import { findMatchingPattern } from "../../contract/globMatch.js";
import type { ChangedFile, GitClient, GitDiffBase } from "../../git/types.js";
import { GitClientError } from "../../git/types.js";
import type { CliOutcome } from "./validate.js";

export interface CheckArgs {
  readonly json: boolean;
  readonly config?: string;
  readonly staged: boolean;
  readonly against?: string;
}

export interface ProtectedPathViolation {
  readonly path: string;
  readonly pattern: string;
}

interface FinishContext {
  readonly contractPath?: string;
  readonly repoRoot?: string;
  readonly base?: GitDiffBase;
  readonly changedFiles?: readonly ChangedFile[];
  readonly violations?: readonly ProtectedPathViolation[];
}

/**
 * Checks whether any file matching the contract's `paths.protected`
 * patterns was changed in the given Git diff base. Never executes
 * contract-declared commands and never modifies the repository; `git` is
 * invoked only with Agent-Ready-hardcoded arguments (see ADR-0013).
 */
export async function runCheck(
  fs: FileSystem,
  git: GitClient,
  args: CheckArgs,
  startDir?: string,
): Promise<CliOutcome> {
  const result = await loadContract({
    fs,
    startDir,
    ...(args.config !== undefined && { explicitConfigPath: args.config }),
  });

  if (!result.ok) {
    return finish(args, result.diagnostics);
  }

  const { contract, repoRoot, contractPath } = result.value;
  const diagnostics: Diagnostic[] = [...result.diagnostics];

  const isRepo = await git.isRepository(repoRoot);
  if (!isRepo) {
    diagnostics.push({
      code: "GIT_REPOSITORY_NOT_FOUND",
      severity: "error",
      summary: "The repository root is not inside a Git working tree.",
      detail: `"agent-ready check" compares Git changes, but "${repoRoot}" is not inside a Git working tree.`,
      remediation: "Run inside a Git repository, or initialize one with `git init`.",
    });
    return finish(args, diagnostics, { contractPath, repoRoot });
  }

  const base: GitDiffBase = args.staged
    ? { kind: "staged" }
    : args.against !== undefined
      ? { kind: "ref", ref: args.against }
      : { kind: "working-tree" };

  let changedFiles: readonly ChangedFile[];
  try {
    changedFiles = await git.getChangedFiles(repoRoot, base);
  } catch (error) {
    diagnostics.push({
      code: "GIT_UNAVAILABLE",
      severity: "error",
      summary: "Failed to read changes from Git.",
      detail: error instanceof GitClientError ? error.message : "Unknown Git error.",
      remediation:
        "Ensure `git` is installed and on PATH, and that the given --against ref (if any) exists.",
    });
    return finish(args, diagnostics, { contractPath, repoRoot, base });
  }

  const violations: ProtectedPathViolation[] = [];
  for (const file of changedFiles) {
    const candidates =
      file.previousPath !== undefined ? [file.previousPath, file.path] : [file.path];
    for (const candidate of candidates) {
      const pattern = findMatchingPattern(candidate, contract.paths.protected);
      if (pattern !== undefined) {
        violations.push({ path: candidate, pattern });
        break;
      }
    }
  }

  for (const violation of violations) {
    diagnostics.push({
      code: "PROTECTED_PATH_MODIFIED",
      severity: "error",
      summary: `Protected path was modified: ${violation.path}`,
      detail: `"${violation.path}" matches protected pattern "${violation.pattern}" declared in paths.protected.`,
      sourcePath: violation.path,
      remediation:
        "Revert this change, or update paths.protected in agent-ready.yaml if this file should no longer be protected.",
      metadata: { pattern: violation.pattern },
    });
  }

  return finish(args, diagnostics, { contractPath, repoRoot, base, changedFiles, violations });
}

function finish(
  args: CheckArgs,
  diagnostics: readonly Diagnostic[],
  context: FinishContext = {},
): CliOutcome {
  const exitCode = resolveExitCode(diagnostics);
  const ok = !diagnostics.some((d) => d.severity === "error");

  if (args.json) {
    const body = {
      ok,
      ...(context.contractPath !== undefined && { contractPath: context.contractPath }),
      ...(context.repoRoot !== undefined && { repoRoot: context.repoRoot }),
      ...(context.base !== undefined && { base: context.base }),
      ...(context.changedFiles !== undefined && { changedFiles: context.changedFiles }),
      ...(context.violations !== undefined && { violations: context.violations }),
      diagnostics: renderDiagnosticsJson(diagnostics),
    };
    return { exitCode, stdout: JSON.stringify(body, null, 2) + "\n", stderr: "" };
  }

  if (ok) {
    const lines = ["No protected-path violations found."];
    if (context.repoRoot !== undefined) {
      lines.push(`  repository: ${context.repoRoot}`);
    }
    if (context.changedFiles !== undefined) {
      lines.push(`  changed files checked: ${String(context.changedFiles.length)}`);
    }
    if (diagnostics.length > 0) {
      lines.push("", renderDiagnosticsHuman(diagnostics));
    }
    return { exitCode, stdout: lines.join("\n") + "\n", stderr: "" };
  }

  return { exitCode, stdout: "", stderr: renderDiagnosticsHuman(diagnostics) + "\n" };
}
