import type { FileSystem } from "../filesystem/types.js";
import { joinPath } from "../filesystem/pathJoin.js";
import { REPOSITORY_ROOT } from "./graph/provenance.js";
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
 *
 * **`startDir` is made absolute before anything else happens.** This is load
 * bearing rather than cosmetic, and Issue #39 found it the hard way: a
 * relative start directory such as the default `.` walks up to itself and
 * returns `.` as the repository root, so every later absolute-path operation
 * that assumed an absolute root — resolving an import, converting a path back
 * to a repository-relative one — silently failed. Every probe is handed
 * `repoRoot` as an absolute path and the *snapshot* stays repository-relative;
 * the two are different jobs and only one of them is the contract.
 */
export async function resolveRepositoryRoot(
  fs: FileSystem,
  startDir: string,
): Promise<RootResolution> {
  const absoluteStart = isAbsoluteLike(startDir) ? startDir : joinPath(fs.cwd, startDir);
  const startStat = await statOrFail(fs, absoluteStart);
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

  let current = absoluteStart;
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
      repoRoot: absoluteStart,
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
 * Whether a path is absolute on either supported platform.
 *
 * A POSIX absolute path, a Windows drive-absolute path, and a UNC path all
 * count. A bare `.` does not, which is exactly the case this function exists to
 * catch.
 */
function isAbsoluteLike(path: string): boolean {
  if (path.startsWith("/") || path.startsWith("\\\\")) {
    return true;
  }
  return /^[A-Za-z]:[/\\]/.test(path);
}

/**
 * Builds the only capability probes receive: repository-relative reads, stats,
 * and directory listings. No writer, no process runner, no Git client, and no
 * HTTP client is reachable from a probe, which is the read-only guarantee from
 * ADR-0044 enforced by construction rather than by review.
 *
 * **`"."` resolves to the root itself, not to a `.` appended to it.** The
 * repository root's own repository-relative path is `"."` (ADR-0047's
 * `REPOSITORY_ROOT`), and joining that onto the root yields `/repo/.`. A real
 * `readdir` tolerates the trailing `/.`, so the bug hides on a workstation and
 * appears only against a strict boundary — where it is not a cosmetic one: a
 * listing of `/repo/.` throws, `safeList` cannot tell that from absence, and the
 * source walk returns **nothing** for a repository with no `tsconfig.json` and
 * no workspaces. Issue #39's adversarial matrix found it. Every relative path
 * goes through `absoluteFor` so the special case exists in exactly one place.
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
  readContractVerification: DiscoveryProbeContext["readContractVerification"],
  readRepositoryLayout: DiscoveryProbeContext["readRepositoryLayout"],
): DiscoveryProbeContext {
  const absoluteFor = (relativePath: string): string =>
    relativePath === REPOSITORY_ROOT ? repoRoot : joinPath(repoRoot, relativePath);
  return {
    repoRoot,
    readTextFile: (relativePath) => fs.readTextFile(absoluteFor(relativePath)),
    stat: (relativePath) => fs.stat(absoluteFor(relativePath)),
    listDirectory: (relativePath) => fs.listDirectory(absoluteFor(relativePath)),
    realPath: (relativePath) => fs.realPath(absoluteFor(relativePath)),
    readContract,
    readContractPackageManager,
    readContractVerification,
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
