import { resolve } from "node:path";
import { parseYaml } from "../../contract/parseYaml.js";
import { validateSchema } from "../../contract/schema.js";
import { validateSemantics } from "../../contract/semantic.js";
import { normalizeContract, NormalizationError } from "../../contract/normalize.js";
import { hasErrors } from "../../diagnostics/types.js";
import type { Diagnostic } from "../../diagnostics/types.js";
import { renderDiagnosticsHuman } from "../../diagnostics/humanRender.js";
import { renderDiagnosticsJson } from "../../diagnostics/jsonRender.js";
import { ExitCode, resolveExitCode } from "../../diagnostics/exitCodes.js";
import type { FileSystem } from "../../filesystem/types.js";
import { FileSystemError } from "../../filesystem/types.js";
import { dirnamePath, joinPath } from "../../filesystem/pathJoin.js";
import { CANONICAL_CONTRACT_FILENAME } from "../../contract/discovery.js";
import { ADAPTER_NAMES } from "../../contract/types.js";
import type { CliOutcome } from "./validate.js";
import {
  detectAll,
  detectNodeRangeFromHintFiles,
  detectPackageManagerFromLockFiles,
} from "./initDetect.js";
import type { InitDetection } from "./initDetect.js";

export interface InitArgs {
  readonly json: boolean;
  readonly write: boolean;
}

type InitMode = "dry-run" | "write";

// ── Repo-root discovery (walks up for .git, falls back to cwd) ────────────

const MAX_ANCESTOR_DEPTH = 64;

async function discoverRepoRoot(fs: FileSystem, startDir?: string): Promise<string> {
  const cwd = startDir !== undefined ? resolve(fs.cwd, startDir) : fs.cwd;
  let currentDir = cwd;
  let previousDir: string | undefined;
  let depth = 0;

  while (previousDir !== currentDir && depth < MAX_ANCESTOR_DEPTH) {
    const gitStat = await fs.stat(joinPath(currentDir, ".git"));
    if (gitStat !== undefined) {
      return currentDir;
    }
    previousDir = currentDir;
    currentDir = dirnamePath(currentDir);
    depth++;
  }

  return cwd;
}

// ── Main entry point ───────────────────────────────────────────────────────

/**
 * Scaffolds a starter `agent-ready.yaml` from repository inspection.
 * Defaults to a dry run — nothing is written unless `--write` is passed.
 * Never overwrites an existing contract file. Always validates the
 * generated contract before writing.
 *
 * See ADR-0025 for the full design rationale.
 */
export async function runInit(
  fs: FileSystem,
  args: InitArgs,
  startDir?: string,
): Promise<CliOutcome> {
  const mode: InitMode = args.write ? "write" : "dry-run";

  // 1. Discover repo root.
  const repoRoot = await discoverRepoRoot(fs, startDir);

  // 2. Refuse if agent-ready.yaml already exists.
  const contractPath = joinPath(repoRoot, CANONICAL_CONTRACT_FILENAME);
  const existingStat = await fs.stat(contractPath);
  if (existingStat?.isFile) {
    return rejectContractExists(args, mode, contractPath, repoRoot);
  }

  // 3. Run detection.
  const detection = await detectAll(fs, repoRoot);

  // 4. Second-pass detection: hint files and lock files (async checks).
  const enriched = await enrichDetection(fs, repoRoot, detection);

  // 5. Generate YAML.
  const yaml = generateYaml(enriched);

  // 6. Validate the generated YAML.
  const validationDiags = await validateGeneratedYaml(yaml, fs, repoRoot, contractPath);

  // 7. Render output.
  if (mode === "write") {
    return doWrite(args, fs, repoRoot, contractPath, enriched, yaml, validationDiags);
  }
  return renderDryRun(args, repoRoot, enriched, yaml, validationDiags);
}

// ── Enrich detection with async second-pass checks ──────────────────────────

async function enrichDetection(
  fs: FileSystem,
  repoRoot: string,
  detection: InitDetection,
): Promise<InitDetection> {
  let enriched = detection;

  if (enriched.nodeRange === undefined) {
    const hintResult = await detectNodeRangeFromHintFiles(fs, repoRoot);
    if (hintResult.range !== undefined) {
      enriched = { ...enriched, nodeRange: hintResult.range, nodeRangeSource: hintResult.source };
    }
  }

  if (enriched.packageManager === undefined) {
    const lockResult = await detectPackageManagerFromLockFiles(fs, repoRoot);
    if (lockResult !== undefined) {
      enriched = {
        ...enriched,
        packageManager: { name: lockResult.name, version: lockResult.version },
        packageManagerSource: lockResult.source,
      };
    }
  }

  return enriched;
}

// ── Contract-exists rejection ──────────────────────────────────────────────

function rejectContractExists(
  args: InitArgs,
  mode: InitMode,
  contractPath: string,
  repoRoot: string,
): CliOutcome {
  const diagnostic: Diagnostic = {
    code: "INIT_CONTRACT_EXISTS",
    severity: "error",
    summary: "agent-ready.yaml already exists at the repository root.",
    detail: `${contractPath} already exists. init never overwrites an existing contract.`,
    sourcePath: contractPath,
    remediation:
      "Remove or rename the existing agent-ready.yaml, then re-run agent-ready init --write.",
  };

  if (args.json) {
    const body = {
      ok: false,
      repoRoot,
      mode,
      contractPath,
      diagnostics: renderDiagnosticsJson([diagnostic]),
    };
    return {
      exitCode: ExitCode.VALIDATION_FAILED,
      stdout: JSON.stringify(body, null, 2) + "\n",
      stderr: "",
    };
  }

  return {
    exitCode: ExitCode.VALIDATION_FAILED,
    stdout: "",
    stderr: `agent-ready init: ${diagnostic.summary}\n  ${diagnostic.remediation}\n`,
  };
}

// ── YAML generation ────────────────────────────────────────────────────────

function generateYaml(detection: InitDetection): string {
  const lines: string[] = [];

  const today = new Date().toISOString().slice(0, 10);
  lines.push(`# Generated by agent-ready init on ${today}.`);
  lines.push("# Review each section before your first agent-ready validate.");
  lines.push("# Detection summary:");
  lines.push(
    `#   - project.name: from ${detection.projectNameSource}${detection.projectNameSanitized ? " (sanitized)" : ""}`,
  );
  if (detection.projectDescription !== undefined) {
    lines.push('#   - project.description: from package.json "description"');
  }
  if (detection.nodeRange !== undefined) {
    lines.push(`#   - environment.runtimes.node: from ${detection.nodeRangeSource ?? "detection"}`);
  }
  if (detection.packageManager !== undefined) {
    lines.push(
      `#   - environment.packageManager: from ${detection.packageManagerSource ?? "detection"} (${detection.packageManager.name}@${detection.packageManager.version})`,
    );
  }
  if (Object.keys(detection.detectedScripts).length > 0) {
    lines.push(
      `#   - commands: from package.json scripts (well-known subset: ${Object.keys(detection.detectedScripts).join(", ")})`,
    );
  }
  if (detection.skippedScripts.length > 0) {
    lines.push(`#   - Skipped scripts: ${detection.skippedScripts.join(", ")}`);
  }
  if (detection.verificationScripts.length > 0) {
    lines.push(
      `#   - verification.required: ${detection.verificationScripts.join(" → ")}`,
    );
  }
  if (detection.docSources.length > 0) {
    lines.push(`#   - instructions.sources: existing ${detection.docSources.join(", ")}`);
  }
  if (detection.ignoredPatterns.length > 0) {
    lines.push(
      `#   - paths.ignored: from .gitignore (supported subset: ${detection.ignoredPatterns.join(", ")})`,
    );
  }
  if (detection.skippedGitignorePatterns.length > 0) {
    lines.push(
      `#   - Skipped .gitignore patterns: ${detection.skippedGitignorePatterns.join(", ")}`,
    );
  }
  if (detection.hasEnvInGitignore) {
    lines.push("#   - paths.protected: .env* in .gitignore → suggested");
  }
  lines.push("#   - adapters: all 5 enabled (opt-out)");
  lines.push("");

  // Contract body.
  lines.push("version: 1");
  lines.push("");
  lines.push("project:");
  lines.push(`  name: ${yamlString(detection.projectName)}`);
  if (detection.projectDescription !== undefined) {
    lines.push(`  description: ${yamlString(detection.projectDescription)}`);
  }
  lines.push("");

  const hasEnv = detection.nodeRange !== undefined || detection.packageManager !== undefined;
  if (hasEnv) {
    lines.push("environment:");
    if (detection.nodeRange !== undefined) {
      lines.push("  runtimes:");
      lines.push(`    node: ${yamlString(detection.nodeRange)}`);
    }
    if (detection.packageManager !== undefined) {
      lines.push("  packageManager:");
      lines.push(`    name: ${detection.packageManager.name}`);
      lines.push(`    version: ${yamlString(detection.packageManager.version)}`);
    }
    lines.push("");
  }

  const scriptEntries = Object.entries(detection.detectedScripts);
  if (scriptEntries.length > 0) {
    lines.push("commands:");
    for (const [name, run] of scriptEntries) {
      lines.push(`  ${name}:`);
      lines.push(`    run: ${yamlString(run)}`);
    }
    lines.push("");
  }

  if (detection.verificationScripts.length > 0) {
    lines.push("verification:");
    lines.push("  required:");
    for (const name of detection.verificationScripts) {
      lines.push(`    - ${name}`);
    }
    lines.push("");
  }

  const hasPaths = detection.ignoredPatterns.length > 0 || detection.hasEnvInGitignore;
  if (hasPaths) {
    lines.push("paths:");
    if (detection.hasEnvInGitignore) {
      lines.push("  protected:");
      lines.push('    - ".env*"');
    }
    if (detection.ignoredPatterns.length > 0) {
      lines.push("  ignored:");
      for (const pattern of detection.ignoredPatterns) {
        lines.push(`    - ${yamlString(pattern)}`);
      }
    }
    lines.push("");
  }

  if (detection.docSources.length > 0) {
    lines.push("instructions:");
    lines.push("  sources:");
    for (const source of detection.docSources) {
      lines.push(`    - ${yamlString(source)}`);
    }
    lines.push("");
  }

  lines.push("adapters:");
  for (const adapter of ADAPTER_NAMES) {
    lines.push(`  ${adapter}:`);
    lines.push("    enabled: true");
  }
  lines.push("");

  return lines.join("\n");
}

/**
 * Quote a string for YAML when necessary. If the string contains
 * characters that are significant in YAML, wrap in double quotes.
 * Otherwise return the string as-is.
 */
function yamlString(value: string): string {
  if (value.length === 0) return '""';

  const needsQuoting =
    /[:#"'&*!|>%@`{},[\]\n\r\t]/.test(value) ||
    value.startsWith(" ") ||
    value.endsWith(" ") ||
    value === "true" ||
    value === "false" ||
    value === "null" ||
    value === "yes" ||
    value === "no" ||
    value === "on" ||
    value === "off" ||
    /^\d/.test(value) ||
    value.startsWith("- ") ||
    value === "-";

  if (needsQuoting) {
    const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `"${escaped}"`;
  }

  return value;
}

// ── Validation ─────────────────────────────────────────────────────────────

async function validateGeneratedYaml(
  yaml: string,
  fs: FileSystem,
  repoRoot: string,
  contractPath: string,
): Promise<Diagnostic[]> {
  const parseResult = parseYaml(yaml, contractPath);
  if (!parseResult.ok) {
    return [...parseResult.diagnostics];
  }

  const schemaResult = validateSchema(
    parseResult.value.value,
    contractPath,
    parseResult.value.locate,
  );
  if (!schemaResult.ok) {
    return [...schemaResult.diagnostics];
  }

  const semanticDiags = await validateSemantics(schemaResult.value, {
    fs,
    repoRoot,
    sourcePath: contractPath,
  });
  if (hasErrors(semanticDiags)) {
    return semanticDiags;
  }

  try {
    normalizeContract(schemaResult.value);
  } catch (error) {
    if (error instanceof NormalizationError) {
      return [
        {
          code: "NORMALIZATION_FAILED",
          severity: "error",
          summary: "Failed to normalize the generated contract.",
          detail: error.message,
          sourcePath: contractPath,
          remediation: "Please report this as a bug in Agent-Ready.",
        },
      ];
    }
    throw error;
  }

  return [...semanticDiags];
}

// ── Rendering: shared detection summary ────────────────────────────────────

function appendDetectionSummary(lines: string[], detection: InitDetection): void {
  lines.push("Detected:");
  lines.push(
    `  project name: ${detection.projectName} (from ${detection.projectNameSource})${detection.projectNameSanitized ? " [sanitized]" : ""}`,
  );
  if (detection.packageManager !== undefined) {
    lines.push(
      `  package manager: ${detection.packageManager.name} (from ${detection.packageManagerSource})`,
    );
  }
  if (detection.nodeRange !== undefined) {
    lines.push(`  Node range: ${detection.nodeRange} (from ${detection.nodeRangeSource})`);
  }
  const included = Object.keys(detection.detectedScripts);
  const skipped = detection.skippedScripts;
  if (included.length > 0 || skipped.length > 0) {
    lines.push(
      `  scripts: ${included.join(", ") || "(none)"} (${included.length} included; ${skipped.length} skipped${skipped.length > 0 ? ": " + skipped.join(", ") : ""})`,
    );
  }
  if (detection.verificationScripts.length > 0) {
    lines.push(`  verification order: ${detection.verificationScripts.join(" → ")}`);
  }
  if (detection.docSources.length > 0) {
    lines.push(`  doc sources: ${detection.docSources.join(", ")}`);
  }
  if (detection.ignoredPatterns.length > 0 || detection.skippedGitignorePatterns.length > 0) {
    lines.push(
      `  .gitignore patterns: ${detection.ignoredPatterns.join(", ") || "(none)"} (${detection.ignoredPatterns.length} included; ${detection.skippedGitignorePatterns.length} skipped)`,
    );
  }
  lines.push("  adapters: all 5 enabled (agentsMd, claude, cursor, copilot, gemini)");
}

// ── Rendering (dry-run) ────────────────────────────────────────────────────

function renderDryRun(
  args: InitArgs,
  repoRoot: string,
  detection: InitDetection,
  yaml: string,
  validationDiags: Diagnostic[],
): CliOutcome {
  const validationPassed = !hasErrors(validationDiags);

  if (args.json) {
    const body = {
      ok: true,
      repoRoot,
      mode: "dry-run" as const,
      detection: detectionToJson(detection),
      contract: yaml,
      validationPassed,
      diagnostics: renderDiagnosticsJson(validationDiags),
    };
    return {
      exitCode: ExitCode.SUCCESS,
      stdout: JSON.stringify(body, null, 2) + "\n",
      stderr: "",
    };
  }

  const lines: string[] = [`agent-ready init - repoRoot: ${repoRoot}`, ""];
  appendDetectionSummary(lines, detection);

  lines.push("");
  lines.push("--- proposed agent-ready.yaml ----------------------------------------");
  lines.push(yaml.trimEnd());
  lines.push("---");

  if (validationPassed) {
    lines.push("Validation: would pass agent-ready validate.");
  } else {
    lines.push("Validation: would FAIL agent-ready validate.");
    const diagText = renderDiagnosticsHuman(validationDiags);
    if (diagText.length > 0) lines.push(diagText);
  }

  lines.push(
    "Run `agent-ready init --write` to create this file at",
    `  ${joinPath(repoRoot, CANONICAL_CONTRACT_FILENAME)}`,
  );

  return { exitCode: ExitCode.SUCCESS, stdout: lines.join("\n") + "\n", stderr: "" };
}

// ── Rendering (write) ──────────────────────────────────────────────────────

async function doWrite(
  args: InitArgs,
  fs: FileSystem,
  repoRoot: string,
  contractPath: string,
  detection: InitDetection,
  yaml: string,
  validationDiags: Diagnostic[],
): Promise<CliOutcome> {
  // Never write an invalid contract.
  if (hasErrors(validationDiags)) {
    return renderWriteValidationFailed(args, repoRoot, contractPath, yaml, validationDiags);
  }

  try {
    await fs.writeTextFile(contractPath, yaml);
  } catch (error) {
    const diag: Diagnostic = {
      code: "INTERNAL_INVARIANT_VIOLATION",
      severity: "error",
      summary: "Failed to write agent-ready.yaml.",
      detail: error instanceof FileSystemError ? error.message : "Unknown write error.",
      sourcePath: contractPath,
      remediation: "Check file permissions and available disk space.",
    };
    if (args.json) {
      const body = {
        ok: false,
        repoRoot,
        mode: "write" as const,
        contractPath,
        diagnostics: renderDiagnosticsJson([diag]),
      };
      return {
        exitCode: ExitCode.INTERNAL_ERROR,
        stdout: JSON.stringify(body, null, 2) + "\n",
        stderr: "",
      };
    }
    return {
      exitCode: ExitCode.INTERNAL_ERROR,
      stdout: "",
      stderr: `agent-ready init: ${diag.summary}\n  ${diag.detail}\n`,
    };
  }

  if (args.json) {
    const body = {
      ok: true,
      repoRoot,
      mode: "write" as const,
      contractPath,
      detection: detectionToJson(detection),
      validationPassed: true,
      diagnostics: renderDiagnosticsJson(validationDiags),
    };
    return {
      exitCode: ExitCode.SUCCESS,
      stdout: JSON.stringify(body, null, 2) + "\n",
      stderr: "",
    };
  }

  const lines: string[] = [`agent-ready init - repoRoot: ${repoRoot}`, ""];
  appendDetectionSummary(lines, detection);
  lines.push("");
  lines.push(
    `Wrote agent-ready.yaml (${Object.keys(detection.detectedScripts).length} commands, ${detection.verificationScripts.length} verification steps).`,
  );
  lines.push("Next steps:");
  lines.push("  agent-ready validate");
  lines.push("  agent-ready doctor");
  lines.push("  agent-ready generate --write");

  return { exitCode: ExitCode.SUCCESS, stdout: lines.join("\n") + "\n", stderr: "" };
}

function renderWriteValidationFailed(
  args: InitArgs,
  repoRoot: string,
  contractPath: string,
  yaml: string,
  validationDiags: Diagnostic[],
): CliOutcome {
  const exitCode = resolveExitCode(validationDiags);

  if (args.json) {
    const body = {
      ok: false,
      repoRoot,
      mode: "write" as const,
      contractPath,
      contract: yaml,
      validationPassed: false,
      diagnostics: renderDiagnosticsJson(validationDiags),
    };
    return {
      exitCode,
      stdout: JSON.stringify(body, null, 2) + "\n",
      stderr: "",
    };
  }

  return {
    exitCode,
    stdout: "",
    stderr: `agent-ready init: generated contract failed validation.\n${renderDiagnosticsHuman(validationDiags)}\n`,
  };
}

// ── JSON helpers ───────────────────────────────────────────────────────────

function detectionToJson(detection: InitDetection): Record<string, unknown> {
  return {
    projectName: detection.projectName,
    projectNameSource: detection.projectNameSource,
    projectNameSanitized: detection.projectNameSanitized,
    ...(detection.projectDescription !== undefined && {
      projectDescription: detection.projectDescription,
    }),
    ...(detection.nodeRange !== undefined && { nodeRange: detection.nodeRange }),
    ...(detection.nodeRangeSource !== undefined && { nodeRangeSource: detection.nodeRangeSource }),
    ...(detection.packageManager !== undefined && { packageManager: detection.packageManager }),
    ...(detection.packageManagerSource !== undefined && {
      packageManagerSource: detection.packageManagerSource,
    }),
    scriptsIncluded: Object.entries(detection.detectedScripts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name]) => name),
    scriptsSkipped: [...detection.skippedScripts].sort(),
    verificationScripts: [...detection.verificationScripts].sort(),
    docSources: [...detection.docSources].sort(),
    ignoredPatterns: [...detection.ignoredPatterns].sort(),
    skippedGitignorePatterns: [...detection.skippedGitignorePatterns].sort(),
    hasEnvInGitignore: detection.hasEnvInGitignore,
  };
}
