import type { NormalizedContract } from "../contract/types.js";
import type { Diagnostic } from "../diagnostics/types.js";
import { joinPath } from "../filesystem/pathJoin.js";
import type { FileSystem } from "../filesystem/types.js";
import { renderAgentsMd } from "./adapters/agentsMd.js";
import { renderClaude } from "./adapters/claude.js";
import { renderCopilot } from "./adapters/copilot.js";
import { renderCursor } from "./adapters/cursor.js";
import { renderGemini } from "./adapters/gemini.js";
import { hasManagedMarker } from "./marker.js";
import type { GenerationPlan, PlanEntry, PlannedOutput, RendererRegistry } from "./types.js";

const RENDERERS: RendererRegistry = {
  agentsMd: renderAgentsMd,
  claude: renderClaude,
  cursor: renderCursor,
  copilot: renderCopilot,
  gemini: renderGemini,
};

/**
 * Computes which files would be generated for the contract's enabled
 * adapters. Pure with respect to the file system: never reads or writes
 * disk. Output paths are always adapter-hardcoded filenames joined
 * against `repoRoot`, with a defense-in-depth check that the joined path
 * still resolves inside `repoRoot` (expected unreachable in practice,
 * since renderers never take path input from the contract).
 */
export function planGeneration(contract: NormalizedContract, repoRoot: string): GenerationPlan {
  const entries: PlanEntry[] = [];
  const diagnostics: Diagnostic[] = [];

  for (const adapter of contract.adapters) {
    if (!adapter.enabled) {
      continue;
    }

    const renderer = RENDERERS[adapter.name];
    if (renderer === undefined) {
      diagnostics.push({
        code: "ADAPTER_NOT_YET_IMPLEMENTED",
        severity: "warning",
        summary: `Adapter "${adapter.name}" is enabled but Agent-Ready does not generate output for it yet.`,
        field: `/adapters/${adapter.name}`,
        remediation: "Disable this adapter, or wait for a future release that implements it.",
      });
      continue;
    }

    const file = renderer(contract);
    const absolutePath = joinPath(repoRoot, file.relativePath);
    if (!isWithinRoot(repoRoot, absolutePath)) {
      diagnostics.push({
        code: "GENERATE_OUTSIDE_REPO_ROOT",
        severity: "error",
        summary: `Generated output path for adapter "${adapter.name}" would escape the repository root.`,
        detail: absolutePath,
        field: `/adapters/${adapter.name}`,
        remediation: "Please report this as a bug in Agent-Ready.",
      });
      continue;
    }

    entries.push({
      adapter: adapter.name,
      relativePath: file.relativePath,
      absolutePath,
      content: file.content,
    });
  }

  return { entries, diagnostics };
}

/**
 * Resolves each plan entry's on-disk status by reading the current file
 * system state. Read-only — never writes.
 */
export async function resolvePlannedOutputs(
  fs: FileSystem,
  entries: readonly PlanEntry[],
): Promise<PlannedOutput[]> {
  const results: PlannedOutput[] = [];
  for (const entry of entries) {
    const stat = await fs.stat(entry.absolutePath);
    if (stat === undefined) {
      results.push({ ...entry, status: "would-write" });
      continue;
    }

    const existing = await fs.readTextFile(entry.absolutePath);
    if (existing === entry.content) {
      results.push({ ...entry, status: "up-to-date" });
    } else if (hasManagedMarker(existing)) {
      results.push({ ...entry, status: "would-write" });
    } else {
      results.push({ ...entry, status: "unmanaged" });
    }
  }
  return results;
}

function isWithinRoot(repoRoot: string, absolutePath: string): boolean {
  const normalizedRoot = trimTrailingPathSeparators(repoRoot);
  return (
    absolutePath === normalizedRoot ||
    absolutePath.startsWith(`${normalizedRoot}/`) ||
    absolutePath.startsWith(`${normalizedRoot}\\`)
  );
}

/**
 * Removes trailing path separators without a backtracking regular expression.
 * `repoRoot` comes from the host filesystem, so this keeps the containment
 * guard predictably linear even when a path contains a very long run of
 * separators.
 */
function trimTrailingPathSeparators(path: string): string {
  let end = path.length;
  while (end > 0 && (path[end - 1] === "/" || path[end - 1] === "\\")) {
    end -= 1;
  }
  return path.slice(0, end);
}
