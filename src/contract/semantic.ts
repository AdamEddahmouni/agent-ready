import { validRange } from "semver";
import { joinPath } from "../filesystem/pathJoin.js";
import type { Diagnostic } from "../diagnostics/types.js";
import type { FileSystem } from "../filesystem/types.js";
import { SUPPORTED_CONTRACT_VERSION } from "./types.js";
import type { RawContract } from "./types.js";
import { isPathWithin, normalizePathPattern } from "./paths.js";

export interface SemanticContext {
  readonly fs: FileSystem;
  readonly repoRoot: string;
  readonly sourcePath: string;
}

/**
 * Cross-field validation that JSON Schema alone cannot express: reference
 * resolution, duplicate detection, version-range syntax, path-category
 * conflicts, and instruction-source existence. Assumes `raw` has already
 * passed schema validation.
 */
export async function validateSemantics(
  raw: RawContract,
  context: SemanticContext,
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];

  validateVersion(raw, diagnostics);
  validateCommandsAndVerification(raw, diagnostics);
  validateRuntimes(raw, diagnostics);
  validatePackageManager(raw, diagnostics);
  validatePathCategories(raw, diagnostics);
  await validateInstructionSources(raw, context, diagnostics);
  validateArchitecture(raw, diagnostics);
  validateArchitectureBoundaryRules(raw, diagnostics);
  validateAgents(raw, diagnostics);

  return diagnostics;
}

/**
 * Validates the machine-checked boundary rules from ADR-0037. Unlike
 * `architecture.boundaries`, which is unparsed prose, these are executable
 * policy and so their path forms are validated here rather than at analysis
 * time — a malformed rule is a contract error, not an analysis finding.
 */
function validateArchitectureBoundaryRules(raw: RawContract, diagnostics: Diagnostic[]): void {
  const rules = raw.architecture?.boundary_rules;
  if (rules === undefined) return;

  const seenOrigins = new Set<string>();
  for (let index = 0; index < rules.length; index++) {
    const rule = rules[index];
    if (rule === undefined) continue;

    const fromField = `/architecture/boundary_rules/${String(index)}/from`;
    const fromResult = normalizePathPattern(rule.from, fromField, { allowGlob: false });

    // A malformed origin does not hide the rule's import errors: every
    // problem in the rule is reported in one pass so the author fixes the
    // whole entry at once.
    let origin: string | undefined;
    if ("diagnostics" in fromResult) {
      diagnostics.push(...fromResult.diagnostics);
    } else {
      origin = fromResult.normalized;
      if (seenOrigins.has(origin)) {
        diagnostics.push(
          boundaryRuleDiagnostic(
            fromField,
            `Duplicate boundary rule origin "${rule.from}".`,
            `"${origin}" is declared as the origin of more than one boundary rule, so the policy for that path is split across rules.`,
            "Merge the rules into a single entry listing every disallowed import under one from.",
          ),
        );
        continue;
      }
      seenOrigins.add(origin);
    }

    const seenTargets = new Set<string>();
    for (let targetIndex = 0; targetIndex < rule.must_not_import.length; targetIndex++) {
      const target = rule.must_not_import[targetIndex];
      if (target === undefined) continue;
      const targetField = `/architecture/boundary_rules/${String(index)}/must_not_import/${String(targetIndex)}`;
      const targetResult = normalizePathPattern(target, targetField, { allowGlob: false });
      if ("diagnostics" in targetResult) {
        diagnostics.push(...targetResult.diagnostics);
        continue;
      }

      if (seenTargets.has(targetResult.normalized)) {
        diagnostics.push(
          boundaryRuleDiagnostic(
            targetField,
            `Duplicate disallowed import "${target}".`,
            `"${targetResult.normalized}" is listed more than once under the same boundary rule.`,
            "List each disallowed import prefix exactly once per rule.",
          ),
        );
        continue;
      }
      seenTargets.add(targetResult.normalized);

      if (origin !== undefined && isPathWithin(targetResult.normalized, origin)) {
        diagnostics.push(
          boundaryRuleDiagnostic(
            targetField,
            `Boundary rule forbids "${target}" from importing itself.`,
            `"${targetResult.normalized}" is inside the rule's own origin "${origin}", so the rule would report every import within that directory.`,
            "Declare a disallowed import prefix outside the rule's own from path.",
          ),
        );
      }
    }
  }
}

function boundaryRuleDiagnostic(
  field: string,
  summary: string,
  detail: string,
  remediation: string,
): Diagnostic {
  return {
    code: "ARCHITECTURE_BOUNDARY_RULE_INVALID",
    severity: "error",
    field,
    summary,
    detail,
    remediation,
  };
}

function validateArchitecture(raw: RawContract, diagnostics: Diagnostic[]): void {
  const decisions = raw.architecture?.key_decisions;
  if (decisions === undefined) return;

  const seen = new Set<string>();
  for (let index = 0; index < decisions.length; index++) {
    const decision = decisions[index];
    if (decision === undefined) continue;
    const field = `/architecture/key_decisions/${String(index)}/file`;
    const result = normalizePathPattern(decision.file, field, { allowGlob: false });
    if ("diagnostics" in result) {
      diagnostics.push(...result.diagnostics);
      continue;
    }
    if (!isMarkdownPath(result.normalized)) {
      diagnostics.push(
        invalidDeclaredMarkdownFile(
          "ARCHITECTURE_DECISION_INVALID",
          field,
          `Architecture decision "${decision.file}" is not a Markdown file.`,
          "Architecture decision files must use the .md extension.",
          "Reference a repository-relative Markdown decision file.",
        ),
      );
      continue;
    }
    if (seen.has(result.normalized)) {
      diagnostics.push(
        invalidDeclaredMarkdownFile(
          "ARCHITECTURE_DECISION_INVALID",
          field,
          `Duplicate architecture decision "${decision.file}".`,
          `"${result.normalized}" is listed more than once in architecture.key_decisions.`,
          "List each architecture decision file exactly once.",
        ),
      );
      continue;
    }
    seen.add(result.normalized);
  }
}

function validateAgents(raw: RawContract, diagnostics: Diagnostic[]): void {
  const contextFiles = raw.agents?.context_files;
  if (contextFiles === undefined) return;

  const seen = new Set<string>();
  for (let index = 0; index < contextFiles.length; index++) {
    const contextFile = contextFiles[index];
    if (contextFile === undefined) continue;
    const field = `/agents/context_files/${String(index)}`;
    const result = normalizePathPattern(contextFile, field, { allowGlob: false });
    if ("diagnostics" in result) {
      diagnostics.push(...result.diagnostics);
      continue;
    }
    if (!isMarkdownPath(result.normalized)) {
      diagnostics.push(
        invalidDeclaredMarkdownFile(
          "AGENT_CONTEXT_FILE_INVALID",
          field,
          `Agent context file "${contextFile}" is not a Markdown file.`,
          "Agent context files must use the .md extension.",
          "Reference a repository-relative Markdown context file.",
        ),
      );
      continue;
    }
    if (seen.has(result.normalized)) {
      diagnostics.push(
        invalidDeclaredMarkdownFile(
          "AGENT_CONTEXT_FILE_INVALID",
          field,
          `Duplicate agent context file "${contextFile}".`,
          `"${result.normalized}" is listed more than once in agents.context_files.`,
          "List each agent context file exactly once.",
        ),
      );
      continue;
    }
    seen.add(result.normalized);
  }
}

function isMarkdownPath(path: string): boolean {
  return path.toLowerCase().endsWith(".md");
}

function invalidDeclaredMarkdownFile(
  code: "ARCHITECTURE_DECISION_INVALID" | "AGENT_CONTEXT_FILE_INVALID",
  field: string,
  summary: string,
  detail: string,
  remediation: string,
): Diagnostic {
  return { code, severity: "error", field, summary, detail, remediation };
}

function validateVersion(raw: RawContract, diagnostics: Diagnostic[]): void {
  if (raw.version !== SUPPORTED_CONTRACT_VERSION) {
    diagnostics.push({
      code: "CONTRACT_VERSION_UNSUPPORTED",
      severity: "error",
      field: "/version",
      summary: `Contract version ${String(raw.version)} is not supported.`,
      detail: `This reference implementation only supports version ${String(SUPPORTED_CONTRACT_VERSION)}.`,
      remediation: `Set "version: ${String(SUPPORTED_CONTRACT_VERSION)}" or upgrade the Agent-Ready CLI.`,
    });
  }
}

function validateCommandsAndVerification(raw: RawContract, diagnostics: Diagnostic[]): void {
  const commandNames = new Set(Object.keys(raw.commands ?? {}));

  // Defensive check, reserved for representations where object-key
  // uniqueness cannot be relied upon (see docs/specification/diagnostics.md).
  const seenNormalized = new Set<string>();
  for (const name of commandNames) {
    const normalized = name.trim().toLowerCase();
    if (seenNormalized.has(normalized)) {
      diagnostics.push({
        code: "COMMAND_DUPLICATE",
        severity: "error",
        field: "/commands",
        summary: `Duplicate command declaration "${name}".`,
        detail: "Two command names normalize to the same identifier.",
        remediation: "Rename one of the commands so each identifier is unique.",
      });
    }
    seenNormalized.add(normalized);
  }

  if (raw.verification === undefined) {
    return;
  }

  const seenReferences = new Set<string>();
  for (const ref of raw.verification.required) {
    if (seenReferences.has(ref)) {
      diagnostics.push({
        code: "COMMAND_REFERENCE_INVALID",
        severity: "error",
        field: "/verification/required",
        summary: `Duplicate verification reference "${ref}".`,
        detail: `The command "${ref}" appears more than once in verification.required.`,
        remediation: "List each required command exactly once.",
      });
      continue;
    }
    seenReferences.add(ref);

    if (!commandNames.has(ref)) {
      diagnostics.push({
        code: "COMMAND_REFERENCE_INVALID",
        severity: "error",
        field: "/verification/required",
        summary: `Verification references undeclared command "${ref}".`,
        detail: `"${ref}" does not match any key under commands.`,
        remediation: `Declare a "${ref}" command, or remove it from verification.required.`,
      });
    }
  }
}

function validateRuntimes(raw: RawContract, diagnostics: Diagnostic[]): void {
  const runtimes = raw.environment?.runtimes;
  if (runtimes === undefined) {
    return;
  }
  for (const [name, range] of Object.entries(runtimes)) {
    if (validRange(range) === null) {
      diagnostics.push({
        code: "RUNTIME_DECLARATION_INVALID",
        severity: "error",
        field: `/environment/runtimes/${name}`,
        summary: `Runtime "${name}" has an invalid version range.`,
        detail: `"${range}" is not a valid semantic version range.`,
        remediation: 'Use a valid semver range, e.g. ">=20 <23".',
      });
    }
  }
}

function validatePackageManager(raw: RawContract, diagnostics: Diagnostic[]): void {
  const packageManager = raw.environment?.packageManager;
  if (packageManager === undefined) {
    return;
  }
  if (validRange(packageManager.version) === null) {
    diagnostics.push({
      code: "PACKAGE_MANAGER_INVALID",
      severity: "error",
      field: "/environment/packageManager/version",
      summary: `Package manager version "${packageManager.version}" is not a valid version or range.`,
      detail: "The version field must be a valid semantic version or semver range.",
      remediation: 'Use a valid semver value, e.g. "10" or ">=9 <11".',
    });
  }
}

interface CategoryEntry {
  readonly category: "protected" | "generated" | "ignored";
  readonly raw: string;
  readonly normalized: string;
}

function validatePathCategories(raw: RawContract, diagnostics: Diagnostic[]): void {
  const paths = raw.paths;
  if (paths === undefined) {
    return;
  }

  const entries: CategoryEntry[] = [];
  const categories: readonly ("protected" | "generated" | "ignored")[] = [
    "protected",
    "generated",
    "ignored",
  ];

  for (const category of categories) {
    const patterns = paths[category];
    if (patterns === undefined) {
      continue;
    }
    for (const pattern of patterns) {
      const field = `/paths/${category}`;
      const result = normalizePathPattern(pattern, field, { allowGlob: true });
      if ("diagnostics" in result) {
        diagnostics.push(...result.diagnostics);
        continue;
      }
      entries.push({ category, raw: pattern, normalized: result.normalized });
    }
  }

  const byNormalized = new Map<string, CategoryEntry[]>();
  for (const entry of entries) {
    const existing = byNormalized.get(entry.normalized);
    if (existing === undefined) {
      byNormalized.set(entry.normalized, [entry]);
    } else {
      existing.push(entry);
    }
  }

  for (const [normalized, group] of byNormalized) {
    if (group.length <= 1) {
      continue;
    }
    const categoriesInvolved = [...new Set(group.map((e) => e.category))];
    const isCrossCategory = categoriesInvolved.length > 1;
    diagnostics.push({
      code: "PATH_CATEGORY_CONFLICT",
      severity: "error",
      field: "/paths",
      summary: isCrossCategory
        ? `Path pattern "${normalized}" appears in multiple path categories.`
        : `Path pattern "${normalized}" is duplicated within "${group[0]?.category}".`,
      detail: `Normalized pattern "${normalized}" appears in: ${group
        .map((e) => `${e.category} ("${e.raw}")`)
        .join(", ")}. Each normalized pattern may appear in exactly one path category, once.`,
      remediation: "Remove the duplicate entry, or keep the pattern in only one category.",
    });
  }
}

async function validateInstructionSources(
  raw: RawContract,
  context: SemanticContext,
  diagnostics: Diagnostic[],
): Promise<void> {
  const sources = raw.instructions?.sources;
  if (sources === undefined) {
    return;
  }

  const seen = new Set<string>();
  for (const source of sources) {
    const field = "/instructions/sources";
    const result = normalizePathPattern(source, field, { allowGlob: false });
    if ("diagnostics" in result) {
      diagnostics.push(...result.diagnostics);
      continue;
    }

    if (seen.has(result.normalized)) {
      diagnostics.push({
        code: "INSTRUCTION_SOURCE_INVALID",
        severity: "error",
        field,
        summary: `Duplicate instruction source "${source}".`,
        detail: `"${result.normalized}" is listed more than once in instructions.sources.`,
        remediation: "List each instruction source exactly once.",
      });
      continue;
    }
    seen.add(result.normalized);

    const absolutePath = joinPath(context.repoRoot, result.normalized);
    const stat = await context.fs.stat(absolutePath);
    if (!stat?.isFile) {
      diagnostics.push({
        code: "INSTRUCTION_SOURCE_INVALID",
        severity: "error",
        field,
        summary: `Instruction source "${source}" does not exist.`,
        detail: `No readable file was found at "${result.normalized}" relative to the repository root.`,
        sourcePath: context.sourcePath,
        remediation: "Create the referenced document, or remove it from instructions.sources.",
      });
    }
  }
}
