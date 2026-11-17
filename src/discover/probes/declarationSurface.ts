import type { DiscoveryProbe, DiscoveryProbeContext } from "../probe.js";
import { safeStat } from "../read.js";

/**
 * The fixed, versioned set of root-relative paths whose presence indicates an
 * existing declaration surface. This list is code, not configuration, so the
 * derivation of the fact cannot be tuned per repository — a requirement of the
 * `derived` kind in ADR-0044.
 *
 * Presence only. What any of these files *say*, which CI workflow runs when,
 * and how the agent surfaces relate to one another are all later discovery
 * issues; a probe that tried to answer them would be guessing.
 */
const DECLARATION_SURFACE_PATHS: readonly string[] = [
  "AGENTS.md",
  "CLAUDE.md",
  ".cursorrules",
  ".github/copilot-instructions.md",
  ".github/workflows",
];

export const DECLARATION_SURFACE_PROBED_PATHS = DECLARATION_SURFACE_PATHS;

export const declarationSurfaceProbe: DiscoveryProbe = {
  id: "declaration-surface.presence",
  factId: "repository.declarationSurface.present",
  kind: "derived",
  shape: "existence",
  async run(context: DiscoveryProbeContext) {
    const present: string[] = [];
    for (const relativePath of DECLARATION_SURFACE_PATHS) {
      const stat = await safeStat(context, relativePath);
      if (stat.status === "failed") {
        // A path we were not permitted to inspect is not an absent path.
        // Failing toward `unknown` keeps the claim defensible.
        return {
          status: "failed",
          detail: stat.detail,
          evidence: [{ source: relativePath, detail: "could not be inspected" }],
        };
      }
      if (stat.status === "present") {
        present.push(relativePath);
      }
    }

    if (present.length === 0) {
      return {
        status: "not-found",
        evidence: DECLARATION_SURFACE_PATHS.map((relativePath) => ({
          source: relativePath,
          detail: "not present",
        })),
      };
    }
    return {
      status: "found",
      evidence: present.map((relativePath) => ({
        source: relativePath,
        detail: "present",
      })),
    };
  },
};
