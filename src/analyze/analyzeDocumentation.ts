import type { Diagnostic } from "../diagnostics/types.js";
import type { FileSystem } from "../filesystem/types.js";
import { FileSystemError } from "../filesystem/types.js";
import { joinPath } from "../filesystem/pathJoin.js";
import { extractMarkdownLinks } from "./markdownLinks.js";

/** Maximum size of each declared Markdown instruction source. */
export const MAX_INSTRUCTION_SOURCE_BYTES = 5_000_000;

export interface DocumentationSourceResult {
  readonly path: string;
  readonly linksChecked: number;
}

export interface DocumentationDriftFinding {
  readonly kind: "broken" | "outside-repository";
  readonly sourcePath: string;
  readonly destination: string;
  readonly resolvedPath?: string;
  readonly line: number;
  readonly column: number;
}

export interface DocumentationAnalysisResult {
  readonly sources: readonly DocumentationSourceResult[];
  readonly linksChecked: number;
  readonly findings: readonly DocumentationDriftFinding[];
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Checks local Markdown links in declared instruction sources. This is a
 * read-only, deterministic analysis; remote/root-relative links and anchors are
 * deliberately outside ADR-0020's bounded scope.
 */
export async function analyzeDocumentation(
  fs: FileSystem,
  repoRoot: string,
  instructionSources: readonly string[],
): Promise<DocumentationAnalysisResult> {
  const sources: DocumentationSourceResult[] = [];
  const findings: DocumentationDriftFinding[] = [];
  const diagnostics: Diagnostic[] = [];
  let linksChecked = 0;

  for (const sourcePath of instructionSources) {
    const absoluteSourcePath = joinPath(repoRoot, sourcePath);
    try {
      const sourceStat = await fs.stat(absoluteSourcePath);
      if (sourceStat?.isFile && sourceStat.sizeBytes > MAX_INSTRUCTION_SOURCE_BYTES) {
        sources.push({ path: sourcePath, linksChecked: 0 });
        diagnostics.push({
          code: "INSTRUCTION_SOURCE_TOO_LARGE",
          severity: "error",
          summary: `Instruction source exceeds the analysis size limit: ${sourcePath}`,
          detail: `The file is ${String(sourceStat.sizeBytes)} bytes, which exceeds the ${String(MAX_INSTRUCTION_SOURCE_BYTES)} byte per-source limit.`,
          sourcePath,
          remediation:
            "Split the document into smaller focused sources or remove it from instructions.sources.",
          metadata: {
            sizeBytes: sourceStat.sizeBytes,
            maxSizeBytes: MAX_INSTRUCTION_SOURCE_BYTES,
          },
        });
        continue;
      }
    } catch (error) {
      sources.push({ path: sourcePath, linksChecked: 0 });
      diagnostics.push({
        code: "DOCUMENTATION_SOURCE_READ_FAILED",
        severity: "error",
        summary: `Failed to inspect instruction source: ${sourcePath}`,
        detail: error instanceof FileSystemError ? error.message : "Unknown file-system error.",
        sourcePath,
        remediation: "Check that the declared instruction source is a readable text file.",
      });
      continue;
    }

    let markdown: string;
    try {
      markdown = await fs.readTextFile(absoluteSourcePath);
    } catch (error) {
      sources.push({ path: sourcePath, linksChecked: 0 });
      diagnostics.push({
        code: "DOCUMENTATION_SOURCE_READ_FAILED",
        severity: "error",
        summary: `Failed to read instruction source: ${sourcePath}`,
        detail: error instanceof FileSystemError ? error.message : "Unknown read error.",
        sourcePath,
        remediation: "Check that the declared instruction source is a readable text file.",
      });
      continue;
    }

    const links = extractMarkdownLinks(markdown);
    let sourceLinksChecked = 0;
    for (const link of links) {
      const resolution = resolveLocalDestination(sourcePath, link.destination);
      if (resolution.kind === "ignored") continue;

      sourceLinksChecked++;
      linksChecked++;
      if (resolution.kind === "outside-repository") {
        const finding: DocumentationDriftFinding = {
          kind: "outside-repository",
          sourcePath,
          destination: link.destination,
          line: link.line,
          column: link.column,
        };
        findings.push(finding);
        diagnostics.push({
          code: "DOCUMENTATION_LINK_OUTSIDE_REPOSITORY",
          severity: "error",
          summary: `Documentation link escapes the repository: ${link.destination}`,
          detail: `The link in "${sourcePath}" traverses above the repository root.`,
          sourcePath,
          location: { line: link.line, column: link.column },
          remediation: "Use a repository-relative link that remains inside the repository.",
          metadata: { destination: link.destination },
        });
        continue;
      }

      let target;
      try {
        target = await fs.stat(joinPath(repoRoot, resolution.path));
      } catch (error) {
        diagnostics.push({
          code: "DOCUMENTATION_LINK_CHECK_FAILED",
          severity: "error",
          summary: `Failed to inspect documentation link target: ${resolution.path}`,
          detail: error instanceof FileSystemError ? error.message : "Unknown file-system error.",
          sourcePath,
          location: { line: link.line, column: link.column },
          remediation: "Check filesystem permissions and retry the analysis.",
          metadata: { destination: link.destination, resolvedPath: resolution.path },
        });
        continue;
      }

      if (target === undefined) {
        const finding: DocumentationDriftFinding = {
          kind: "broken",
          sourcePath,
          destination: link.destination,
          resolvedPath: resolution.path,
          line: link.line,
          column: link.column,
        };
        findings.push(finding);
        diagnostics.push({
          code: "DOCUMENTATION_LINK_BROKEN",
          severity: "error",
          summary: `Documentation link target does not exist: ${resolution.path}`,
          detail: `The link destination "${link.destination}" in "${sourcePath}" resolves to a path that does not exist.`,
          sourcePath,
          location: { line: link.line, column: link.column },
          remediation: "Fix the link destination, restore the target, or remove the stale link.",
          metadata: { destination: link.destination, resolvedPath: resolution.path },
        });
      }
    }
    sources.push({ path: sourcePath, linksChecked: sourceLinksChecked });
  }

  return { sources, linksChecked, findings, diagnostics };
}

type DestinationResolution =
  | { readonly kind: "ignored" }
  | { readonly kind: "outside-repository" }
  | { readonly kind: "local"; readonly path: string };

function resolveLocalDestination(
  sourcePath: string,
  rawDestination: string,
): DestinationResolution {
  const destination = rawDestination.trim();
  if (
    destination.length === 0 ||
    destination.startsWith("#") ||
    destination.startsWith("?") ||
    destination.startsWith("/") ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(destination)
  ) {
    return { kind: "ignored" };
  }

  const fragmentIndex = destination.indexOf("#");
  const queryIndex = destination.indexOf("?");
  const suffixIndexes = [fragmentIndex, queryIndex].filter((index) => index >= 0);
  const pathEnd = suffixIndexes.length === 0 ? destination.length : Math.min(...suffixIndexes);
  let localPath = destination.slice(0, pathEnd);
  if (localPath.length === 0) return { kind: "ignored" };

  try {
    localPath = decodeURIComponent(localPath);
  } catch {
    // Treat malformed percent escapes as literal filename characters. The
    // existence check will produce the useful broken-link diagnostic.
  }
  localPath = localPath.replaceAll("\\", "/");

  const stack = sourcePath.split("/").slice(0, -1);
  for (const segment of localPath.split("/")) {
    if (segment.length === 0 || segment === ".") continue;
    if (segment === "..") {
      if (stack.length === 0) return { kind: "outside-repository" };
      stack.pop();
      continue;
    }
    stack.push(segment);
  }

  return { kind: "local", path: stack.join("/") };
}
