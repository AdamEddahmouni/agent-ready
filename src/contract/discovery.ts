import { isAbsolute, resolve } from "node:path";
import type { FileSystem } from "../filesystem/types.js";
import type { Diagnostic } from "../diagnostics/types.js";
import { dirnamePath, joinPath } from "../filesystem/pathJoin.js";

export const CANONICAL_CONTRACT_FILENAME = "agent-ready.yaml";

/**
 * Upper bound on ancestor directories walked during discovery. This is a
 * pure safety limit against pathological inputs (e.g. symlink cycles); it
 * is not expected to be reached in ordinary repositories.
 */
const MAX_ANCESTOR_DEPTH = 64;

export interface RepositoryContext {
  readonly repoRoot: string;
  readonly contractPath: string;
}

export interface DiscoveryOptions {
  /** Directory to start searching from. Defaults to the file system's cwd. */
  readonly startDir?: string;
  /** Explicit contract path from --config. Bypasses ancestor search. */
  readonly explicitConfigPath?: string;
}

/**
 * Resolves the repository root and canonical contract path.
 *
 * Discovery rules (see docs/specification/discovery.md):
 *  - With an explicit config path, the repository root is simply the
 *    directory containing that file. No ancestor search is performed.
 *  - Otherwise, search walks upward from the start directory (inclusive),
 *    at each level checking for `agent-ready.yaml`.
 *  - If a directory contains a `.git` entry but not the contract, the
 *    search stops there (repositories do not search past their own git
 *    boundary). Non-git directory trees are searched up to the file
 *    system root, bounded by MAX_ANCESTOR_DEPTH.
 *  - Git is never required and the git executable is never invoked; only
 *    the presence of a `.git` entry is checked.
 */
export async function discoverRepositoryContext(
  fs: FileSystem,
  options: DiscoveryOptions = {},
): Promise<{ readonly context: RepositoryContext } | { readonly diagnostic: Diagnostic }> {
  if (options.explicitConfigPath !== undefined) {
    return discoverExplicit(fs, options.explicitConfigPath);
  }
  return discoverByAncestorSearch(fs, options.startDir ?? fs.cwd);
}

async function discoverExplicit(
  fs: FileSystem,
  explicitConfigPath: string,
): Promise<{ readonly context: RepositoryContext } | { readonly diagnostic: Diagnostic }> {
  const absolutePath = isAbsolute(explicitConfigPath)
    ? explicitConfigPath
    : resolve(fs.cwd, explicitConfigPath);

  const stat = await fs.stat(absolutePath);
  if (!stat?.isFile) {
    return {
      diagnostic: {
        code: "CONTRACT_NOT_FOUND",
        severity: "error",
        summary: "The path given to --config does not exist or is not a file.",
        detail: `No readable file was found at "${absolutePath}".`,
        sourcePath: absolutePath,
        remediation: "Check the --config path and try again.",
      },
    };
  }

  return {
    context: {
      repoRoot: dirnamePath(absolutePath),
      contractPath: absolutePath,
    },
  };
}

async function discoverByAncestorSearch(
  fs: FileSystem,
  startDir: string,
): Promise<{ readonly context: RepositoryContext } | { readonly diagnostic: Diagnostic }> {
  let currentDir = isAbsolute(startDir) ? startDir : resolve(fs.cwd, startDir);
  let previousDir: string | undefined;
  let depth = 0;

  while (previousDir !== currentDir && depth < MAX_ANCESTOR_DEPTH) {
    const contractCandidate = joinPath(currentDir, CANONICAL_CONTRACT_FILENAME);
    const contractStat = await fs.stat(contractCandidate);
    if (contractStat?.isFile) {
      return {
        context: {
          repoRoot: currentDir,
          contractPath: contractCandidate,
        },
      };
    }

    const gitStat = await fs.stat(joinPath(currentDir, ".git"));
    if (gitStat !== undefined) {
      break; // Reached the git boundary without finding a contract; stop here.
    }

    previousDir = currentDir;
    currentDir = dirnamePath(currentDir);
    depth++;
  }

  return {
    diagnostic: {
      code: "CONTRACT_NOT_FOUND",
      severity: "error",
      summary: `No ${CANONICAL_CONTRACT_FILENAME} found.`,
      detail: `Searched "${startDir}" and its ancestor directories for ${CANONICAL_CONTRACT_FILENAME}.`,
      remediation: `Create an ${CANONICAL_CONTRACT_FILENAME} file at the repository root, or pass --config with an explicit path.`,
    },
  };
}
