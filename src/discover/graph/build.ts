/**
 * Building the repository graph (ADR-0047).
 *
 * The pipeline is deliberately staged so that each stage is a pure function of
 * the previous one's output:
 *
 * ```text
 *   read repository evidence  (read-only, through DiscoveryProbeContext)
 *              ↓
 *   normalized observations   (source universe, imports, declarations, rules)
 *              ↓
 *   pure graph construction   (this file)
 *              ↓
 *   pure graph validation     (validate.ts)
 *              ↓
 *   snapshot projection       (the caller)
 * ```
 *
 * The only stage that touches the file system is the first, and it does so
 * through the same `DiscoveryProbeContext` every other probe uses — no writer,
 * no process runner, no Git client, no network. Everything after it is a pure
 * function of already-read text, which is what makes the graph testable
 * against a fixture without a repository on disk and what makes "the same
 * content produces the same bytes" checkable rather than aspirational.
 *
 * Nothing in this file executes a repository's source. The parser builds a
 * syntax tree and nothing else; there is no `eval`, no `Function`, no dynamic
 * import of repository content, and no `require` of anything the repository
 * wrote.
 */

import ts from "typescript";
import { compareCodeUnits } from "../ordering.js";
import type { DiscoveryLayout, DiscoveryManifest, DiscoveryProbeContext } from "../probe.js";
import { safeRead } from "../read.js";
import type { PackageEntry } from "../types.js";
import { extractImports } from "./imports.js";
import type { ExtractedImport } from "./imports.js";
import { adaptersFor, SUPPORTED_LOCKFILES } from "./lockfiles.js";
import type { LockfileResolution, ResolvedEntry } from "./lockfiles.js";
import { CODEOWNERS_LOCATIONS, ownersForPath, readOwnershipSurface } from "./ownership.js";
import {
  LineIndexCache,
  REPOSITORY_ROOT,
  isRepositoryRelativePath,
  isWithinDirectory,
} from "./provenance.js";
import { resolveSpecifier } from "./resolve.js";
import type { ResolutionContext, WorkspaceNames } from "./resolve.js";
import {
  MAX_GRAPH_EDGES,
  MAX_GRAPH_NODES,
  MAX_IMPORTS_PER_FILE,
  MAX_SOURCE_FILE_BYTES,
  MAX_TOTAL_SOURCE_BYTES,
  SUPPORTED_SOURCE_EXTENSIONS,
  isSupportedSourcePath,
  selectSourceUniverse,
} from "./sourceUniverse.js";
import type { SourceUniverseResult } from "./sourceUniverse.js";
import type {
  DependencyDeclaration,
  DependencyEdge,
  ExternalDependencyNode,
  GraphCounts,
  GraphEdge,
  GraphNode,
  GraphNodeId,
  ImportEdge,
  OwnershipEdge,
  OwnershipSurface,
  PackageNode,
  RepositoryGraph,
  SourceLocation,
  SourceUniverse,
} from "./types.js";

export type { CodeownersRule } from "./ownership.js";
export { parseCodeowners } from "./ownership.js";
export { barePackageNameOf } from "./resolve.js";

/**
 * Every observation the builder made outside the graph itself.
 *
 * These are the conditions a consumer of `RepositoryGraph` cannot see in the
 * graph — a bound that stopped collection, a config that could not be used, a
 * source file that was too large, a file whose syntax did not parse — and they
 * become diagnostics. Keeping them out of the graph is what lets `graph.complete`
 * mean one thing: the graph is complete, and these are the reasons it might not
 * be.
 */
export interface GraphObservations {
  readonly diagnostics: readonly GraphObservation[];
  /** True when anything at all was incomplete. */
  readonly incomplete: boolean;
}

export type GraphObservation =
  | {
      readonly kind: "unresolved-import";
      readonly path: string;
      readonly line: number;
      readonly specifier: string;
      readonly reason: string;
    }
  | {
      readonly kind: "partial";
      readonly summary: string;
      readonly detail: string;
      readonly path?: string;
      readonly line?: number;
    }
  | {
      readonly kind: "unsupported";
      readonly summary: string;
      readonly detail: string;
      readonly path?: string;
      readonly line?: number;
    };

/**
 * The graph, what the builder observed, and the line counts a citation is
 * checked against.
 *
 * `lineCounts` is returned rather than recomputed by the validator because the
 * validator must not read: it is a pure function, and the one thing it needs
 * from outside the graph is how many lines each cited file has. Handing it a
 * map keeps it pure and keeps the "a citation into a file nobody read is a
 * violation" rule checkable.
 */
export interface GraphResult {
  readonly graph: RepositoryGraph;
  readonly observations: GraphObservations;
  /** Lines per file this run read, for the graph's own provenance checks. */
  readonly lineCounts: ReadonlyMap<string, number>;
}

/** Everything the builder needs beyond the file system. */
export interface GraphInputs {
  readonly layout: DiscoveryLayout;
  /**
   * Reads a repository-relative file's text, for the lockfiles and the
   * ownership surface.
   *
   * Sources go through the probe context instead, so a read failure on one
   * source file is a per-file condition rather than a whole-pass failure.
   */
  readonly readTextFile: (
    path: string,
  ) => Promise<{ ok: true; content: string } | { ok: false; detail: string }>;
}

/**
 * Reads the evidence and builds the graph.
 *
 * One entry point, so there is exactly one ordering of the reads and one
 * determinism argument to defend.
 */
export async function buildRepositoryGraph(
  context: DiscoveryProbeContext,
  inputs: GraphInputs,
): Promise<GraphResult> {
  const cache = new LineIndexCache(new Map());
  const observations: GraphObservation[] = [];
  // An unresolved import is repository information, not an incompleteness of
  // this run: the graph did everything it said it would and one specifier had no
  // target. Every other observation means something was not established, so
  // `incomplete` is *derived* from the observations rather than kept as a
  // separate flag that could disagree with them.
  const note = (observation: GraphObservation): void => {
    observations.push(observation);
  };

  const packages = inputs.layout.packages;
  const universe = await selectSourceUniverse(
    context,
    packages.map((entry) => ({ path: entry.path })),
  );
  recordUniverse(universe, note);

  const sources = await readSourceFiles(
    context,
    universe.files.map((file) => file.path),
    cache,
    note,
  );
  const workspaceNames = workspaceNamesOf(packages);
  const resolutionContext: ResolutionContext = {
    repoRoot: context.repoRoot,
    resolvable: resolvablePaths(universe, inputs.layout),
    workspaceNames,
    resolutions: universe.resolutions,
  };
  const lockfiles = await readLockfiles(inputs, cache, note);

  const nodes = new Map<GraphNodeId, GraphNode>();
  const edges: GraphEdge[] = [];
  for (const entry of packages) {
    const node = packageNodeFor(entry, inputs.layout.manifests);
    if (node !== null) {
      nodes.set(node.id, node);
    }
  }
  const modulePaths = [...sources.keys()].sort(compareCodeUnits);
  const packageOf = new Map(universe.files.map((file) => [file.path, file.packagePath]));
  const packagePaths = [...new Set(packages.map((entry) => entry.path))].sort(compareCodeUnits);

  // Dependency edges are built **before** import edges, and the order is
  // load-bearing rather than incidental. An `external-dependency` node cites the
  // site that introduced it, and a manifest declaration is a stronger
  // declaration of a package name than an import of it: if an import ran first,
  // every dependency node in the graph would cite whichever module happened to
  // be read first instead of the line the manifest wrote the name on.
  edges.push(...dependencyEdgesFor(inputs.layout.manifests, workspaceNames, lockfiles, nodes));

  for (const path of modulePaths) {
    const owned = sources.get(path);
    if (owned === undefined) {
      continue;
    }
    const packagePath = packageOf.get(path) ?? REPOSITORY_ROOT;
    nodes.set(moduleId(path), {
      id: moduleId(path),
      kind: "module",
      path,
      packagePath,
      provenance: { source: path, line: 1 },
      ownership: { status: "unowned", policy: { status: "absent", source: null } },
    });
    for (const extracted of owned.imports) {
      const edge = importEdgeFor(
        extracted,
        path,
        packagePath,
        resolutionContext,
        nodes,
        packagePaths,
      );
      edges.push(edge);
      if (edge.resolution.status === "unresolved") {
        note({
          kind: "unresolved-import",
          path,
          line: extracted.provenance.line,
          specifier: extracted.specifier,
          reason: edge.resolution.reason,
        });
      }
    }
  }

  const ownership = await applyOwnership(nodes, edges, inputs, cache, note);

  const orderedNodes = [...nodes.values()].sort((a, b) => compareCodeUnits(a.id, b.id));
  const orderedEdges = [...edges].sort(compareEdges).slice(0, MAX_GRAPH_EDGES);
  const bounded = orderedEdges.length < edges.length;
  if (bounded) {
    note({
      kind: "partial",
      summary: "The dependency graph stopped at its edge bound.",
      detail: `The graph holds at most ${String(MAX_GRAPH_EDGES)} edges; ${String(edges.length - orderedEdges.length)} were dropped after sorting, so the edges that survive are the same on every run.`,
    });
  }
  const nodesBounded = orderedNodes.length > MAX_GRAPH_NODES;
  const finalNodes = nodesBounded ? orderedNodes.slice(0, MAX_GRAPH_NODES) : orderedNodes;
  if (nodesBounded) {
    note({
      kind: "partial",
      summary: "The dependency graph stopped at its node bound.",
      detail: `The graph holds at most ${String(MAX_GRAPH_NODES)} nodes; ${String(orderedNodes.length - MAX_GRAPH_NODES)} were dropped after sorting, so the nodes that survive are the same on every run.`,
    });
  }

  const incomplete = observations.some((observation) => observation.kind !== "unresolved-import");
  const graph: RepositoryGraph = {
    nodes: finalNodes,
    edges: orderedEdges,
    sourceUniverse: describeUniverse(universe),
    ownership,
    counts: countGraph(finalNodes, orderedEdges),
    complete: !incomplete && !universe.truncated && !nodesBounded && !bounded,
    truncatedBy: truncationLabel(universe.truncatedBy, nodesBounded, bounded),
  };
  return {
    graph,
    observations: { diagnostics: observations, incomplete },
    lineCounts: citedLineCounts(inputs, cache),
  };
}

/**
 * Lines per file the graph cites.
 *
 * Manifests come from the layout's own count; sources, lockfiles, and the
 * ownership surface come from the line cache the read pass filled. A file
 * absent from this map is a file the validator rejects a citation into, which is
 * the point: an uncited fact must fail loudly rather than enter the graph
 * looking legitimate.
 */
function citedLineCounts(inputs: GraphInputs, cache: LineIndexCache): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const manifest of inputs.layout.manifests) {
    if (manifest.lineCount > 0) {
      counts.set(manifest.manifestPath, manifest.lineCount);
    }
  }
  for (const [path, lineCount] of cache.lineCounts()) {
    counts.set(path, lineCount);
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

/** The graph id of a package, keyed by its canonical directory. */
export function packageId(path: string): GraphNodeId {
  return `package:${path}`;
}

/** The graph id of a module, keyed by its repository-relative path. */
export function moduleId(path: string): GraphNodeId {
  return `module:${path}`;
}

/** The graph id of an external dependency, keyed by its declared name. */
export function dependencyId(name: string): GraphNodeId {
  return `dependency:${name}`;
}

/** The graph id of an owner, keyed by the token the CODEOWNERS file wrote. */
export function ownerId(identity: string): GraphNodeId {
  return `owner:${identity}`;
}

/**
 * A package node, cited to the line its manifest declares its name on.
 *
 * The name's property line when the manifest declares one, and line 1 when it
 * does not — which is the line the document's opening brace is on, and which
 * genuinely supports the claim "this manifest exists". Either way the citation
 * is a real declaration line rather than a placeholder.
 */
function packageNodeFor(
  entry: PackageEntry,
  manifests: readonly DiscoveryManifest[],
): PackageNode | null {
  const manifest = manifests.find((candidate) => candidate.packagePath === entry.path);
  if (manifest?.status !== "read") {
    // A package whose manifest was never read is not admitted. There is no
    // declaration to cite, and a node whose provenance is a fabrication is
    // exactly what this record refuses.
    return null;
  }
  const namePointer = "/name";
  const located = manifest.locations.get(namePointer);
  const provenance: SourceLocation =
    located === undefined
      ? { source: manifest.manifestPath, line: 1, pointer: namePointer }
      : { ...located, pointer: namePointer };
  return {
    id: packageId(entry.path),
    kind: "package",
    path: entry.path,
    name: entry.name,
    provenance,
    ownership: { status: "unowned", policy: { status: "absent", source: null } },
  };
}

// ---------------------------------------------------------------------------
// Source files
// ---------------------------------------------------------------------------

interface ReadSource {
  readonly imports: readonly ExtractedImport[];
}

/**
 * Reads every source file in the universe, under the byte bounds.
 *
 * One file that is too large, unreadable, or syntactically broken costs that
 * file's edges and nothing else — the same failure boundary ADR-0045 §9
 * established for a manifest, applied to a source file. Nothing is skipped
 * silently: each costs a published observation.
 */
async function readSourceFiles(
  context: DiscoveryProbeContext,
  paths: readonly string[],
  cache: LineIndexCache,
  note: (observation: GraphObservation) => void,
): Promise<Map<string, ReadSource>> {
  const read = new Map<string, ReadSource>();
  let totalBytes = 0;
  for (const path of paths) {
    if (!isSupportedSourcePath(path) || !isRepositoryRelativePath(path)) {
      continue;
    }
    const outcome = await safeRead(context, path);
    if (outcome.status === "absent") {
      note({
        kind: "partial",
        summary: `A file in the source universe could not be read: ${path}.`,
        detail: "The module node and its import edges are absent; every other file is unaffected.",
        path,
      });
      continue;
    }
    if (outcome.status === "failed") {
      note({
        kind: "partial",
        summary: `A file in the source universe could not be read: ${path}.`,
        detail: outcome.detail,
        path,
      });
      continue;
    }
    const bytes = Buffer.byteLength(outcome.content, "utf8");
    if (bytes > MAX_SOURCE_FILE_BYTES) {
      note({
        kind: "partial",
        summary: `A source file is larger than this version parses: ${path}.`,
        detail: `The file is ${String(bytes)} bytes, above the ${String(MAX_SOURCE_FILE_BYTES)} byte limit, so it was not parsed and contributes no module node.`,
        path,
      });
      continue;
    }
    if (totalBytes + bytes > MAX_TOTAL_SOURCE_BYTES) {
      note({
        kind: "partial",
        summary: "Graph construction stopped at its total source-size bound.",
        detail: `Reading further source files would pass ${String(MAX_TOTAL_SOURCE_BYTES)} bytes. The files already read are unaffected; the ones after the bound are not in the graph.`,
      });
      break;
    }
    totalBytes += bytes;
    cache.remember(path, outcome.content);
    const extracted = extractImports(path, outcome.content, cache);
    if (extracted.partial) {
      note({
        kind: "partial",
        summary: `A source file did not parse cleanly: ${path}.`,
        detail: `The parser reported ${String(extracted.diagnosticCount)} syntax problem(s). Its import edges are reported where the syntax tree gave a reliable position, and the graph is marked incomplete; a type error is not a syntax problem and is not reported here.`,
        path,
      });
    }
    if (extracted.truncated) {
      note({
        kind: "partial",
        summary: `A source file has more import declarations than this version extracts: ${path}.`,
        detail: `At most ${String(MAX_IMPORTS_PER_FILE)} import declarations are read from one file. The graph is marked incomplete, and the ones that survive are the first in source order on every run.`,
        path,
      });
    }
    read.set(path, { imports: extracted.imports });
  }
  return read;
}

/** Reached when a source file is absent from the universe it was selected from. */

// ---------------------------------------------------------------------------
// Import edges
// ---------------------------------------------------------------------------

function importEdgeFor(
  extracted: ExtractedImport,
  fromPath: string,
  packagePath: string,
  context: ResolutionContext,
  nodes: Map<GraphNodeId, GraphNode>,
  packagePaths: readonly string[],
): ImportEdge {
  const resolution =
    extracted.unsupportedReason === null
      ? resolveSpecifier(extracted.specifier, fromPath, packagePath, context)
      : { kind: "unresolved" as const, reason: extracted.unsupportedReason };

  const published = publishResolution(resolution, extracted, nodes, packagePaths);
  return {
    id: importEdgeId(fromPath, extracted, published.targetId),
    kind: "imports",
    source: moduleId(fromPath),
    specifier: extracted.specifier,
    syntax: extracted.syntax,
    typeOnly: extracted.typeOnly,
    resolution: published.resolution,
    provenance: extracted.provenance,
  };
}

/** The target a resolution produced, as a graph id, or null. */
interface PublishedResolution {
  readonly resolution: ImportEdge["resolution"];
  readonly targetId: GraphNodeId | null;
}

/**
 * Turns a resolution into the edge's `resolution` variant, admitting the target
 * node when one is needed.
 *
 * An `external-dependency` node is admitted here rather than in a separate
 * pass, so a node is created only by a declaration that needs it — a name the
 * repository never writes never becomes a node. Its provenance is the
 * **declaring site**: the manifest declaration when one exists, and otherwise
 * the import site that first made the name visible. Both are real lines.
 */
function publishResolution(
  resolution: ReturnType<typeof resolveSpecifier>,
  extracted: ExtractedImport,
  nodes: Map<GraphNodeId, GraphNode>,
  packagePaths: readonly string[],
): PublishedResolution {
  switch (resolution.kind) {
    case "module": {
      const id = moduleId(resolution.path);
      if (!nodes.has(id)) {
        // A resolved target the universe did not list — a `.json` module, a
        // declaration file, a file a `tsconfig` excluded. It is still a real
        // in-repository file and therefore a real target: demoting it would
        // invent a problem the repository does not have.
        nodes.set(id, {
          id,
          kind: "module",
          path: resolution.path,
          packagePath: containingPackage(resolution.path, packagePaths),
          provenance: { source: resolution.path, line: 1 },
          ownership: { status: "unowned", policy: { status: "absent", source: null } },
        });
      }
      return {
        resolution: { status: "module", target: id, targetPath: resolution.path },
        targetId: id,
      };
    }
    case "package": {
      const id = packageId(resolution.packagePath);
      return {
        resolution: { status: "package", target: id, subpath: resolution.subpath },
        targetId: id,
      };
    }
    case "dependency": {
      const id = dependencyId(resolution.name);
      if (!nodes.has(id)) {
        nodes.set(id, {
          id,
          kind: "external-dependency",
          name: resolution.name,
          provenance: { source: extracted.provenance.source, line: extracted.provenance.line },
        });
      }
      return { resolution: { status: "dependency", target: id }, targetId: id };
    }
    case "platform":
      return { resolution: { status: "platform" }, targetId: null };
    case "unresolved":
      return {
        resolution: { status: "unresolved", reason: resolution.reason },
        targetId: null,
      };
  }
}

/**
 * The package a file belongs to: the deepest discovered package root that
 * contains it.
 *
 * Longest-path containment, never discovery order — which is what stops a
 * root package from swallowing a workspace package's files. Ties are broken
 * code-unit, so overlapping roots resolve the same way on every run.
 */
function containingPackage(path: string, packagePaths: readonly string[]): string {
  let best = REPOSITORY_ROOT;
  for (const candidate of packagePaths) {
    if (candidate === REPOSITORY_ROOT) {
      continue;
    }
    if (!isWithinDirectory(path, candidate)) {
      continue;
    }
    if (candidate.length > best.length || best === REPOSITORY_ROOT) {
      best = candidate;
    }
  }
  return best;
}

/**
 * The id of one import declaration.
 *
 * Built from the source module, the target, and the declaration's own line and
 * column, so two declarations of the same specifier on different lines are two
 * edges with two citations rather than one edge that lost a line. The position
 * is at the end so the reading order is "who imports what, from where".
 */
function importEdgeId(
  fromPath: string,
  extracted: ExtractedImport,
  targetId: GraphNodeId | null,
): GraphNodeId {
  const target = targetId ?? `unresolved:${extracted.specifier}`;
  const column = extracted.provenance.column ?? 0;
  return `import:${moduleId(fromPath)}->${target}@${String(extracted.provenance.line)}:${String(column)}`;
}

/**
 * Canonical order for edges: code-unit by id.
 *
 * Id order alone, and not "by kind, then by id". Every edge id begins with its
 * kind (`import:`, `dependency:`, `ownership:`), so id order already groups the
 * kinds while giving the validator one unambiguous rule to check — and one rule
 * is what stops two orderings from disagreeing about which edges survive a
 * bound.
 */
function compareEdges(a: GraphEdge, b: GraphEdge): number {
  return compareCodeUnits(a.id, b.id);
}

// ---------------------------------------------------------------------------
// Dependency edges
// ---------------------------------------------------------------------------

/** One lockfile's resolutions for one importer, with where it was read from. */
interface LoadedLockfile {
  readonly path: string;
  readonly manager: string;
  readonly resolution: LockfileResolution;
}

async function readLockfiles(
  inputs: GraphInputs,
  cache: LineIndexCache,
  note: (observation: GraphObservation) => void,
): Promise<readonly LoadedLockfile[]> {
  const loaded: LoadedLockfile[] = [];
  for (const path of SUPPORTED_LOCKFILES) {
    const adapters = adaptersFor(path);
    if (adapters.length === 0) {
      continue;
    }
    const outcome = await inputs.readTextFile(path);
    if (!outcome.ok) {
      continue;
    }
    cache.remember(path, outcome.content);
    for (const adapter of adapters) {
      const resolution = adapter.resolve(path, outcome.content, REPOSITORY_ROOT);
      loaded.push({ path, manager: adapter.manager, resolution });
      if (resolution.status === "unsupported" && resolution.detail !== null) {
        note({
          kind: "unsupported",
          summary: `A lockfile is in a format this version does not model: ${path}.`,
          detail: resolution.detail,
          path,
          line: 1,
        });
      }
    }
  }
  return loaded;
}

/**
 * One dependency edge per (package, dependency name).
 *
 * `declarations` is an array and is never empty, because a name can genuinely
 * appear in two of the four dependency fields and choosing one would let object
 * order pick a winner — the failure ADR-0045 §3 exists to prevent. The
 * edge-level `provenance` is the first declaration in code-unit order, which is
 * deterministic and is a real line, and every other declaration keeps its own.
 */
function dependencyEdgesFor(
  manifests: readonly DiscoveryManifest[],
  workspaceNames: WorkspaceNames,
  lockfiles: readonly LoadedLockfile[],
  nodes: Map<GraphNodeId, GraphNode>,
): DependencyEdge[] {
  const edges: DependencyEdge[] = [];
  for (const manifest of manifests) {
    if (manifest.status !== "read" || !isRepositoryRelativePath(manifest.packagePath)) {
      // A manifest that never parsed has *unknown* dependency declarations, not
      // zero of them, and this type has no way to say that — so the package
      // contributes no dependency edges and the manifest's own failure is
      // published by the layout. That is the honest degradation, and it is why
      // ADR-0045 §9's per-path failure boundary matters here.
      continue;
    }
    const byName = new Map<string, DependencyDeclaration[]>();
    for (const declaration of manifest.dependencies) {
      const existing = byName.get(declaration.name);
      if (existing === undefined) {
        byName.set(declaration.name, [{ ...declaration }]);
      } else {
        existing.push({ ...declaration });
      }
    }
    for (const name of [...byName.keys()].sort(compareCodeUnits)) {
      const declarations = (byName.get(name) ?? []).sort((a, b) =>
        compareCodeUnits(a.pointer, b.pointer),
      );
      const first = declarations[0];
      if (first === undefined) {
        continue;
      }
      const workspacePath = workspaceNames.get(name);
      const targetMissing =
        isWorkspaceProtocol(first.declaredSpecifier) && workspacePath === undefined;
      const targetId =
        workspacePath === undefined
          ? admitDependencyNode(nodes, name, first.provenance)
          : packageId(workspacePath);
      edges.push({
        id: `dependency:${packageId(manifest.packagePath)}->${targetId}`,
        kind: "package-depends-on",
        source: packageId(manifest.packagePath),
        target: targetId,
        declarations,
        resolution: resolveDependency(name, lockfiles),
        provenance: first.provenance,
        targetMissing,
      });
    }
  }
  return edges;
}

/**
 * True for a `workspace:`-protocol specifier.
 *
 * The prefix is the whole test. pnpm and Yarn both write it, and a dependency
 * written that way is a declaration about a package in this repository — so a
 * missing target is a repository condition worth publishing rather than a
 * dependency on something in a registry.
 */
function isWorkspaceProtocol(specifier: string): boolean {
  return specifier.startsWith("workspace:");
}

/**
 * Admits an external-dependency node, choosing a deterministic provenance.
 *
 * A manifest declaration beats an import site, and an import site that already
 * admitted the node is never overwritten by a later one — so the node cites the
 * *first* site that introduced it in the builder's fixed order (manifests before
 * imports, code-unit within each). This is a tie-break between sites that
 * introduce the same node, not a choice between conflicting claims about it, and
 * every site keeps its own citation on the edge that produced it.
 */
function admitDependencyNode(
  nodes: Map<GraphNodeId, GraphNode>,
  name: string,
  provenance: SourceLocation,
): GraphNodeId {
  const id = dependencyId(name);
  const existing = nodes.get(id);
  if (existing !== undefined) {
    return id;
  }
  const node: ExternalDependencyNode = {
    id,
    kind: "external-dependency",
    name,
    provenance: { source: provenance.source, line: provenance.line, pointer: provenance.pointer },
  };
  nodes.set(id, node);
  return id;
}

/**
 * What lockfile evidence established about a dependency's version.
 *
 * Four states, each named. `no-evidence` is not an error: lockfile absence is
 * not declaration absence, and the declaration survives untouched in every one
 * of these branches. The resolved version, when there is one, cites the
 * **lockfile** line — never the manifest line, which answers a different
 * question.
 */
function resolveDependency(
  name: string,
  lockfiles: readonly LoadedLockfile[],
): DependencyEdge["resolution"] {
  const usable = lockfiles.filter((lockfile) => lockfile.resolution.status === "resolved");
  for (const lockfile of usable) {
    const entry: ResolvedEntry | undefined = lockfile.resolution.versions.get(name);
    if (entry !== undefined) {
      return { status: "resolved", version: entry.version, provenance: entry.provenance };
    }
  }
  if (usable.length > 0) {
    // A lockfile was read and has no entry for this dependency. "unresolved" is
    // a real state and is not "the dependency is broken": a stale lockfile and a
    // deliberately un-installed one look the same from here, and calling either
    // of them broken would be a claim this version cannot support.
    return { status: "unresolved" };
  }
  const unsupported = lockfiles.find((lockfile) => lockfile.resolution.status !== "resolved");
  if (unsupported !== undefined) {
    return {
      status: "unsupported",
      source: unsupported.path,
      detail:
        unsupported.resolution.detail ?? "The lockfile is in a form this version does not model.",
    };
  }
  return { status: "no-evidence" };
}

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------

/**
 * Reads the ownership surface, matches every subject, and attaches the result.
 *
 * The subject's own provenance stays on its node; the **winning rule's** line
 * goes on the `owned-by` edge. Neither is lost in the other, because a consumer
 * that only wants to know "who owns this" and a consumer that wants to know
 * "what made me say so" are asking different questions and both are answerable.
 */
async function applyOwnership(
  nodes: Map<GraphNodeId, GraphNode>,
  edges: GraphEdge[],
  inputs: GraphInputs,
  cache: LineIndexCache,
  note: (observation: GraphObservation) => void,
): Promise<OwnershipSurface> {
  const surface = await readOwnershipSurface(async (path) => {
    const outcome = await inputs.readTextFile(path);
    if (outcome.ok) {
      // Remembered so the validator can range-check a rule's line against the
      // file it came from; a citation into a file this run never read is a
      // violation rather than an accepted default.
      cache.remember(path, outcome.content);
      return { status: "read", content: outcome.content };
    }
    return { status: "absent" };
  });

  if (surface.file === null) {
    // No supported CODEOWNERS file: an ownership surface of zero rules, and
    // every subject explicitly unowned. That is a complete, successful answer
    // rather than a failure, and no owner is invented for it.
    return {
      status: surface.detail === null ? "absent" : "unreadable",
      source: surface.detail === null ? null : (CODEOWNERS_LOCATIONS[0] ?? null),
      rules: 0,
      unsupportedPatterns: [],
      detail: surface.detail,
    };
  }
  const file = surface.file;
  for (const unsupported of file.unsupported) {
    note({
      kind: "unsupported",
      summary: `A CODEOWNERS rule in ${file.path} is in a form this version does not model.`,
      detail: unsupported.reason,
      path: file.path,
      line: unsupported.line,
    });
  }

  const subjects = [...nodes.values()]
    .filter((node) => node.kind === "module" || node.kind === "package")
    .sort((a, b) => compareCodeUnits(a.id, b.id));
  for (const subject of subjects) {
    const path = subject.kind === "module" ? subject.path : manifestPathOf(subject.path);
    const match = ownersForPath(file.rules, path);
    if (match === undefined) {
      continue;
    }
    const ownerIds: GraphNodeId[] = [];
    for (const owner of match.rule.owners) {
      const id = ownerId(owner);
      ownerIds.push(id);
      if (!nodes.has(id)) {
        nodes.set(id, {
          id,
          kind: "owner",
          identity: owner,
          provenance: { source: file.path, line: match.rule.line },
        });
      }
      const edgeId = `ownership:${subject.id}->${id}`;
      if (edges.some((edge) => edge.id === edgeId)) {
        continue;
      }
      const edge: OwnershipEdge = {
        id: edgeId,
        kind: "owned-by",
        source: subject.id,
        target: id,
        provenance: { source: file.path, line: match.rule.line },
        rule: match.rule.pattern,
      };
      edges.push(edge);
    }
    nodes.set(subject.id, { ...subject, ownership: { status: "owned", ownerIds } });
  }

  return {
    status: "present",
    source: file.path,
    rules: file.rules.length,
    unsupportedPatterns: file.unsupported,
    detail: null,
  };
}

/** The manifest path a package node is matched against for ownership. */
function manifestPathOf(packagePath: string): string {
  return packagePath === REPOSITORY_ROOT ? "package.json" : `${packagePath}/package.json`;
}

// ---------------------------------------------------------------------------
// Supporting observations
// ---------------------------------------------------------------------------

/** Workspace package names, from the discovered manifests. */
function workspaceNamesOf(packages: readonly PackageEntry[]): WorkspaceNames {
  const names = new Map<string, string>();
  for (const entry of [...packages].sort((a, b) => compareCodeUnits(a.path, b.path))) {
    if (entry.name === null || entry.nameStatus !== "declared") {
      continue;
    }
    // First path in code-unit order wins a duplicate name. Two packages
    // declaring one name is a repository inconsistency, and resolving it by
    // discovery order would make the answer depend on the walk.
    if (!names.has(entry.name)) {
      names.set(entry.name, entry.path);
    }
  }
  return names;
}

/**
 * Every path a resolution may land on: the universe's source files, the
 * discovered manifests, and every directory they imply.
 *
 * The set is what the synchronous resolution host can see, and building it from
 * what discovery already read is what keeps the host repository-fenced without
 * a second tree walk.
 */
function resolvablePaths(
  universe: SourceUniverseResult,
  layout: DiscoveryLayout,
): ReadonlySet<string> {
  const paths = new Set(universe.resolvable);
  for (const file of universe.files) {
    paths.add(file.path);
  }
  // A discovered manifest joins the set so the resolver can find a workspace
  // package's `exports` map. It joins as a *path*, not as a module node: a
  // manifest is not code, and nothing imports it.
  for (const manifest of layout.manifestPaths) {
    paths.add(manifest);
  }
  return paths;
}

/** Publishes the conditions the universe selector observed. */
function recordUniverse(
  universe: SourceUniverseResult,
  note: (observation: GraphObservation) => void,
): void {
  for (const unusable of universe.unusableConfigs) {
    note({
      kind: "partial",
      summary: `A TypeScript configuration was not used: ${unusable.source}.`,
      detail: unusable.reason,
      path: unusable.source,
    });
  }
  for (const pattern of universe.unsupportedPatterns) {
    note({
      kind: "unsupported",
      summary: `A TypeScript configuration pattern is outside the supported glob subset: ${pattern.source}.`,
      detail: `The pattern ${JSON.stringify(pattern.pattern)} was not applied, so this version cannot say what the file universe it names would have been. It was reported rather than approximated.`,
      path: pattern.source,
    });
  }
  if (universe.truncated) {
    note({
      kind: "partial",
      summary: "Source-file selection stopped at a bound.",
      detail: `Selection stopped at ${universe.truncatedBy ?? "a bound"}, after the remaining candidates were sorted, so the files that survive are the same on every run.`,
    });
  }
}

/** The published description of how the module universe was chosen. */
function describeUniverse(universe: SourceUniverseResult): SourceUniverse {
  const mode = new Set(
    [...universe.resolutions.values()].map((resolution) => resolution.moduleResolution),
  );
  return {
    strategy: universe.strategy,
    tsconfigs: universe.tsconfigs,
    resolutionMode: [...mode]
      .sort((a, b) => a - b)
      .map((value) => resolutionModeName(value))
      .join(","),
    extensions: SUPPORTED_SOURCE_EXTENSIONS,
    files: universe.files.map((file) => file.path),
    truncated: universe.truncated,
  };
}

/**
 * The name TypeScript gives a module-resolution mode.
 *
 * A number would be stable but unreadable, and `resolutionMode: "99"` in a
 * snapshot is a thing nobody can check against their own `tsconfig.json`. When
 * more than one mode is in force — a monorepo whose packages differ — the
 * names are joined so the reader sees that they differ.
 */
function resolutionModeName(value: ts.ModuleResolutionKind): string {
  const name = ts.ModuleResolutionKind[value];
  return typeof name === "string" ? name : String(value);
}

/**
 * Which bound stopped the graph, named.
 *
 * The universe's own bound wins when it fired, because it is the first thing
 * that cost coverage. `null` when nothing was dropped, so "the graph stopped at
 * a bound" and "the graph is whole" are not the same value.
 */
function truncationLabel(
  fromUniverse: string | null,
  nodesBounded: boolean,
  edgesBounded: boolean,
): string | null {
  if (fromUniverse !== null) {
    return fromUniverse;
  }
  if (nodesBounded) {
    return `MAX_GRAPH_NODES (${String(MAX_GRAPH_NODES)})`;
  }
  return edgesBounded ? `MAX_GRAPH_EDGES (${String(MAX_GRAPH_EDGES)})` : null;
}

/** The coarse counts a reader wants before reading the whole graph. */
function countGraph(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): GraphCounts {
  const byKind = (kind: GraphNode["kind"]): number =>
    nodes.filter((node) => node.kind === kind).length;
  const importEdges = edges.filter((edge): edge is ImportEdge => edge.kind === "imports");
  const dependencyEdges = edges.filter(
    (edge): edge is DependencyEdge => edge.kind === "package-depends-on",
  );
  const subjects = nodes.filter((node) => node.kind === "module" || node.kind === "package");
  return {
    nodes: nodes.length,
    edges: edges.length,
    packages: byKind("package"),
    modules: byKind("module"),
    externalDependencies: byKind("external-dependency"),
    owners: byKind("owner"),
    importEdges: importEdges.length,
    resolvedImports: importEdges.filter(
      (edge) => edge.resolution.status !== "unresolved" && edge.resolution.status !== "platform",
    ).length,
    unresolvedImports: importEdges.filter((edge) => edge.resolution.status === "unresolved").length,
    dependencyEdges: dependencyEdges.length,
    resolvedDependencies: dependencyEdges.filter((edge) => edge.resolution.status === "resolved")
      .length,
    workspaceDependencies: dependencyEdges.filter((edge) => edge.targetMissing).length,
    ownedSubjects: subjects.filter((node) => node.ownership.status === "owned").length,
    unownedSubjects: subjects.filter((node) => node.ownership.status === "unowned").length,
  };
}
