import { matchesAnyPattern } from "../contract/globMatch.js";
import { isPathWithin } from "../contract/paths.js";
import type { NormalizedArchitectureBoundaryRule } from "../contract/types.js";
import type { Diagnostic } from "../diagnostics/types.js";
import type { FileSystem } from "../filesystem/types.js";
import { FileSystemError } from "../filesystem/types.js";
import { joinPath } from "../filesystem/pathJoin.js";
import { extractImportSpecifiers } from "./importSpecifiers.js";

/** Maximum size of each scanned source file, mirroring ADR-0031's cap. */
export const MAX_SOURCE_FILE_BYTES = 5_000_000;

/** Depth guard against pathological trees; scanning never recurses further. */
const MAX_SCAN_DEPTH = 64;

const SCANNED_EXTENSIONS = [".ts", ".js", ".mjs", ".cjs"] as const;

export interface BoundaryViolationFinding {
  readonly sourcePath: string;
  readonly specifier: string;
  readonly resolvedPath: string;
  readonly from: string;
  readonly mustNotImport: string;
  readonly line: number;
  readonly column: number;
}

export interface ArchitectureRuleResult {
  readonly from: string;
  readonly filesScanned: number;
  readonly importsChecked: number;
}

export interface ArchitectureAnalysisResult {
  readonly rules: readonly ArchitectureRuleResult[];
  readonly filesScanned: number;
  readonly importsChecked: number;
  readonly findings: readonly BoundaryViolationFinding[];
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Checks declared boundary rules against the repository's actual import
 * graph (ADR-0037). Read-only and deterministic: it never modifies source
 * files and never resolves anything over the network.
 *
 * Only repository-relative imports participate. Bare module specifiers are
 * out of scope for this release, and a violation is always reported — there
 * is no heuristic suppression.
 */
export async function analyzeArchitecture(
  fs: FileSystem,
  repoRoot: string,
  rules: readonly NormalizedArchitectureBoundaryRule[],
  excludedPatterns: readonly string[] = [],
): Promise<ArchitectureAnalysisResult> {
  const ruleResults: ArchitectureRuleResult[] = [];
  const findings: BoundaryViolationFinding[] = [];
  const diagnostics: Diagnostic[] = [];
  let filesScanned = 0;
  let importsChecked = 0;

  for (const rule of rules) {
    const collected = await collectSourceFiles(fs, repoRoot, rule.from, excludedPatterns);
    diagnostics.push(...collected.diagnostics);

    let ruleImports = 0;
    for (const filePath of collected.files) {
      const read = await readSourceFile(fs, repoRoot, filePath);
      if (read.diagnostic !== undefined) {
        diagnostics.push(read.diagnostic);
        continue;
      }
      if (read.content === undefined) continue;

      for (const found of extractImportSpecifiers(read.content)) {
        const resolved = resolveRelativeSpecifier(filePath, found.specifier);
        if (resolved === undefined) continue;

        ruleImports++;
        importsChecked++;
        for (const forbidden of rule.mustNotImport) {
          if (!isPathWithin(resolved, forbidden)) continue;
          findings.push({
            sourcePath: filePath,
            specifier: found.specifier,
            resolvedPath: resolved,
            from: rule.from,
            mustNotImport: forbidden,
            line: found.line,
            column: found.column,
          });
          diagnostics.push({
            code: "ARCHITECTURE_BOUNDARY_VIOLATED",
            severity: "error",
            field: "/architecture/boundary_rules",
            summary: `Boundary violated: ${filePath} imports ${resolved}`,
            detail: `"${rule.from}" declares that it must not import "${forbidden}", but "${filePath}" imports "${found.specifier}", which resolves to "${resolved}".`,
            sourcePath: filePath,
            location: { line: found.line, column: found.column },
            remediation:
              "Remove the import, route it through an allowed boundary, or change the declared rule if the architecture intentionally changed.",
            metadata: {
              specifier: found.specifier,
              resolvedPath: resolved,
              from: rule.from,
              mustNotImport: forbidden,
            },
          });
          break;
        }
      }
    }

    filesScanned += collected.files.length;
    ruleResults.push({
      from: rule.from,
      filesScanned: collected.files.length,
      importsChecked: ruleImports,
    });
  }

  return { rules: ruleResults, filesScanned, importsChecked, findings, diagnostics };
}

async function readSourceFile(
  fs: FileSystem,
  repoRoot: string,
  filePath: string,
): Promise<{ content?: string; diagnostic?: Diagnostic }> {
  const absolutePath = joinPath(repoRoot, filePath);
  try {
    const stat = await fs.stat(absolutePath);
    if (stat?.isFile === true && stat.sizeBytes > MAX_SOURCE_FILE_BYTES) {
      return {
        diagnostic: scanFailedDiagnostic(
          filePath,
          `Source file exceeds the analysis size limit: ${filePath}`,
          `The file is ${String(stat.sizeBytes)} bytes, which exceeds the ${String(MAX_SOURCE_FILE_BYTES)} byte per-file limit.`,
          "Split the file, or exclude its directory from the boundary rule.",
        ),
      };
    }
    return { content: await fs.readTextFile(absolutePath) };
  } catch (error) {
    return {
      diagnostic: scanFailedDiagnostic(
        filePath,
        `Failed to read source file: ${filePath}`,
        error instanceof FileSystemError ? error.message : "Unknown file-system error.",
        "Check filesystem permissions and retry the analysis.",
      ),
    };
  }
}

async function collectSourceFiles(
  fs: FileSystem,
  repoRoot: string,
  fromPrefix: string,
  excludedPatterns: readonly string[],
): Promise<{ files: readonly string[]; diagnostics: readonly Diagnostic[] }> {
  const files: string[] = [];
  const diagnostics: Diagnostic[] = [];
  const queue: { path: string; depth: number }[] = [{ path: fromPrefix, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) continue;
    if (current.depth > MAX_SCAN_DEPTH) continue;

    let entries;
    try {
      entries = await fs.readDirectory(joinPath(repoRoot, current.path));
    } catch (error) {
      diagnostics.push(
        scanFailedDiagnostic(
          current.path,
          `Failed to scan directory: ${current.path}`,
          error instanceof FileSystemError ? error.message : "Unknown file-system error.",
          "Check filesystem permissions and retry the analysis.",
        ),
      );
      continue;
    }

    if (entries === undefined) {
      // Only the rule's own origin is worth reporting: a declared boundary
      // that points at nothing is a stale declaration, whereas a missing
      // nested directory simply cannot occur.
      if (current.depth === 0) {
        diagnostics.push(
          scanFailedDiagnostic(
            current.path,
            `Boundary rule origin does not exist: ${current.path}`,
            `No directory was found at "${current.path}" relative to the repository root.`,
            "Point the rule's from at an existing directory, or remove the rule.",
          ),
        );
      }
      continue;
    }

    for (const entry of entries) {
      const childPath = `${current.path}/${entry.name}`;
      // Symlinked entries are never followed, so a symlink cycle cannot hang
      // the scan and a link cannot smuggle in out-of-tree source.
      if (entry.isSymbolicLink) continue;
      // Declared exclusions are globs, so they are matched per path rather
      // than by prefix. A directory only prunes when it matches directly;
      // a pattern like "dist/**" excludes the files inside it instead.
      if (matchesAnyPattern(childPath, excludedPatterns)) continue;
      if (entry.isDirectory) {
        queue.push({ path: childPath, depth: current.depth + 1 });
        continue;
      }
      if (entry.isFile && SCANNED_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
        files.push(childPath);
      }
    }
  }

  return { files: files.sort((left, right) => left.localeCompare(right)), diagnostics };
}

function scanFailedDiagnostic(
  sourcePath: string,
  summary: string,
  detail: string,
  remediation: string,
): Diagnostic {
  return {
    code: "ARCHITECTURE_ANALYSIS_SCAN_FAILED",
    severity: "error",
    field: "/architecture/boundary_rules",
    summary,
    detail,
    sourcePath,
    remediation,
  };
}

/**
 * Resolves a relative import to a repository-relative path, or returns
 * undefined for bare specifiers, absolute paths, and URLs — none of which
 * participate in boundary checking in this release.
 *
 * Extensions are compared as written. The scanner does not perform Node's
 * resolution algorithm, so "./x" and "./x.js" resolve to different paths;
 * prefix matching makes that immaterial for directory-scoped rules.
 */
function resolveRelativeSpecifier(sourcePath: string, specifier: string): string | undefined {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return undefined;

  const stack = sourcePath.split("/").slice(0, -1);
  for (const segment of specifier.split("/")) {
    if (segment.length === 0 || segment === ".") continue;
    if (segment === "..") {
      if (stack.length === 0) return undefined;
      stack.pop();
      continue;
    }
    stack.push(segment);
  }

  return stack.length === 0 ? undefined : stack.join("/");
}
