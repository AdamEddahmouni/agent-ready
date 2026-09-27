/**
 * Package and workspace probes.
 *
 * Four facts, four independent readings of the same shared layout:
 *
 *  - `repository.packages` â€” which directories hold a manifest. A package *is* a
 *    manifest; membership is a separate fact below.
 *  - `repository.workspace.declarations` â€” what the repository **wrote**,
 *    verbatim and in declaration order. Never an expansion.
 *  - `repository.workspace.candidates` â€” which paths the declared patterns
 *    resolve to, and whether a directory is actually there. A glob match with
 *    no manifest is a candidate and is *not* a package.
 *  - `repository.workspace.members` â€” candidates that hold a readable manifest.
 *
 * Splitting declaration from derivation is the point of the whole exercise. A
 * repository declaring `["packages/*"]` and one declaring `["packages/a",
 * "packages/b"]` are different repositories, and reporting the second for the
 * first would erase the only thing a consumer needs to know about which of them
 * the author actually wrote.
 */

import type { DiscoveryLayout, DiscoveryProbe } from "../probe.js";
import { compareCodeUnits } from "../ordering.js";
import { joinRelative } from "../packages/layout.js";
import { MANIFEST_FILENAME, interpretManifest, readManifest } from "../packages/manifest.js";
import { PNPM_WORKSPACE_FILE, ROOT_MANIFEST } from "../packages/packageManager.js";
import type {
  Evidence,
  PackageEntry,
  WorkspaceDeclarationEntry,
  WorkspaceDeclarationForm,
} from "../types.js";

/** Every directory that holds a manifest, with what the manifest declares. */
export const packagesProbe: DiscoveryProbe = {
  id: "packages.inventory",
  factId: "repository.packages",
  kind: "derived",
  shape: "value",
  async run(context) {
    const layout = await context.readRepositoryLayout();
    if (layout.manifestPaths.length === 0) {
      return {
        status: "not-found",
        evidence: [{ source: ".", detail: "no package manifest was found" }],
      };
    }
    return {
      status: "found",
      value: layout.packages,
      evidence: layout.manifestPaths.map((manifestPath) => ({
        source: manifestPath,
        detail: "package manifest",
      })),
    };
  },
};

/**
 * The workspace declarations the repository makes, unexpanded.
 *
 * Reported even when the form is unsupported and even when the pattern list is
 * empty, because "there is a workspaces key whose value we do not model" and
 * "there is no workspaces key" are different repository states and a consumer
 * needs to tell them apart.
 */
export const workspaceDeclarationsProbe: DiscoveryProbe = {
  id: "workspace.declarations",
  factId: "repository.workspace.declarations",
  kind: "declared",
  shape: "value",
  async run(context) {
    const layout = await context.readRepositoryLayout();
    if (layout.declarations.length === 0) {
      return {
        status: "not-found",
        // Every file that was inspected is cited, so "no workspace here" is a
        // statement about specific files rather than an unexplained silence.
        evidence: noDeclarationEvidence(layout),
      };
    }
    return {
      status: "found",
      value: layout.declarations.map(toDeclarationValue),
      evidence: layout.declarations.map((declaration) => ({
        source: declaration.source,
        pointer: "/workspaces",
        detail: `declared as ${declaration.form}`,
      })),
    };
  },
};

/**
 * Evidence for "no workspace was declared here".
 *
 * Names every inspected file and distinguishes the two ways a file can fail to
 * declare one: it was not there, or it was there and had no workspace key. The
 * second is common and unremarkable â€” a `pnpm-workspace.yaml` that only sets
 * `onlyBuiltDependencies` declares no workspace â€” so it is reported without
 * implying anything is wrong.
 */
function noDeclarationEvidence(layout: DiscoveryLayout): Evidence[] {
  const checked = new Set(layout.checkedDeclarationSources);
  const evidence: Evidence[] = [];
  for (const source of [ROOT_MANIFEST, PNPM_WORKSPACE_FILE]) {
    evidence.push({
      source,
      detail: checked.has(source) ? "present, declares no workspace" : "not present",
    });
  }
  return evidence;
}

/**
 * Which repository paths the declared patterns resolve to.
 *
 * A literal declared path is recorded whether or not it exists, with
 * `present: false` â€” so a workspace declaring `packages/a` and
 * `packages/missing` keeps the gap visible for later drift analysis instead of
 * quietly reporting only the half that worked. `present: null` means the path
 * could not be inspected, which is ignorance and is never reported as absence.
 */
export const workspaceCandidatesProbe: DiscoveryProbe = {
  id: "workspace.candidates",
  factId: "repository.workspace.candidates",
  kind: "derived",
  shape: "value",
  async run(context) {
    const layout = await context.readRepositoryLayout();
    if (layout.declarations.length === 0) {
      return {
        status: "not-found",
        evidence: noDeclarationEvidence(layout),
      };
    }
    return {
      status: "found",
      value: layout.candidates,
      // The declaration sources are always cited, including when the result is
      // an empty list. "Nothing matched" is a claim about the declaration, and
      // a claim that cannot say which declaration was expanded is exactly the
      // kind of unciteable fact the evidence invariant exists to reject.
      evidence: [
        ...layout.declarations.map((declaration) => ({
          source: declaration.source,
          detail: `${String(declaration.normalizedPatterns.length)} pattern(s) expanded`,
        })),
        ...layout.candidates.map((candidate) => ({
          source: candidate.path,
          detail:
            candidate.present === true
              ? `matched ${candidate.pattern}`
              : candidate.present === false
                ? `matched ${candidate.pattern}, but no directory is there`
                : `matched ${candidate.pattern}, but the path could not be inspected`,
        })),
      ],
    };
  },
};

/**
 * Candidates that actually hold a readable manifest.
 *
 * A directory that matched a glob but holds no `package.json` is a candidate
 * and not a member. Reporting it as a package would mean a glob match is
 * enough to make something a package, which is precisely the
 * directory-naming inference the manifest rule exists to prevent.
 */
export const workspaceMembersProbe: DiscoveryProbe = {
  id: "workspace.members",
  factId: "repository.workspace.members",
  kind: "derived",
  shape: "value",
  async run(context) {
    const layout = await context.readRepositoryLayout();
    if (layout.declarations.length === 0) {
      return {
        status: "not-found",
        evidence: noDeclarationEvidence(layout),
      };
    }
    const members: PackageEntry[] = [];
    const failed: string[] = [];
    // Deduplicated by path before anything is read.
    //
    // A directory can be matched by more than one declared pattern — `packages/*`
    // and an explicit `packages/a` in the same declaration, or the same package
    // in `package.json` and in `pnpm-workspace.yaml` — and a member list that
    // repeats it is wrong, not merely untidy. A member is a package, and a
    // package is a manifest at a path; two entries for one manifest report one
    // entity twice, which breaks the property that makes the collection
    // addressable at all: a consumer re-derives entities by `path`, and a
    // duplicated path has no single meaning to re-derive.
    //
    // The provenance is not lost by this. `repository.workspace.candidates`
    // keeps one entry per (source, pattern, path), so the overlap between two
    // declarations stays visible there; and each pattern is still charged its
    // own budget while it is expanded. Deduplicating the *result* is right;
    // dropping the duplicate from the *declared* pattern list would not be,
    // because that list is what the repository wrote.
    const memberPaths = [
      ...new Set(
        layout.candidates
          .filter((candidate) => candidate.present === true)
          .map((candidate) => candidate.path),
      ),
    ].sort(compareCodeUnits);

    for (const path of memberPaths) {
      const manifestPath = joinRelative(path, MANIFEST_FILENAME);
      const read = await readManifest(context, manifestPath);
      if (read.status === "read") {
        members.push(interpretManifest(path, read));
        continue;
      }
      if (read.status === "malformed" || read.status === "unreadable") {
        // The member exists and is known to be a package; only its contents are
        // unknown. Reporting nothing would make a malformed member
        // indistinguishable from a non-package directory, which is the false
        // negative this boundary exists to prevent.
        members.push({
          path,
          name: null,
          nameStatus: "absent",
          private: null,
          version: null,
          manifestStatus: read.status,
        });
        continue;
      }
      failed.push(manifestPath);
    }

    if (members.length === 0 && failed.length > 0) {
      return {
        status: "failed",
        detail: `No workspace member manifest could be read: ${failed.join(", ")}.`,
        evidence: failed.map((path) => ({ source: path, detail: "could not be inspected" })),
      };
    }
    return {
      status: "found",
      value: members,
      // As with candidates, the declaration is always cited: an empty member
      // list is a statement about the declaration, not a statement about
      // nothing, and it has to be able to say which one.
      evidence: [
        ...layout.declarations.map((declaration) => ({
          source: declaration.source,
          detail: "workspace declaration expanded",
        })),
        ...members.map((member) => ({
          source: joinRelative(member.path, MANIFEST_FILENAME),
          detail: `workspace member manifest (${member.manifestStatus})`,
        })),
      ],
    };
  },
};

/**
 * The manifest that carries the workspace declaration.
 *
 * A *value* fact, so a repository with no declaring manifest is `unknown` with
 * reason `no-evidence` â€” the inspection completed and there is nothing to
 * report, which is different from a failed read. A pnpm-only workspace
 * legitimately has none, and that is reported rather than treated as a gap.
 */
export const workspaceRootProbe: DiscoveryProbe = {
  id: "workspace.root",
  factId: "repository.workspace.root",
  kind: "derived",
  shape: "value",
  async run(context) {
    const layout = await context.readRepositoryLayout();
    if (layout.workspaceRootManifest === null) {
      return {
        status: "not-found",
        evidence: noDeclarationEvidence(layout),
      };
    }
    return {
      status: "found",
      value: layout.workspaceRootManifest,
      evidence: [
        {
          source: layout.workspaceRootManifest,
          pointer: "/workspaces",
          detail: "carries the workspace declaration",
        },
      ],
    };
  },
};

/**
 * Projects one located declaration onto the value shape the fact carries.
 *
 * A field-by-field copy rather than a spread on purpose: the published value
 * has to be exactly the four fields the fact declares, so a field added to the
 * internal declaration for some future purpose cannot leak into the snapshot
 * by being forgotten here.
 */
function toDeclarationValue(declaration: {
  source: string;
  form: WorkspaceDeclarationForm;
  patterns: readonly string[];
  unsupportedReason: string | null;
}): WorkspaceDeclarationEntry {
  return {
    source: declaration.source,
    form: declaration.form,
    patterns: declaration.patterns,
    unsupportedReason: declaration.unsupportedReason,
  };
}
