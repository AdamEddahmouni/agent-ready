import type { FileSystem } from "../filesystem/types.js";
import { joinPath } from "../filesystem/pathJoin.js";
import type { DiscoveryProbeContext } from "./probe.js";
import type { DiscoveryDiagnostic, Evidence } from "./types.js";

/**
 * Upper bound on ancestor directories walked while resolving the repository
 * root. Mirrors the bound used by contract discovery (ADR-0004) so both walk
 * lengths are the same kind of safety limit, not a per-command invention.
 */
const MAX_ANCESTOR_DEPTH = 64;

export interface ResolvedRoot {
  readonly repoRoot: string;
  readonly evidence: readonly Evidence[];
}

export type RootResolution =
  | { readonly ok: true; readonly root: ResolvedRoot }
  | { readonly ok: false; readonly diagnostic: DiscoveryDiagnostic };

/**
 * Resolves the repository root independently of any contract.
 *
 * Contract discovery cannot be reused for this: it defines the root as the
 * directory *containing* `agent-ready.yaml` and fails with the fatal
 * `CONTRACT_NOT_FOUND` when there is none. For discovery, a missing contract
 * is repository information, not a failure, and the root must still exist.
 *
 * The walk starts at `startDir` and stops at the nearest ancestor containing a
 * `.git` entry (file or directory — worktrees use a `.git` file). Git itself is
 * never required and the `git` executable is never invoked; only the presence
 * of the entry is checked, exactly as in ADR-0004. With no `.git` boundary
 * within the depth bound, the start directory is the root.
 */
export async function resolveRepositoryRoot(
  fs: FileSystem,
  startDir: string,
): Promise<RootResolution> {
  const startStat = await statOrFail(fs, startDir);
  if (startStat?.isDirectory !== true) {
    return {
      ok: false,
      diagnostic: {
        code: "DISCOVERY_ROOT_UNREADABLE",
        severity: "error",
        summary: "The discovery root does not exist or is not a directory.",
        detail: `No readable directory was found at "${startDir}".`,
        remediation: "Pass --root with a path to an existing repository directory.",
      },
    };
  }

  let current = startDir;
  let previous: string | undefined;
  for (let depth = 0; previous !== current && depth < MAX_ANCESTOR_DEPTH; depth++) {
    const gitStat = await fs.stat(joinPath(current, ".git"));
    if (gitStat !== undefined) {
      return {
        ok: true,
        root: {
          repoRoot: current,
          evidence: [
            { source: ".git", detail: "nearest ancestor directory containing a .git entry" },
          ],
        },
      };
    }
    previous = current;
    const parent = parentOf(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return {
    ok: true,
    root: {
      repoRoot: startDir,
      evidence: [
        {
          source: ".",
          detail:
            "no .git boundary found within the ancestor search bound; using the start directory as the repository root",
        },
      ],
    },
  };
}

/**
 * Builds the only capability probes receive: repository-relative reads, stats,
 * and directory listings. No writer, no process runner, no Git client, and no
 * HTTP client is reachable from a probe, which is the read-only guarantee from
 * ADR-0044 enforced by construction rather than by review.
 *
 * Two accessors are memos scoped to a single run. Neither changes an observable
 * behaviour — each only avoids parsing or walking the same thing twice — but
 * both matter for more than speed: without the layout memo, two probes could
 * in principle report different views of the same repository, and the contract
 * reader would be shared mutable state across concurrent probes.
 */
export function createProbeContext(
  fs: FileSystem,
  repoRoot: string,
  readContract: DiscoveryProbeContext["readContract"],
  readContractPackageManager: DiscoveryProbeContext["readContractPackageManager"],
  readRepositoryLayout: DiscoveryProbeContext["readRepositoryLayout"],
): DiscoveryProbeContext {
  return {
    repoRoot,
    readTextFile: (relativePath) => fs.readTextFile(joinPath(repoRoot, relativePath)),
    stat: (relativePath) => fs.stat(joinPath(repoRoot, relativePath)),
    listDirectory: (relativePath) => fs.listDirectory(joinPath(repoRoot, relativePath)),
    realPath: (relativePath) => fs.realPath(joinPath(repoRoot, relativePath)),
    readContract,
    readContractPackageManager,
    readRepositoryLayout,
  };
}

async function statOrFail(fs: FileSystem, absolutePath: string) {
  try {
    return await fs.stat(absolutePath);
  } catch {
    return undefined;
  }
}

function parentOf(directory: string): string {
  const trimmed = directory.replace(/[/\\]+$/, "");
  const lastSeparator = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (lastSeparator < 0) {
    return directory;
  }
  if (lastSeparator === 0) {
    return trimmed.slice(0, 1);
  }
  return trimmed.slice(0, lastSeparator);
}
