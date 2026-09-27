/**
 * The repository graph's data model (ADR-0047).
 *
 * The whole point of this file is one rule, and every type below exists to make
 * it impossible to break by accident:
 *
 * > **Every node and edge carries the provenance of the fact it encodes. If a
 * > graph fact cannot be traced to a repository file and a line, it does not
 * > enter the graph.**
 *
 * `source` and `line` are therefore required on `SourceLocation` and on every
 * node and edge that carries one, and the negative cases that would otherwise
 * need a nullable field are discriminated unions instead:
 *
 *  - a resolved import edge *cannot* omit its target, and an unresolved one
 *    *cannot* carry one (`target?: never` on the unresolved variant);
 *  - a resolved dependency version *cannot* be missing, and a missing one is a
 *    named state rather than `null`;
 *  - an unowned subject *cannot* carry owner ids.
 *
 * The impossible states are unrepresentable, which is the only way the rule
 * survives a future contributor who is not reading this comment.
 */

import type { KnownFactKind } from "../types.js";

/**
 * Where a graph fact was declared, precisely enough to check.
 *
 * `line` is 1-based because line 1 is the first line of a file and that is what
 * an editor, a review, and a person at a terminal all mean. TypeScript reports
 * 0-based positions; the conversion happens once, in `graph/provenance.ts`, so
 * no call site can forget it.
 *
 * `column`, `endLine`, and `endColumn` are optional in the *type* because a
 * position that a parser genuinely did not produce must not be invented — but
 * they are present on every fact where the parser did produce them, because a
 * column range is what makes `"./x.js"` distinguishable from the `import`
 * keyword three hundred characters to its left.
 *
 * `pointer` coexists with the line rather than replacing it: the pointer says
 * *which field*, the line says *where*, and a consumer that has both can check
 * one against the other.
 */
export interface SourceLocation {
  /** Repository-relative, `/`-separated. Never absolute, never escaping. */
  readonly source: string;
  /** 1-based line. */
  readonly line: number;
  /** 1-based column. */
  readonly column?: number;
  /** 1-based. */
  readonly endLine?: number;
  /** 1-based. */
  readonly endColumn?: number;
  /** JSON Pointer into the document, when the fact came from JSON. */
  readonly pointer?: string;
}

/**
 * How a package name and module path combine into a stable id.
 *
 * Ids are readable on purpose. An id a reader cannot re-derive by hand is an id
 * they cannot verify, and an unverifiable id makes every edge citing it
 * unverifiable too.
 */
export type GraphNodeId = string;

export type GraphNodeKind = "package" | "module" | "external-dependency" | "owner";
export type GraphEdgeKind = "imports" | "package-depends-on" | "owned-by";

/**
 * What the ownership search found for a subject.
 *
 * `owned` and `unowned` are different shapes rather than one shape with an
 * optional array, so `status: "unowned"` with a list of owners cannot compile.
 * An absent owner is a real, reportable state; there is no sentinel owner node
 * and no default team, because inventing either would put a person or a group in
 * the graph that no repository file declares (ADR-0047 §19).
 */
export type OwnershipState =
  | { readonly status: "owned"; readonly ownerIds: readonly GraphNodeId[] }
  | { readonly status: "unowned"; readonly policy: OwnershipPolicy };

/**
 * Which ownership surface produced the answer, and whether there was one.
 *
 * This is the honest resolution of a real tension: "every graph fact traces to a
 * file and a line" versus "missing ownership must be explicit". A fact about the
 * *absence* of a matching rule has no line to cite, so it does not invent one.
 * The subject's own provenance stays on its node, and this records which
 * document was searched — or that none was there to search.
 */
export type OwnershipPolicy =
  | { readonly status: "evaluated"; readonly source: string }
  | { readonly status: "absent"; readonly source: null };

/** A discovered package. Identity is the canonical path, per ADR-0045. */
export interface PackageNode {
  readonly id: GraphNodeId;
  readonly kind: "package";
  readonly path: string;
  readonly name: string | null;
  readonly provenance: SourceLocation;
  readonly ownership: OwnershipState;
}

/** One supported source file inside the repository. */
export interface ModuleNode {
  readonly id: GraphNodeId;
  readonly kind: "module";
  readonly path: string;
  /** The deepest discovered package root containing this file. */
  readonly packagePath: string;
  readonly provenance: SourceLocation;
  readonly ownership: OwnershipState;
}

/**
 * A package name this repository mentions — by declaring it, or by importing it.
 *
 * Not the npm universe: only a name the repository itself writes becomes a node,
 * so the transitive closure of a lockfile stays out of the graph (ADR-0047 §14).
 */
export interface ExternalDependencyNode {
  readonly id: GraphNodeId;
  readonly kind: "external-dependency";
  /** The package name exactly as written, e.g. `@scope/foo`. */
  readonly name: string;
  readonly provenance: SourceLocation;
}

/** One owner token written in a CODEOWNERS rule. Never validated. */
export interface OwnerNode {
  readonly id: GraphNodeId;
  readonly kind: "owner";
  readonly identity: string;
  readonly provenance: SourceLocation;
}

export type GraphNode = PackageNode | ModuleNode | ExternalDependencyNode | OwnerNode;

/**
 * How an import was written, in the source.
 *
 * `import-equals` and `require` are listed even though they never produce a
 * resolved edge: a thing the graph looked at and declined to model is still a
 * thing a reader deserves to see, and hiding it would be silence.
 */
export type ImportSyntax = "import" | "re-export" | "dynamic-import" | "import-equals" | "require";

/**
 * Why an import declaration produced no in-repository target.
 *
 * A small, structural vocabulary. A diagnostic code is *not* minted per reason
 * (ADR-0047 amendment 3); the reason is data, and `DISCOVERY_IMPORT_UNRESOLVED`
 * is the single code that surfaces one.
 */
export type UnresolvedReason =
  | "target-not-found"
  | "unsupported-specifier"
  | "unsupported-syntax"
  | "outside-repository"
  | "unsupported-package-subpath";

/**
 * Where an import declaration's target ended up.
 *
 * `target?: never` on the two variants that have no target is the load-bearing
 * part: a resolved edge cannot omit its target, and an unresolved edge cannot
 * carry one. `platform` is a resolved answer with no node because a Node built-in
 * is provided by the runtime, not by any declaration in this repository.
 */
export type ImportResolution =
  | { readonly status: "module"; readonly target: GraphNodeId; readonly targetPath: string }
  | { readonly status: "package"; readonly target: GraphNodeId; readonly subpath: string | null }
  | { readonly status: "dependency"; readonly target: GraphNodeId }
  | { readonly status: "platform"; readonly target?: never }
  | {
      readonly status: "unresolved";
      readonly target?: never;
      readonly reason: UnresolvedReason;
    };

/**
 * One import declaration in one source file.
 *
 * One edge per *declaration site*, not one per relationship: two imports of the
 * same module can differ in `typeOnly` and in `syntax`, and collapsing them into
 * one edge would make "is this type-only coupling?" unanswerable from the edge.
 * Every site keeps its own provenance, so nothing is aggregated away.
 */
export interface ImportEdge {
  readonly id: GraphNodeId;
  readonly kind: "imports";
  readonly source: GraphNodeId;
  /** The module specifier, verbatim. */
  readonly specifier: string;
  readonly syntax: ImportSyntax;
  /** Written with `import type`. Never inferred from what was bound. */
  readonly typeOnly: boolean;
  readonly resolution: ImportResolution;
  /** The line the specifier is on. */
  readonly provenance: SourceLocation;
}

/**
 * A manifest's dependency field. Preserved verbatim, never normalised.
 *
 * A `devDependency` does not become a runtime dependency because runtime code
 * imports it; that observation is a later analysis, and making it here would
 * destroy the distinction the manifest drew.
 */
export type DependencyClass = "runtime" | "dev" | "peer" | "optional";

/** One manifest field that declares a dependency. */
export interface DependencyDeclaration {
  readonly dependencyClass: DependencyClass;
  /** `^8.17.1`, `workspace:*`, `file:../x` — exactly as written. */
  readonly declaredSpecifier: string;
  readonly provenance: SourceLocation;
  /** JSON Pointer, e.g. `/dependencies/ajv`. */
  readonly pointer: string;
}

/**
 * What lockfile evidence established about a dependency's version.
 *
 * Four states, not one nullable field, because "there is no lockfile", "the
 * lockfile is in a format we do not model", "the lockfile could not be read",
 * and "the lockfile has no entry for this dependency" are four different
 * claims and conflating them is how a snapshot starts lying.
 *
 * `resolved` and `unsupported` are the only variants with a `provenance`, and
 * the provenance is the lockfile line — never the manifest line, which is where
 * the *declaration* lives and a different question.
 */
export type DependencyResolution =
  | { readonly status: "resolved"; readonly version: string; readonly provenance: SourceLocation }
  | { readonly status: "no-evidence" }
  | { readonly status: "unsupported"; readonly source: string; readonly detail: string }
  | { readonly status: "unresolved" };

/**
 * A package's declared dependency on another package.
 *
 * Minted only from a manifest declaration. An import never creates one, and no
 * naming convention does either — a package named `@repo/api` is not a
 * dependency of the package that imports it unless some manifest says so. The
 * two edge families stay distinct precisely so their disagreement is visible.
 */
export interface DependencyEdge {
  readonly id: GraphNodeId;
  readonly kind: "package-depends-on";
  readonly source: GraphNodeId;
  /**
   * The package this one depends on: an `external-dependency` node, or a
   * workspace `package` node when a discovered package declares the name.
   *
   * Always present, unlike an import edge's target: a dependency edge exists
   * *because* a manifest named something, and that name is the endpoint. The
   * edge is never dangling, which is why the validator has no unresolved-target
   * case for this kind.
   */
  readonly target: GraphNodeId;
  /** One or more, never zero: an edge with no declaration is inexpressible. */
  readonly declarations: readonly DependencyDeclaration[];
  readonly resolution: DependencyResolution;
  /**
   * The first declaration in code-unit order — deterministic, not "best" — so a
   * consumer reading one field still gets a real line. Every other declaration
   * keeps its own provenance inside `declarations`.
   */
  readonly provenance: SourceLocation;
  /**
   * True when a `workspace:`-protocol declaration named a workspace package
   * that no declaration reached. The edge survives; the target is the name the
   * manifest wrote, and the fact that it is missing is published rather than
   * repaired.
   */
  readonly targetMissing: boolean;
}

/**
 * One owner of one subject, cited to the CODEOWNERS rule that established it.
 *
 * One edge per owner token: a rule naming two owners produces two edges, never
 * one with a chosen owner and never a "primary" owner.
 */
export interface OwnershipEdge {
  readonly id: GraphNodeId;
  readonly kind: "owned-by";
  readonly source: GraphNodeId;
  readonly target: GraphNodeId;
  /** The exact CODEOWNERS rule line. */
  readonly provenance: SourceLocation;
  /** The pattern, verbatim. */
  readonly rule: string;
}

export type GraphEdge = ImportEdge | DependencyEdge | OwnershipEdge;

/** Whether a supported CODEOWNERS file was found, and what became of it. */
export type OwnershipSurfaceStatus = "present" | "absent" | "unreadable" | "unsupported";

/**
 * The ownership surface as a whole.
 *
 * `absent` is a **successful, complete** answer, not a failure: a repository
 * with no CODEOWNERS file has zero rules, and every subject is explicitly
 * unowned. Publishing the surface state separately from the per-node states is
 * what makes "no ownership policy exists" readable without walking every node.
 */
export interface OwnershipSurface {
  readonly status: OwnershipSurfaceStatus;
  /** Repository-relative path of the winning CODEOWNERS file, or null. */
  readonly source: string | null;
  readonly rules: number;
  readonly unsupportedPatterns: readonly UnsupportedPattern[];
  /** Why the surface could not be read or is not modelled, or null. */
  readonly detail: string | null;
}

/** A CODEOWNERS rule whose pattern is outside the supported subset. */
export interface UnsupportedPattern {
  readonly source: string;
  /** 1-based. */
  readonly line: number;
  readonly pattern: string;
  readonly reason: string;
}

/** How the source universe for the module graph was determined. */
export interface SourceUniverse {
  /**
   * `tsconfig` when a package declared one and TypeScript's own parser
   * determined the file list; `bounded-traversal` for a package with none.
   *
   * Published so a consumer can see that this repository did not state a
   * universe, rather than inferring it from the file list looking reasonable.
   */
  readonly strategy: "tsconfig" | "bounded-traversal" | "mixed";
  /** Repository-relative tsconfig paths that were parsed, code-unit sorted. */
  readonly tsconfigs: readonly string[];
  /** The module-resolution mode in force, from config or the documented default. */
  readonly resolutionMode: string;
  /** The extensions admitted to the universe. */
  readonly extensions: readonly string[];
  /** Files the universe selected, in code-unit order. */
  readonly files: readonly string[];
  /** True when a bound stopped selection. */
  readonly truncated: boolean;
}

/** Coarse counts, for a reader who wants the shape without the whole graph. */
export interface GraphCounts {
  readonly nodes: number;
  readonly edges: number;
  readonly packages: number;
  readonly modules: number;
  readonly externalDependencies: number;
  readonly owners: number;
  readonly importEdges: number;
  readonly resolvedImports: number;
  readonly unresolvedImports: number;
  readonly dependencyEdges: number;
  readonly resolvedDependencies: number;
  readonly workspaceDependencies: number;
  readonly ownedSubjects: number;
  readonly unownedSubjects: number;
}

/**
 * The graph, as published in the snapshot.
 *
 * A sibling of `facts`, not a fact. A graph's evidence is one entry per node
 * and per edge — thousands of paths from a single inspection — which ADR-0045's
 * evidence budget exists to prevent and which cannot be compressed into a claim
 * without losing per-item provenance. See ADR-0047 amendment 1.
 */
export interface RepositoryGraph {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly sourceUniverse: SourceUniverse;
  readonly ownership: OwnershipSurface;
  readonly counts: GraphCounts;
  /** False when a bound was reached or a required file could not be read. */
  readonly complete: boolean;
  /** Which bound stopped collection, or null. */
  readonly truncatedBy: string | null;
}

/**
 * The epistemic label a graph item carries.
 *
 * A dependency *declaration* is `declared`; the *resolved version* attached to
 * it is `derived`; an ownership relationship comes from an explicit rule. The
 * vocabulary is ADR-0044's, unchanged, and it is used per item rather than per
 * graph — a projection that lost which of its pieces were assertions and which
 * were computations would be a projection that overstated itself.
 */
export type GraphItemEpistemic = KnownFactKind;
