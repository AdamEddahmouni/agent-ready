/**
 * Command and verification discovery (ADR-0046).
 *
 * Two probes over one shared layout, producing two different answers to two
 * different questions:
 *
 *  - `repository.commands` — **what does this package declare?** Every script
 *    name and body, package-scoped, with a precise citation. No semantics.
 *  - `repository.verificationEntrypoints` — **which of those declarations carry
 *    a recognised role, and how could they be invoked?** A projection of the
 *    first, computed by fixed rules.
 *
 * They are kept apart because an unknown semantic role is not an unknown
 * command. A repository may name its test script `abc`, and the snapshot says so
 * truthfully: `abc` is a declared command with no recognised role. Collapsing
 * the two facts would force a choice between hiding that command and inventing
 * a role for it.
 *
 * Neither probe reads a manifest, walks the tree, or inspects a script body. The
 * layout is Issue #37's, extended once with script declarations, and both probes
 * are pure projections of it — so there is exactly one parser, and no two
 * readers of the same file that could disagree.
 */

import { invocationFor, resolvePackageManagers } from "../commands/invocation.js";
import { roleForScriptName } from "../commands/role.js";
import { compareCodeUnits } from "../ordering.js";
import type { DiscoveryProbe, DiscoveryScripts } from "../probe.js";
import type { PackageCommandsEntry, VerificationEntrypointEntry } from "../types.js";

/**
 * Every command every discovered package declares.
 *
 * One fact, one claim, one value. The claim's evidence names every manifest that
 * contributed, so a collection of thirty commands across three packages cites
 * three files rather than pretending to be one source or pretending to be thirty
 * independent ones.
 *
 * Packages appear even when they declare nothing. A package with an empty
 * `scripts` object, and a package whose manifest could not be parsed, are
 * different facts and both belong in the collection: the first is a declaration
 * of nothing, the second is ignorance, and a flat list of commands would be
 * unable to say which was which.
 */
export const commandsProbe: DiscoveryProbe = {
  id: "commands.inventory",
  factId: "repository.commands",
  kind: "declared",
  shape: "value",
  async run(context) {
    const layout = await context.readRepositoryLayout();
    if (layout.scripts.length === 0) {
      // No manifest was discovered at all, so there is no package to declare
      // commands. `no-evidence` rather than a known empty collection: the
      // repository has not said anything yet, and an empty array here would
      // claim it had.
      return {
        status: "not-found",
        evidence: [{ source: ".", detail: "no package manifest was found" }],
      };
    }
    return {
      status: "found",
      value: layout.scripts.map(toPackageCommands),
      evidence: layout.scripts.map((located) => ({
        source: located.manifestPath,
        pointer: "/scripts",
        detail: describeScriptsDetail(located),
      })),
    };
  },
};

/**
 * The subset of declared commands the role grammar recognises.
 *
 * `derived`, not `declared`: the role, the `primary` flag, and the invocation
 * are all computed by fixed rules in this codebase, and calling a computation
 * "declared" would overstate where it came from.
 *
 * The role comes from the **name** and the invocation from the **package
 * manager's** evidence. The body is carried through verbatim and read for
 * nothing — a script named `deploy` whose body is `vitest run` is reported here
 * as a command with no role, which is the single most important behaviour in
 * this file.
 */
export const verificationEntrypointsProbe: DiscoveryProbe = {
  id: "commands.verification",
  factId: "repository.verificationEntrypoints",
  kind: "derived",
  shape: "value",
  async run(context) {
    const layout = await context.readRepositoryLayout();
    const managers = await resolvePackageManagers(context);

    const entrypoints: VerificationEntrypointEntry[] = [];
    const contributing = new Set<string>();
    for (const located of layout.scripts) {
      for (const command of located.commands) {
        const match = roleForScriptName(command.name);
        if (match === undefined) {
          continue;
        }
        const invocation = invocationFor(located.packagePath, command.name, managers);
        entrypoints.push({
          packagePath: located.packagePath,
          script: command.name,
          role: match.role,
          body: command.body,
          primary: match.primary,
          invocation: invocation.invocation,
          invocationStatus: invocation.status,
          source: command.source,
          pointer: command.pointer,
        });
        contributing.add(located.manifestPath);
      }
    }

    if (entrypoints.length === 0) {
      // Not "this repository has no verification entrypoints" — it has none
      // this version recognises. The fact is `no-evidence`, which is ignorance
      // of a role rather than absence of commands, and every manifest that was
      // inspected is cited so the claim is not an unexplained silence.
      return {
        status: "not-found",
        evidence: layout.scripts.map((located) => ({
          source: located.manifestPath,
          detail: "no declared script name matches a recognised verification role",
        })),
      };
    }

    return {
      status: "found",
      value: entrypoints.sort(compareEntrypoints),
      // Cites the declarations the roles were computed over, not the
      // classification itself: the role is a deterministic rule over a name that
      // was already declared, so there is no second source to corroborate and
      // none is invented here. One manifest appearing here is one declaration,
      // not several independent confirmations of the same one.
      evidence: [...contributing].sort(compareCodeUnits).map((manifestPath) => ({
        source: manifestPath,
        pointer: "/scripts",
        detail: "declared script names matched the role grammar",
      })),
    };
  },
};

function toPackageCommands(located: DiscoveryScripts): PackageCommandsEntry {
  return {
    packagePath: located.packagePath,
    scriptsStatus: located.status,
    commands: located.commands,
    unmodelledScripts: located.unmodelled,
    unsupportedReason: located.unsupportedReason,
  };
}

function describeScriptsDetail(located: DiscoveryScripts): string {
  switch (located.status) {
    case "declared":
      return `${String(located.commands.length)} declared script(s)`;
    case "absent":
      return "no scripts field";
    case "unsupported":
      return "scripts field in a form this version does not model";
    case "unobservable":
      return "manifest could not be interpreted";
  }
}

/**
 * Canonical order: package, then role, then script name.
 *
 * All code-unit, through ADR-0045's single shared comparator. A hand-maintained
 * "role order" was considered and rejected — a snapshot is deterministic
 * because one ordering rule governs it, and a second bespoke rule for one
 * collection is somewhere the two will eventually disagree. The human renderer
 * groups for readability; the canonical value does not.
 */
function compareEntrypoints(
  a: VerificationEntrypointEntry,
  b: VerificationEntrypointEntry,
): number {
  return (
    compareCodeUnits(a.packagePath, b.packagePath) ||
    compareCodeUnits(a.role, b.role) ||
    compareCodeUnits(a.script, b.script)
  );
}
