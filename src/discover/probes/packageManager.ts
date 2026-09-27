/**
 * Package-manager discovery.
 *
 * Two probes, deliberately separate, because they observe two different kinds
 * of thing and must never be confused for one another:
 *
 *  - `packageManager.declaration` reads the `packageManager` field of a
 *    manifest. That is the repository *asserting* something.
 *  - `packageManager.lockfiles` observes manager-specific artifacts. That is the
 *    repository *containing* something.
 *
 * Neither is a verdict. Where they disagree, `fact.ts` publishes the
 * disagreement rather than settling it, which is why these are two probes
 * reporting on one fact identity rather than one probe trying to have an
 * opinion.
 */

import { compareCodeUnits } from "../ordering.js";
import type { DiscoveryProbe, DiscoveryProbeContext, ProbeClaim } from "../probe.js";
import { joinRelative } from "../packages/layout.js";
import {
  MANIFEST_FILENAME,
  fieldPointer,
  readManifest,
  readPackageManagerField,
} from "../packages/manifest.js";
import {
  LOCKFILE_SIGNALS,
  PACKAGE_MANAGER_FIELD,
  ROOT_MANIFEST,
  isSupportedDeclarationForm,
  managerFromDeclaration,
} from "../packages/packageManager.js";
import { packageManagerFactId, packageManagerScope } from "../types.js";
import type { FactId } from "../types.js";

/**
 * Reads the `packageManager` declaration of every discovered manifest.
 *
 * One claim per manifest that declares a supported field. A manifest with no
 * field contributes nothing rather than an empty claim, so a repository that
 * declares nothing leaves the fact's evidence honest instead of padded.
 *
 * A field that exists but is not `<name>@<version>` produces **no claim at
 * all** — not a best-effort split at the first `@`, and not a claim carrying a
 * guessed name. Lockfile claims about the same fact still stand on their own, so
 * an unmodelled declaration costs a declaration claim and nothing more. The raw
 * value is reported by the layout, which is where manifests are read and where
 * the `DISCOVERY_FACT_UNSUPPORTED` diagnostic is raised.
 */
export const packageManagerDeclarationProbe: DiscoveryProbe = {
  id: "package-manager.declaration",
  factId: "repository.packageManager.root",
  kind: "declared",
  shape: "value",
  async run(context) {
    const layout = await context.readRepositoryLayout();
    const claims: ProbeClaim[] = [];
    // Typed as `FactId` rather than `string` so the ids are checked at the point
    // they are produced rather than at the point they are consumed.
    const unsupported: FactId[] = [];

    for (const manifestPath of layout.manifestPaths) {
      const read = await readManifest(context, manifestPath);
      if (read.status !== "read") {
        continue;
      }
      const field = readPackageManagerField(read.document, PACKAGE_MANAGER_FIELD);
      if (!field.present) {
        continue;
      }
      const scope = packageManagerScope(directoryOf(manifestPath));
      if (!isSupportedDeclarationForm(field.raw)) {
        // Routed to its own fact, so the package still appears in the snapshot
        // as `unknown`/`not-probed` rather than vanishing because a sibling
        // declared something we do understand.
        unsupported.push(packageManagerFactId(scope));
        continue;
      }
      claims.push({
        factId: packageManagerFactId(scope),
        kind: "declared",
        // The field verbatim. The manager name is a projection of this, not a
        // replacement for it, so the pinned version survives into the snapshot
        // instead of being discarded in favour of a bare family name.
        value: field.raw as string,
        projected: managerFromDeclaration(field.raw),
        evidence: [
          {
            source: manifestPath,
            pointer: fieldPointer(PACKAGE_MANAGER_FIELD),
            detail: "declared package manager",
          },
        ],
      });
    }

    if (claims.length === 0 && unsupported.length > 0) {
      // Every declaration present is in a form this implementation does not
      // model. Each affected identity — including the root's, when the root is
      // the one that declared it — is routed to its own `not-probed` fact, so
      // none of them is missing from the snapshot. The root's `no-evidence`
      // from the lockfile probe is less informative and yields to it.
      return { status: "asserted", claims: [], unsupported };
    }
    if (claims.length === 0) {
      return {
        status: "not-found",
        evidence: layout.manifestPaths.map((manifestPath) => ({
          source: manifestPath,
          pointer: fieldPointer(PACKAGE_MANAGER_FIELD),
          detail: "not declared",
        })),
      };
    }
    return {
      status: "asserted",
      claims,
      ...(unsupported.length > 0 ? { unsupported } : {}),
    };
  },
};

/**
 * Observes manager-specific artifacts beside every discovered manifest.
 *
 * One claim per artifact, each citing only that artifact. The claim's value is
 * the **artifact path**, not the manager name, because the artifact's existence
 * is what was observed and the name is a projection applied uniformly at merge
 * time. Three lockfiles therefore produce three claims and a three-way conflict
 * — never `pnpm` because pnpm is first in a table.
 *
 * Artifacts are attributed to the manifest whose directory they sit in, so a
 * `yarn.lock` inside a workspace member is evidence about *that member* and
 * never folds into the root's identity. That is what stops a nested package's
 * manager from being flattened into a repository-wide answer.
 *
 * `pnpm-workspace.yaml` is not in the table: it is a workspace declaration, not
 * a manager signal, and counting it would assert something a repository holding
 * both it and a `yarn.lock` does not jointly say.
 */
export const packageManagerLockfileProbe: DiscoveryProbe = {
  id: "package-manager.lockfiles",
  factId: "repository.packageManager.root",
  kind: "derived",
  shape: "value",
  async run(context) {
    const layout = await context.readRepositoryLayout();
    const claims: ProbeClaim[] = [];
    const unreadable: string[] = [];

    for (const directory of dedupe(layout.manifestPaths.map(directoryOf))) {
      for (const signal of LOCKFILE_SIGNALS) {
        const artifactPath = joinRelative(directory, signal.path);
        const outcome = await statArtifact(context, artifactPath);
        if (outcome === "present") {
          claims.push({
            factId: packageManagerFactId(packageManagerScope(directory)),
            kind: "derived",
            value: artifactPath,
            projected: signal.manager,
            evidence: [{ source: artifactPath, detail: signal.detail }],
          });
          continue;
        }
        if (outcome === "failed") {
          unreadable.push(artifactPath);
        }
      }
    }

    if (claims.length === 0) {
      if (unreadable.length > 0) {
        return {
          status: "failed",
          // Named rather than left to the generic `DISCOVERY_PARTIAL`: a probe
          // that knows *which* condition it hit should say so, because
          // `agent-ready explain` is where a reader goes next and
          // DISCOVERY_LOCKFILE_UNREADABLE is the page that answers it. The fact
          // is still `unknown`/`probe-failed`, so the specific code describes
          // the failure more precisely without making the ignorance look like
          // an observation.
          code: "DISCOVERY_LOCKFILE_UNREADABLE",
          detail:
            "A lockfile could not be inspected: " +
            unreadable.join(", ") +
            ". Its existence is therefore not reported either.",
          evidence: unreadable.map((path) => ({ source: path, detail: "could not be inspected" })),
        };
      }
      return {
        status: "not-found",
        evidence: LOCKFILE_SIGNALS.map((signal) => ({
          source: signal.path,
          detail: "not present",
        })),
      };
    }
    return { status: "asserted", claims };
  },
};

type ArtifactOutcome = "present" | "absent" | "failed";

async function statArtifact(
  context: DiscoveryProbeContext,
  relativePath: string,
): Promise<ArtifactOutcome> {
  try {
    const stat = await context.stat(relativePath);
    return stat?.isFile === true ? "present" : "absent";
  } catch {
    // A path we were not permitted to inspect is not an absent path. Reporting
    // it as absent would assert that no lockfile is there on the strength of an
    // I/O error.
    return "failed";
  }
}

/**
 * The directory a manifest lives in, which scopes its package-manager fact.
 *
 * The root manifest scopes to `.` so the root identity stays
 * `repository.packageManager.` + `.` rather than being spelled with a filename.
 */
function directoryOf(manifestPath: string): string {
  if (manifestPath === ROOT_MANIFEST) {
    return ".";
  }
  return manifestPath.slice(0, -MANIFEST_FILENAME.length - 1);
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareCodeUnits);
}
