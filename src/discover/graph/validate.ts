/**
 * The graph's own invariants (ADR-0047 §21).
 *
 * A pure function over a built graph that returns the ways it is internally
 * inconsistent. Not a graph database, not a linter, and not a judgement about
 * the repository: it checks the *shape Agent-Ready produced*, and a violation is
 * a bug in Agent-Ready rather than a property of the code it read.
 *
 * That distinction is why this is a separate file with a separate diagnostic.
 * An unresolved import is repository information and is a warning; an edge
 * pointing at a node that does not exist is Agent-Ready's fault and is an error,
 * because the whole value of this graph is that its edges can be trusted, and a
 * graph that cites a line which is not in the file has stopped being auditable.
 *
 * The one check that needs information from outside the graph is the line-range
 * check, so `lineCounts` is an explicit input: the caller supplies the number of
 * lines in every file it read, and a citation into a file nobody read is
 * reported rather than accepted.
 */

import { compareCodeUnits } from "../ordering.js";
import { isRepositoryRelativePath } from "./provenance.js";
import type {
  DependencyEdge,
  GraphEdge,
  GraphNode,
  ImportEdge,
  OwnershipEdge,
  RepositoryGraph,
  SourceLocation,
} from "./types.js";

/** One way the graph fails its own invariants. */
export interface GraphViolation {
  /** A short, stable phrase naming the invariant, not the offending value. */
  readonly invariant: string;
  readonly detail: string;
  /** The node or edge id involved, when there is one. */
  readonly id: string | null;
}

/**
 * Checks every invariant the graph is supposed to hold.
 *
 * Pure and total: it never throws, never reads, and returns an empty list for a
 * well-formed graph. Each invariant below has a test that fails if it is
 * removed, and each corresponds to a way a graph can look plausible while being
 * wrong.
 */
export function validateGraph(
  graph: RepositoryGraph,
  lineCounts: ReadonlyMap<string, number>,
): GraphViolation[] {
  const violations: GraphViolation[] = [];
  const nodeIds = new Set<string>();
  for (const node of graph.nodes) {
    if (nodeIds.has(node.id)) {
      violations.push({
        invariant: "unique-node-ids",
        detail: `Two nodes share the id ${node.id}. A node identity is a function of one repository fact, so a collision is a construction defect rather than a duplicate to merge.`,
        id: node.id,
      });
    }
    nodeIds.add(node.id);
    checkProvenance(violations, `node:${node.kind}`, node.id, node.provenance, lineCounts);
  }

  const edgeIds = new Set<string>();
  const ownedBySource = new Map<string, number>();
  for (const edge of graph.edges) {
    if (edgeIds.has(edge.id)) {
      violations.push({
        invariant: "unique-edge-ids",
        detail: `Two edges share the id ${edge.id}.`,
        id: edge.id,
      });
    }
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.source)) {
      violations.push({
        invariant: "edge-source-exists",
        detail: `An edge names ${edge.source} as its source, and no such node exists.`,
        id: edge.id,
      });
    }
    checkProvenance(violations, `edge:${edge.kind}`, edge.id, edge.provenance, lineCounts);
    if (edge.kind === "owned-by") {
      ownedBySource.set(edge.source, (ownedBySource.get(edge.source) ?? 0) + 1);
    }
  }

  for (const edge of graph.edges) {
    checkEdgeTargets(violations, edge, nodeIds);
  }
  checkOwnershipEdgesAgree(violations, graph.nodes, graph.edges);
  checkOrdering(violations, graph);
  return violations;
}

/**
 * Every citation must be a repository-relative path and an in-range line.
 *
 * `line >= 1` is the whole rule that stops `line: 0` from looking like a
 * position, and the upper bound is the rule that stops a citation into a file
 * that is shorter than claimed — which is what a stale or default position looks
 * like. A file nobody read is a violation too: an uncited fact must fail loudly
 * rather than enter the graph looking legitimate.
 */
function checkProvenance(
  violations: GraphViolation[],
  what: string,
  id: string,
  provenance: SourceLocation,
  lineCounts: ReadonlyMap<string, number>,
): void {
  if (!isRepositoryRelativePath(provenance.source)) {
    violations.push({
      invariant: "provenance-path-is-repository-relative",
      detail: `${what} ${id} cites ${JSON.stringify(provenance.source)}, which is not a repository-relative path. An absolute path would make the graph's bytes depend on where the repository is checked out.`,
      id,
    });
  }
  if (!Number.isInteger(provenance.line) || provenance.line < 1) {
    violations.push({
      invariant: "provenance-line-is-one-based",
      detail: `${what} ${id} cites line ${String(provenance.line)} of ${provenance.source}. Lines are 1-based, so line 1 is the first line of a file.`,
      id,
    });
    return;
  }
  const lineCount = lineCounts.get(provenance.source);
  if (lineCount === undefined) {
    violations.push({
      invariant: "provenance-file-was-read",
      detail: `${what} ${id} cites ${provenance.source}, which this run did not read. A citation into a file nobody read cannot be checked by a reader either.`,
      id,
    });
    return;
  }
  if (provenance.line > lineCount) {
    violations.push({
      invariant: "provenance-line-is-in-range",
      detail: `${what} ${id} cites line ${String(provenance.line)} of ${provenance.source}, which has only ${String(lineCount)} line(s).`,
      id,
    });
  }
}

/**
 * A resolved edge must reference a node that exists; an unresolved one must
 * have no target and must name a specifier and a reason.
 *
 * The `target?: never` on the unresolved variant already makes an unresolved
 * edge carrying a target uncompilable, so what this checks at runtime is the
 * half the type cannot: that a *resolved* edge's target is a real node, and that
 * an unresolved edge says enough to be actionable.
 */
function checkEdgeTargets(
  violations: GraphViolation[],
  edge: GraphEdge,
  nodeIds: ReadonlySet<string>,
): void {
  switch (edge.kind) {
    case "imports":
      checkImportTarget(violations, edge, nodeIds);
      return;
    case "package-depends-on":
      if (edge.declarations.length === 0) {
        violations.push({
          invariant: "dependency-edge-has-a-declaration",
          detail: `A dependency edge has no declaration. A dependency relationship exists only because some manifest said so, so an empty array is not "unknown", it is a relationship with no cause.`,
          id: edge.id,
        });
      }
      for (const declaration of edge.declarations) {
        if (declaration.declaredSpecifier.length === 0) {
          violations.push({
            invariant: "dependency-declaration-has-a-specifier",
            detail: `A dependency declaration on ${declaration.pointer} has an empty declared specifier.`,
            id: edge.id,
          });
        }
      }
      if (edge.resolution.status === "resolved" && edge.provenance.line < 1) {
        violations.push({
          invariant: "resolved-version-is-cited",
          detail: `A dependency edge reports a resolved version with no citeable line.`,
          id: edge.id,
        });
      }
      return;
    case "owned-by":
      if (!nodeIds.has(edge.target)) {
        violations.push({
          invariant: "ownership-target-exists",
          detail: `An ownership edge names ${edge.target}, and no such owner node exists.`,
          id: edge.id,
        });
      }
      return;
  }
}

function checkImportTarget(
  violations: GraphViolation[],
  edge: ImportEdge,
  nodeIds: ReadonlySet<string>,
): void {
  const resolution = edge.resolution;
  if (resolution.status === "unresolved") {
    if (edge.specifier.length === 0) {
      violations.push({
        invariant: "unresolved-import-names-a-specifier",
        detail:
          "An unresolved import edge carries no specifier, so a reader cannot tell what was not resolved.",
        id: edge.id,
      });
    }
    if (resolution.reason.length === 0) {
      violations.push({
        invariant: "unresolved-import-names-a-reason",
        detail:
          "An unresolved import edge carries no reason, so silence and failure look identical.",
        id: edge.id,
      });
    }
    return;
  }
  if (resolution.status === "platform") {
    return;
  }
  if (!nodeIds.has(resolution.target)) {
    violations.push({
      invariant: "resolved-import-target-exists",
      detail: `An import edge reports resolution "${resolution.status}" onto ${resolution.target}, and no such node exists. A resolved edge with no target is a graph that cannot be traversed.`,
      id: edge.id,
    });
  }
}

/**
 * An unowned subject must have no ownership edge, and an owned one must have at
 * least one.
 *
 * This is what makes the union in `OwnershipState` load-bearing rather than
 * decorative: the type prevents an owner list on an unowned node, and this check
 * prevents an `owned-by` edge contradicting that state. Without it, the two
 * representations could drift and a consumer would not know which to believe.
 */
function checkOwnershipEdgesAgree(
  violations: GraphViolation[],
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): void {
  const counts = new Map<string, number>();
  for (const edge of edges) {
    if (edge.kind === "owned-by") {
      counts.set(edge.source, (counts.get(edge.source) ?? 0) + 1);
    }
  }
  for (const node of nodes) {
    if (node.kind !== "module" && node.kind !== "package") {
      continue;
    }
    const owned = counts.get(node.id) ?? 0;
    if (node.ownership.status === "unowned" && owned > 0) {
      violations.push({
        invariant: "unowned-subject-has-no-ownership-edge",
        detail: `Node ${node.id} reports itself unowned but ${String(owned)} ownership edge(s) point away from it.`,
        id: node.id,
      });
    }
    if (node.ownership.status === "owned" && owned === 0) {
      violations.push({
        invariant: "owned-subject-has-an-ownership-edge",
        detail: `Node ${node.id} reports itself owned but no \`owned-by\` edge names it.`,
        id: node.id,
      });
    }
    if (node.ownership.status === "owned") {
      for (const ownerId of node.ownership.ownerIds) {
        if (
          !counts.has(node.id) ||
          !edges.some((edge) => edge.id === `ownership:${node.id}->${ownerId}`)
        ) {
          violations.push({
            invariant: "ownership-state-lists-real-edges",
            detail: `Node ${node.id} lists owner ${ownerId}, but no \`owned-by\` edge pairs them.`,
            id: node.id,
          });
        }
      }
    }
  }
}

/**
 * Collections are in code-unit order, and every id is a string.
 *
 * Ordering is not cosmetic here: a truncated graph drops items *after* sorting,
 * so an unsorted collection would make which items survive depend on the order
 * the file system happened to enumerate them in.
 */
function checkOrdering(violations: GraphViolation[], graph: RepositoryGraph): void {
  checkSorted(
    violations,
    "nodes",
    graph.nodes.map((node) => node.id),
  );
  checkSorted(
    violations,
    "edges",
    graph.edges.map((edge) => edge.id),
  );
  const manifests = graph.sourceUniverse.tsconfigs;
  if (!isSorted(manifests)) {
    violations.push({
      invariant: "canonical-ordering",
      detail: "sourceUniverse.tsconfigs is not in code-unit order.",
      id: null,
    });
  }
  const files = graph.sourceUniverse.files;
  if (!isSorted(files)) {
    violations.push({
      invariant: "canonical-ordering",
      detail: "sourceUniverse.files is not in code-unit order.",
      id: null,
    });
  }
}

function checkSorted(violations: GraphViolation[], what: string, values: readonly string[]): void {
  if (isSorted(values)) {
    return;
  }
  violations.push({
    invariant: "canonical-ordering",
    detail: `graph.${what} is not in code-unit order.`,
    id: null,
  });
}

function isSorted(values: readonly string[]): boolean {
  for (let index = 1; index < values.length; index++) {
    const previous = values[index - 1];
    const current = values[index];
    if (
      previous !== undefined &&
      current !== undefined &&
      compareCodeUnits(previous, current) > 0
    ) {
      return false;
    }
  }
  return true;
}

/** A one-line summary of a violation, for a diagnostic that names the defect. */
export function describeViolation(violation: GraphViolation): string {
  return `${violation.invariant}: ${violation.detail}`;
}

/** The edges a subject owns, for a consumer that wants the relationship list. */
export function ownershipEdgesOf(
  edges: readonly GraphEdge[],
  subjectId: string,
): readonly OwnershipEdge[] {
  return edges.filter(
    (edge): edge is OwnershipEdge => edge.kind === "owned-by" && edge.source === subjectId,
  );
}

/** The dependency edges of one package. */
export function dependencyEdgesOf(
  edges: readonly GraphEdge[],
  packageNodeId: string,
): readonly DependencyEdge[] {
  return edges.filter(
    (edge): edge is DependencyEdge =>
      edge.kind === "package-depends-on" && edge.source === packageNodeId,
  );
}
