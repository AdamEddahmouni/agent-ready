/**
 * The repository-side view of packages and workspaces, gathered once and then
 * read by several probes.
 *
 * The probes are separate so each is testable on its own, but they would
 * otherwise re-read the same manifests and re-expand the same patterns. This
 * module is that shared, read-only, per-run cache: a value computed from
 * repository content once and reused, so no probe can see a different answer
 * than its neighbour.
 *
 * The walk is deliberately **closed-world**. Packages are found by following
 * declared workspace patterns plus the root manifest, not by scanning the tree
 * for manifests. That is a documented scope decision (ADR-0045 §5), not an
 * oversight: a manifest outside every declaration is not part of any workspace
 * this repository describes, and an unbounded search for them would make
 * discovery cost scale with repository size to answer a question nobody asked.
 */

import { CANONICAL_CONTRACT_FILENAME } from "../../contract/discovery.js";
import { compareCodeUnits } from "../ordering.js";
import type { DiscoveryLayout, DiscoveryProbeContext, DiscoveryScripts } from "../probe.js";
import { safeRead } from "../read.js";
import type { JsonValue, ManifestStatus, PackageEntry, WorkspaceCandidateEntry } from "../types.js";
import { expandPatterns, normalizeWorkspacePattern } from "./expand.js";
import type { ExpansionResult, NormalizedPattern, PatternNormalization } from "./expand.js";
import {
  MANIFEST_FILENAME,
  interpretManifest,
  readManifest,
  readPackageManagerField,
  readScripts,
  unobservableScripts,
  unreadableEntry,
} from "./manifest.js";
import type { ManifestRead, ScriptDeclaration } from "./manifest.js";
import {
  PACKAGE_MANAGER_FIELD,
  PNPM_WORKSPACE_FILE,
  ROOT_MANIFEST,
  isSupportedDeclarationForm,
} from "./packageManager.js";
import {
  PNPM_PACKAGES_KEY,
  WORKSPACES_FIELD,
  parsePackageJsonWorkspaces,
  parsePnpmWorkspaceYaml,
} from "./workspaceDeclaration.js";
import type { WorkspaceDeclarationEntry } from "../types.js";

/** A workspace declaration that was found, with where it came from. */
export interface LocatedDeclaration {
  readonly entry: WorkspaceDeclarationEntry;
  /** Patterns that passed normalization and can be expanded. */
  readonly patterns: readonly NormalizedPattern[];
  /** Patterns rejected as unsafe or malformed, with the reason. */
  readonly rejected: readonly PatternNormalization[];
}

/**
 * Where a package's command declarations were read, and what they say.
 *
 * The manifest path and the package directory are both carried because they are
 * different strings and conflating them would be a defect: `package.json` is the
 * root package's manifest *and* the conventional filename everywhere, so a
 * consumer reading `packagePath` off a manifest path would get `.` for the root
 * by accident rather than by rule.
 */
export interface LocatedScripts {
  readonly manifestPath: string;
  /** Repository-relative package directory; `.` for the root. */
  readonly packagePath: string;
  readonly declaration: ScriptDeclaration;
}

export interface RepositoryLayout {
  /** Every package found, code-unit sorted by path. */
  readonly packages: readonly PackageEntry[];
  /** Declarations found, code-unit sorted by source. */
  readonly declarations: readonly LocatedDeclaration[];
  /**
   * Files inspected for a workspace declaration, whether or not they declared
   * one. Lets a `not-found` fact cite where it looked, which is the difference
   * between "this repository has no workspace" and "nobody checked".
   */
  readonly checkedDeclarationSources: readonly string[];
  /** Expansion of every normalized pattern across every declaration. */
  readonly expansion: ExpansionResult;
  /**
   * The manifest that carries a workspace declaration, or null. A repository
   * can declare a workspace in `pnpm-workspace.yaml` alone, with no declaring
   * manifest at all — which is a real state and not an error.
   */
  readonly workspaceRootManifest: string | null;
  /** Manifest paths discovered, for the package-scoped package-manager probe. */
  readonly manifestPaths: readonly string[];
  /**
   * Manifests that exist but could not be interpreted, as
   * `path -> malformed | unreadable`.
   *
   * Reported separately from a failed probe because the read *succeeded* — it is
   * the document that is broken. It still belongs in the snapshot's completeness
   * accounting, though: a repository whose member manifests cannot be parsed is
   * not a repository discovery fully established, and reporting `complete: true`
   * alongside `manifestStatus: "malformed"` would let a consumer that checks only
   * the coarse signal believe it had the whole picture.
   */
  readonly brokenManifests: readonly { readonly path: string; readonly status: ManifestStatus }[];
  /**
   * `packageManager` fields that are present but in a form this implementation
   * does not model. See `DiscoveryLayout.unmodelledPackageManagers` for why this
   * is collected here rather than by the probe that builds the claims.
   */
  readonly unmodelledPackageManagers: readonly { readonly path: string; readonly raw: unknown }[];
  /**
   * Every discovered manifest's command declarations, code-unit sorted by
   * manifest path.
   *
   * Added by ADR-0046 §11 as an extension of this one authoritative parse, not
   * as a second pass. A command reader that re-read the manifests would be free
   * to disagree with `readRepositoryLayout` about a size cap, a nesting limit,
   * or what "malformed" means — and the two answers would then disagree about
   * the same file in the same snapshot.
   */
  readonly scripts: readonly LocatedScripts[];
}

/**
 * Projects the internal layout onto the shape the probe protocol declares.
 *
 * The probes are written against `DiscoveryLayout` in `probe.ts` rather than
 * against this module, so the probe protocol has no dependency on the package
 * domain that happens to implement it. Keeping the projection explicit is what
 * lets that dependency direction hold.
 */
export function toDiscoveryLayout(layout: RepositoryLayout): DiscoveryLayout {
  return {
    manifestPaths: layout.manifestPaths,
    packages: layout.packages,
    checkedDeclarationSources: layout.checkedDeclarationSources,
    declarations: layout.declarations.map((declaration) => ({
      source: declaration.entry.source,
      form: declaration.entry.form,
      patterns: declaration.entry.patterns,
      unsupportedReason: declaration.entry.unsupportedReason,
      normalizedPatterns: declaration.patterns.map((pattern) => pattern.pattern),
      rejectedPatterns: declaration.rejected
        .filter(
          (rejection): rejection is Extract<PatternNormalization, { ok: false }> => !rejection.ok,
        )
        .map((rejection) => ({ raw: rejection.raw, reason: rejection.reason })),
    })),
    candidates: layout.expansion.candidates,
    truncated: layout.expansion.truncated,
    unreadablePaths: layout.expansion.unreadable,
    workspaceRootManifest: layout.workspaceRootManifest,
    brokenManifests: layout.brokenManifests,
    unmodelledPackageManagers: layout.unmodelledPackageManagers,
    scripts: layout.scripts.map(toDiscoveryScripts),
  };
}

function toDiscoveryScripts(located: LocatedScripts): DiscoveryScripts {
  return {
    manifestPath: located.manifestPath,
    packagePath: located.packagePath,
    status: located.declaration.status,
    commands: located.declaration.commands,
    unmodelled: located.declaration.unmodelled,
    unsupportedReason: located.declaration.unsupportedReason,
  };
}

const ROOT_DIRECTORY = ".";

/**
 * Gathers the package and workspace view of a repository.
 *
 * Every read is bounded and every failure is localized: a malformed member
 * manifest becomes a `malformed` entry and nothing more, and one unreadable
 * directory never prevents the rest of the workspace from being reported.
 */
export async function readRepositoryLayout(
  context: DiscoveryProbeContext,
): Promise<RepositoryLayout> {
  const rootManifestRead = await readManifest(context, ROOT_MANIFEST);
  const { located, checked } = await readDeclarations(context, rootManifestRead);
  const declarations = located;

  const expansion =
    declarations.length === 0
      ? { candidates: [], truncated: false, unreadable: [] }
      : await expandPatterns(
          context,
          declarations.flatMap((declaration) => declaration.patterns),
        );

  const memberPaths = dedupe(
    expansion.candidates
      .filter((candidate) => candidate.present === true)
      .map((candidate) => candidate.path)
      // The root is already represented by the root manifest entry; listing it
      // as its own workspace member would double-count the same package.
      .filter((path) => path !== ROOT_DIRECTORY),
  );

  const packages: PackageEntry[] = [];
  const brokenManifests: { path: string; status: ManifestStatus }[] = [];
  const unmodelledPackageManagers: { path: string; raw: unknown }[] = [];
  const scripts: LocatedScripts[] = [];
  if (rootManifestRead.status !== "absent") {
    packages.push(entryFor(ROOT_DIRECTORY, rootManifestRead));
    scripts.push(locateScripts(ROOT_DIRECTORY, ROOT_MANIFEST, rootManifestRead));
    if (rootManifestRead.status !== "read") {
      brokenManifests.push({ path: ROOT_MANIFEST, status: rootManifestRead.status });
    } else {
      collectUnmodelledManager(ROOT_MANIFEST, rootManifestRead, unmodelledPackageManagers);
    }
  }
  const manifestPaths: string[] = rootManifestRead.status === "absent" ? [] : [ROOT_MANIFEST];

  for (const directory of memberPaths) {
    const manifestPath = joinRelative(directory, MANIFEST_FILENAME);
    const read = await readManifest(context, manifestPath);
    if (read.status === "absent") {
      // A glob matched a directory that holds no manifest. It is a candidate
      // and it is visible in `repository.workspace.candidates`; it is not a
      // package, and a directory named `docs` is not one by virtue of matching.
      continue;
    }
    packages.push(entryFor(directory, read));
    scripts.push(locateScripts(directory, manifestPath, read));
    if (read.status !== "read") {
      brokenManifests.push({ path: manifestPath, status: read.status });
    } else {
      collectUnmodelledManager(manifestPath, read, unmodelledPackageManagers);
    }
    manifestPaths.push(manifestPath);
  }

  return {
    packages: packages.sort(comparePackages),
    declarations,
    checkedDeclarationSources: checked,
    expansion,
    workspaceRootManifest: workspaceRootOf(declarations),
    manifestPaths: dedupe(manifestPaths),
    brokenManifests: brokenManifests.sort((a, b) => compareCodeUnits(a.path, b.path)),
    unmodelledPackageManagers: unmodelledPackageManagers.sort((a, b) =>
      compareCodeUnits(a.path, b.path),
    ),
    scripts: scripts.sort((a, b) => compareCodeUnits(a.manifestPath, b.manifestPath)),
  };
}

/**
 * Records what a manifest's `scripts` field declares.
 *
 * A manifest that never parsed yields `unobservable` rather than an empty list.
 * That distinction is the whole point: a malformed `package.json` does not
 * declare no commands, it declares that its commands could not be established,
 * and reporting the first would be a false claim about the second (ADR-0046 §9).
 */
function locateScripts(
  packagePath: string,
  manifestPath: string,
  read: ManifestRead,
): LocatedScripts {
  return {
    manifestPath,
    packagePath,
    declaration:
      read.status === "read" ? readScripts(read.document, manifestPath) : unobservableScripts(),
  };
}

/**
 * Records a `packageManager` field this implementation will not interpret.
 *
 * The field is kept in the diagnostic rather than turned into a claim. Splitting
 * `workspace:*` at its first `@` would produce a plausible-looking name the
 * repository never wrote, and that is the one thing a coverage gap must never
 * turn into.
 */
function collectUnmodelledManager(
  manifestPath: string,
  read: Extract<ManifestRead, { status: "read" }>,
  into: { path: string; raw: unknown }[],
): void {
  const field = readPackageManagerField(read.document, PACKAGE_MANAGER_FIELD);
  if (field.present && !isSupportedDeclarationForm(field.raw)) {
    into.push({ path: manifestPath, raw: field.raw });
  }
}

/**
 * Reads every workspace declaration the repository makes.
 *
 * Both supported sources are attempted independently, so a repository with
 * `package.json` workspaces *and* a `pnpm-workspace.yaml` yields two
 * declarations rather than one merged list. Merging them would hide exactly the
 * disagreement a messy repository contains, and the two files are separate acts
 * of authorship.
 *
 * Sources that are present but declare no workspace are recorded as *checked*
 * rather than as declarations, so a `not-found` fact can say where it looked. A
 * `pnpm-workspace.yaml` holding only `onlyBuiltDependencies` is a real and
 * common file that declares no workspace, and reporting it as an unsupported
 * declaration would raise a warning on most of the ecosystem for no reason.
 */
async function readDeclarations(
  context: DiscoveryProbeContext,
  rootManifestRead: ManifestRead,
): Promise<{ located: LocatedDeclaration[]; checked: string[] }> {
  const located: LocatedDeclaration[] = [];
  const checked: string[] = [];

  if (rootManifestRead.status === "read") {
    const parsed = parsePackageJsonWorkspaces(ROOT_MANIFEST, rootManifestRead.document);
    checked.push(ROOT_MANIFEST);
    if (parsed !== null) {
      located.push(locate(parsed, (index) => `/${WORKSPACES_FIELD}/${String(index)}`));
    }
  }

  const pnpm = await safeRead(context, PNPM_WORKSPACE_FILE);
  if (pnpm.status === "read") {
    checked.push(PNPM_WORKSPACE_FILE);
    const parsed = parsePnpmWorkspaceYaml(PNPM_WORKSPACE_FILE, pnpm.content);
    if (parsed !== null) {
      located.push(
        locate(parsed, (index) =>
          index === 0 ? `/${PNPM_PACKAGES_KEY}` : `/${PNPM_PACKAGES_KEY}/${String(index)}`,
        ),
      );
    }
  }

  return {
    located: located.sort((a, b) => compareCodeUnits(a.entry.source, b.entry.source)),
    checked,
  };
}

/**
 * Normalizes a declaration's patterns and keeps the rejected ones visible.
 *
 * A pattern the repository wrote but Agent-Ready refuses to expand — because it
 * is absolute, or escapes the root, or uses a glob form outside the ADR-0005
 * subset — is reported as rejected. Silently dropping it would produce a
 * workspace that looks complete and is not, which is the most dangerous kind of
 * wrong.
 */
function locate(
  entry: WorkspaceDeclarationEntry,
  pointerFor: (index: number) => string,
): LocatedDeclaration {
  const patterns: NormalizedPattern[] = [];
  const rejected: PatternNormalization[] = [];
  entry.patterns.forEach((raw, index) => {
    const normalized = normalizeWorkspacePattern(raw, entry.source, pointerFor(index));
    if (normalized.ok) {
      patterns.push(normalized.pattern);
    } else {
      rejected.push(normalized);
    }
  });
  return { entry, patterns, rejected };
}

function entryFor(directory: string, read: ManifestRead): PackageEntry {
  if (read.status === "read") {
    return interpretManifest(directory, read);
  }
  if (read.status === "absent") {
    // Callers check for absence before building an entry: a directory with no
    // manifest is not a package, so there is nothing to describe. Reaching here
    // would mean a caller had already decided a non-package is a package.
    throw new Error("A package entry cannot be built for a manifest that is not present.");
  }
  return unreadableEntry(directory, read.status);
}

/**
 * The manifest that declares the workspace, if any.
 *
 * `null` is a real answer: a pnpm repository can carry its only declaration in
 * `pnpm-workspace.yaml`, and reporting "no workspace root" there is honest
 * rather than a gap.
 */
function workspaceRootOf(declarations: readonly LocatedDeclaration[]): string | null {
  const fromManifest = declarations.find(
    (declaration) =>
      declaration.entry.source === ROOT_MANIFEST && declaration.entry.patterns.length > 0,
  );
  return fromManifest === undefined ? null : ROOT_MANIFEST;
}

function comparePackages(a: PackageEntry, b: PackageEntry): number {
  return a.path === b.path ? 0 : a.path < b.path ? -1 : 1;
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareCodeUnits);
}

/** Joins a repository-relative directory to a child path, `/`-separated. */
export function joinRelative(directory: string, child: string): string {
  if (directory === "." || directory === "") {
    return child;
  }
  return `${directory}/${child}`;
}

export { CANONICAL_CONTRACT_FILENAME };
export type { JsonValue, WorkspaceCandidateEntry };
