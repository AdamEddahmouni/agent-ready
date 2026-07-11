import semver from "semver";
import { parseDocument } from "yaml";
import type { Diagnostic } from "../diagnostics/types.js";
import type { FileSystem } from "../filesystem/types.js";
import { FileSystemError } from "../filesystem/types.js";
import { joinPath } from "../filesystem/pathJoin.js";
import type { RawContract } from "../contract/types.js";

export interface UpgradeChange {
  readonly id:
    | "protect-env-files"
    | "ignore-node-modules"
    | "classify-build-output"
    | "ignore-coverage-output"
    | "declare-readme-source";
  readonly field: string;
  readonly summary: string;
  readonly before: unknown;
  readonly after: unknown;
}

export interface UpgradePlan {
  readonly changes: readonly UpgradeChange[];
  readonly diagnostics: readonly Diagnostic[];
  readonly proposedText: string;
  readonly diff: string;
}

/**
 * Plans conservative, additive improvements for an already-valid v1 contract.
 * Existing fields are never deleted and scalar values are never changed.
 */
export async function planUpgrade(
  fs: FileSystem,
  repoRoot: string,
  sourcePath: string,
  originalText: string,
  contract: RawContract,
): Promise<UpgradePlan> {
  const document = parseDocument(originalText, { uniqueKeys: true, strict: true });
  const changes: UpgradeChange[] = [];
  const diagnostics: Diagnostic[] = [];

  const protectedPaths = [...(contract.paths?.protected ?? [])];
  const generatedPaths = [...(contract.paths?.generated ?? [])];
  const ignoredPaths = [...(contract.paths?.ignored ?? [])];
  const allPathPatterns = new Set([...protectedPaths, ...generatedPaths, ...ignoredPaths]);

  const setPathCategory = (
    category: "protected" | "generated" | "ignored",
    values: readonly string[],
  ): void => {
    document.setIn(["paths", category], [...values]);
  };

  const addPathPattern = (
    category: "protected" | "generated" | "ignored",
    pattern: string,
    change: Omit<UpgradeChange, "before" | "after">,
  ): void => {
    if (allPathPatterns.has(pattern)) return;
    const target =
      category === "protected"
        ? protectedPaths
        : category === "generated"
          ? generatedPaths
          : ignoredPaths;
    const before = [...target];
    target.push(pattern);
    allPathPatterns.add(pattern);
    setPathCategory(category, target);
    changes.push({ ...change, before, after: [...target] });
  };

  const gitignorePath = joinPath(repoRoot, ".gitignore");
  try {
    const gitignoreStat = await fs.stat(gitignorePath);
    if (gitignoreStat?.isFile) {
      const gitignore = await fs.readTextFile(gitignorePath);
      if (gitignore.split(/\r?\n/u).some(isEnvironmentIgnorePattern)) {
        addPathPattern("protected", ".env*", {
          id: "protect-env-files",
          field: "/paths/protected",
          summary: "Protect environment files already excluded by .gitignore.",
        });
      }
    }
  } catch (error) {
    diagnostics.push(manualReviewDiagnostic(sourcePath, ".gitignore", error));
  }

  const commandRuns = Object.values(contract.commands ?? {}).map((command) => command.run);
  const isNodeRepository =
    contract.environment?.packageManager !== undefined ||
    commandRuns.some((run) => /\b(?:node|npm|npx|pnpm|yarn)\b/u.test(run));
  if (isNodeRepository) {
    addPathPattern("ignored", "node_modules/**", {
      id: "ignore-node-modules",
      field: "/paths/ignored",
      summary: "Ignore installed Node.js dependencies.",
    });
  }

  const buildRun = contract.commands?.["build"]?.run;
  if (buildRun !== undefined && /\b(?:tsc|vite\s+build|webpack|rollup)\b/u.test(buildRun)) {
    addPathPattern("generated", "dist/**", {
      id: "classify-build-output",
      field: "/paths/generated",
      summary: "Classify conventional build output as generated.",
    });
  }

  if (commandRuns.some((run) => /\bcoverage\b/u.test(run))) {
    addPathPattern("ignored", "coverage/**", {
      id: "ignore-coverage-output",
      field: "/paths/ignored",
      summary: "Ignore test coverage output.",
    });
  }

  const readmePath = joinPath(repoRoot, "README.md");
  try {
    const readmeStat = await fs.stat(readmePath);
    if (readmeStat?.isFile) {
      const sources = [...(contract.instructions?.sources ?? [])];
      if (!sources.includes("README.md")) {
        const before = [...sources];
        sources.push("README.md");
        document.setIn(["instructions", "sources"], sources);
        changes.push({
          id: "declare-readme-source",
          field: "/instructions/sources",
          summary: "Declare the repository README as an instruction source.",
          before,
          after: [...sources],
        });
      }
    }
  } catch (error) {
    diagnostics.push(manualReviewDiagnostic(sourcePath, "README.md", error));
  }

  const nodeRange = contract.environment?.runtimes?.["node"];
  const minimumNode = nodeRange === undefined ? null : semver.minVersion(nodeRange);
  if (nodeRange !== undefined && minimumNode !== null && minimumNode.major < 20) {
    diagnostics.push({
      code: "UPGRADE_MANUAL_REVIEW_REQUIRED",
      severity: "warning",
      summary: "The declared Node.js range predates Agent-Ready's supported runtime.",
      detail: `environment.runtimes.node is ${JSON.stringify(nodeRange)}. Raising it to ">=20" may be appropriate, but upgrade will not replace a maintainer-declared runtime range automatically.`,
      field: "/environment/runtimes/node",
      sourcePath,
      remediation:
        "Confirm the project's actual Node.js support policy and update the range manually.",
      metadata: { current: nodeRange, suggested: ">=20" },
    });
  }

  const proposedText = changes.length === 0 ? originalText : document.toString({ lineWidth: 0 });
  return {
    changes,
    diagnostics,
    proposedText,
    diff: renderFieldDiff(changes, sourcePath),
  };
}

function isEnvironmentIgnorePattern(line: string): boolean {
  const pattern = line.trim();
  return pattern === ".env" || pattern.startsWith(".env.") || pattern === ".env*";
}

function manualReviewDiagnostic(
  sourcePath: string,
  evidencePath: string,
  error: unknown,
): Diagnostic {
  return {
    code: "UPGRADE_MANUAL_REVIEW_REQUIRED",
    severity: "warning",
    summary: `Could not inspect optional upgrade evidence: ${evidencePath}`,
    detail: error instanceof FileSystemError ? error.message : "Unknown file-system error.",
    sourcePath,
    remediation: `Review ${evidencePath} manually before deciding whether to update the contract.`,
    metadata: { evidencePath },
  };
}

function renderFieldDiff(changes: readonly UpgradeChange[], sourcePath: string): string {
  if (changes.length === 0) return "";
  const lines = [`--- ${sourcePath}`, `+++ ${sourcePath} (proposed)`];
  for (const change of changes) {
    lines.push(
      `@@ ${change.field} @@`,
      `- ${renderDiffValue(change.before)}`,
      `+ ${renderDiffValue(change.after)}`,
    );
  }
  return lines.join("\n") + "\n";
}

function renderDiffValue(value: unknown): string {
  if (Array.isArray(value) && value.length === 0) return "<absent or empty>";
  return JSON.stringify(value);
}
