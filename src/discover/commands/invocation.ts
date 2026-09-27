/**
 * Deriving a structured command invocation from package-manager evidence
 * (ADR-0046 §8).
 *
 * This module answers one question: given what the repository declares about its
 * package managers, can Agent-Ready say what a contributor would type to run a
 * command in a given package? The answer is frequently "no", and the shape of
 * that "no" is the point.
 *
 * Three rules, stated here rather than buried in a helper:
 *
 *  1. **An invocation requires an agreed manager fact.** Not a declared one, not
 *     a contested one — an *agreed* one, supported by at least one piece of
 *     repository evidence rather than only by a maintainer's contract.
 *  2. **Package-local evidence wins, including when it is bad news.** A member
 *     with its own manager is invoked with that manager even when the root
 *     disagrees. A member whose own manager is contested does *not* fall back to
 *     the root, because silence about a contradiction is not absence.
 *  3. **Inheritance is only from a genuine absence.** A member inherits the root
 *     manager when its own scope found nothing at all — not when its own scope
 *     could not be inspected, and never when its own scope disagrees.
 *
 * There is no `npm` default anywhere in this file, and that is the whole
 * design. Node's historical default is a fact about Node, not about this
 * repository; minting it from the absence of evidence is the manufactured
 * knowledge this boundary exists to prevent.
 */

import { mergeContributions } from "../fact.js";
import type { Contribution } from "../fact.js";
import { compareCodeUnits } from "../ordering.js";
import type { DiscoveryProbeContext } from "../probe.js";
import { collectDeclarationClaims, collectLockfileClaims } from "../probes/packageManager.js";
import { managerNameOfClaimValue } from "../packages/packageManager.js";
import { packageManagerFactId, ROOT_PACKAGE_SCOPE } from "../types.js";
import type { CommandInvocation, InvocationStatus, UnknownReason } from "../types.js";

/**
 * What the repository's own evidence says about one scope's package manager.
 *
 * The four states are ADR-0045's outcomes, narrowed to the question a
 * downstream derivation needs to ask. `reason` is carried on the unknown variant
 * because rule 3 above needs it: `no-evidence` means "we looked and there was
 * nothing", which is the only state a root manager may fill in, while
 * `probe-failed` means "we could not look" and must stay that way.
 */
export type ManagerResolution =
  | { readonly status: "resolved"; readonly manager: string }
  | { readonly status: "unknown"; readonly reason: UnknownReason }
  | { readonly status: "conflict" }
  | { readonly status: "incomplete" };

/**
 * Resolves every discovered package-manager identity to one of the four states.
 *
 * Built from the *same* collectors the package-manager probes use, and merged
 * with the *same* `mergeContributions` strategy, so a command's executable can
 * never disagree with the manager fact the snapshot publishes. Re-deriving this
 * from the manifests separately would create exactly the two-readers problem
 * ADR-0045 §3's scoping was built to avoid.
 *
 * The author's `author-declared` contract claim is deliberately **not**
 * collected here. A maintainer asserting `pnpm` in `agent-ready.yaml` is a
 * description of the repository, not a statement by it, and ADR-0046 §6 forbids
 * it from selecting an executable. Because it is absent, a repository whose only
 * manager evidence is a contract claim resolves to `unknown` — the correct
 * answer, since the repository itself says nothing.
 */
export async function resolvePackageManagers(
  context: DiscoveryProbeContext,
): Promise<ReadonlyMap<string, ManagerResolution>> {
  const layout = await context.readRepositoryLayout();
  const declaration = await collectDeclarationClaims(context, layout.manifestPaths);
  const lockfile = await collectLockfileClaims(context, layout.manifestPaths);

  const contributions: Contribution[] = [
    ...declaration.claims.map((claim) => ({
      id: claim.factId,
      kind: claim.kind,
      value: claim.value,
      evidence: claim.evidence,
      ...(claim.projected !== undefined && { projected: claim.projected }),
    })),
    ...lockfile.claims.map((claim) => ({
      id: claim.factId,
      kind: claim.kind,
      value: claim.value,
      evidence: claim.evidence,
      ...(claim.projected !== undefined && { projected: claim.projected }),
    })),
  ];
  // An unmodelled declaration is a `not-probed` fact in the published snapshot.
  // Reproduced here so the resolver's answer for that scope matches, rather than
  // letting an unmodelled field read as "nothing was found and inherit the
  // root instead".
  for (const factId of declaration.unsupported) {
    contributions.push({ id: factId, reason: "not-probed", evidence: [] });
  }
  if (lockfile.unreadable.length > 0) {
    // A lockfile that could not be inspected is the published fact's
    // `probe-failed`; reproduced for the same reason.
    for (const directory of layout.manifestPaths.map(scopeOf)) {
      contributions.push({
        id: packageManagerFactId(directory),
        reason: "probe-failed",
        evidence: lockfile.unreadable.map((path) => ({ source: path })),
      });
    }
  }

  const resolved = new Map<string, ManagerResolution>();
  for (const fact of mergeContributions(contributions)) {
    const scope = fact.id.slice("repository.packageManager.".length);
    if (fact.kind === "unknown") {
      resolved.set(scope, { status: "unknown", reason: fact.reason });
      continue;
    }
    if (!("value" in fact)) {
      resolved.set(scope, { status: "conflict" });
      continue;
    }
    if (fact.contradictedBy !== undefined) {
      // Contested. The declaration is retained in its own fact with its
      // contradicting artifacts published; promoting it to a canonical
      // executable here would resolve that disagreement by fiat.
      resolved.set(scope, { status: "incomplete" });
      continue;
    }
    const manager = managerNameOfClaimValue(fact.value);
    resolved.set(
      scope,
      manager === undefined ? { status: "conflict" } : { status: "resolved", manager },
    );
  }
  return resolved;
}

/**
 * Builds the structured invocation for one command, or reports why there is
 * none.
 *
 * Returns a discriminated pair rather than a nullable object so a caller
 * cannot read a stale `invocation` against a status that says it is unresolved.
 * The three unresolved outcomes are published, not collapsed: a reader can tell
 * "we found no manager", "the sources disagree", and "the declaration is
 * contested" apart without parsing prose.
 */
export function invocationFor(
  packagePath: string,
  scriptName: string,
  managers: ReadonlyMap<string, ManagerResolution>,
):
  | { readonly invocation: CommandInvocation; readonly status: InvocationStatus }
  | {
      readonly invocation: null;
      readonly status: InvocationStatus;
    } {
  const scope = packageManagerScopeOf(packagePath);
  const local = managers.get(scope);

  if (local !== undefined && local.status !== "unknown") {
    return local.status === "resolved"
      ? { invocation: buildInvocation(packagePath, local.manager, scriptName), status: "resolved" }
      : { invocation: null, status: statusFor(local) };
  }

  // No package-local manager. Inheritance is allowed only from a genuine
  // absence — `no-evidence` means the scope was inspected and held nothing. A
  // scope we could not read, or one whose declaration we decline to model, is
  // ignorance rather than emptiness, and guessing across it would turn an
  // unreadable manifest into a confident `pnpm run test`.
  if (local !== undefined && local.reason !== "no-evidence") {
    return { invocation: null, status: "package-manager-unknown" };
  }
  if (scope === ROOT_PACKAGE_SCOPE) {
    return { invocation: null, status: "package-manager-unknown" };
  }

  const root = managers.get(ROOT_PACKAGE_SCOPE);
  if (root?.status !== "resolved") {
    return { invocation: null, status: "package-manager-unknown" };
  }
  return {
    invocation: buildInvocation(packagePath, root.manager, scriptName),
    status: "resolved",
  };
}

/**
 * The argv for a package script.
 *
 * Always `["run", name]`, for every manager. The per-manager shorthands —
 * `npm test`, `yarn test`, `pnpm test` — are deliberately not synthesised: the
 * set differs per tool and across versions, and `run <name>` is the one form
 * that means the same thing everywhere. Uniformity is worth more here than
 * prettiness, because a wrong shorthand is an invocation that does not work.
 */
function buildInvocation(
  packagePath: string,
  manager: string,
  scriptName: string,
): CommandInvocation {
  return { cwd: packagePath, executable: manager, args: ["run", scriptName] };
}

function statusFor(resolution: ManagerResolution): InvocationStatus {
  switch (resolution.status) {
    case "conflict":
      return "package-manager-conflict";
    case "incomplete":
      return "package-manager-incomplete";
    default:
      return "package-manager-unknown";
  }
}

/**
 * The manager identity for a package directory.
 *
 * The inverse of `packageManagerScope`, re-derived here so this module does not
 * depend on a probe. The root's label is `root` rather than `.` because
 * `repository.packageManager..` is technically unambiguous and practically
 * unreadable in a snapshot a person is meant to reason about.
 */
function packageManagerScopeOf(packagePath: string): string {
  return packagePath === "." || packagePath === "" ? ROOT_PACKAGE_SCOPE : packagePath;
}

function scopeOf(manifestPath: string): string {
  const separator = Math.max(manifestPath.lastIndexOf("/"), manifestPath.lastIndexOf("\\"));
  if (separator <= 0) {
    return ROOT_PACKAGE_SCOPE;
  }
  return manifestPath.slice(0, separator);
}

/**
 * Exported for the probe's own deterministic ordering. Every map this module
 * builds is keyed by a scope label that came from the layout, and a consumer
 * iterating one must do so in the snapshot's order rather than insertion order.
 */
export function compareScopes(a: string, b: string): number {
  return compareCodeUnits(a, b);
}
