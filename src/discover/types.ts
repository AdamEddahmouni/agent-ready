/**
 * The repository discovery fact model (ADR-0044).
 *
 * A fact is a record, never a bare value. Every fact declares an epistemic
 * `kind` — what the repository *states*, what Agent-Ready *inferred*, what a
 * human merely *claimed* — and every known fact carries the evidence that
 * supports it. `unknown` is a first-class value with an explicit reason, so an
 * honest gap stays distinguishable from an absent field.
 *
 * Two invariants are enforced by the type system rather than by convention:
 *
 *  1. A fact that is `unknown` has no `value` at all.
 *  2. A fact that carries a `value` (or a conflicting set of claims) always
 *     carries non-empty evidence. A fact with empty evidence is `unknown`,
 *     never a default.
 *
 * A third invariant is enforced by `ConflictedFact` simply having no `value`
 * field: when sources disagree, the snapshot retains every claim and refuses
 * to name a winner.
 */

import type { Diagnostic } from "../diagnostics/types.js";
import type { DiagnosticCode } from "../diagnostics/codes.js";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [k: string]: JsonValue };

/**
 * Stable conceptual identity of a discovered property. Contradiction
 * detection groups claims by this id, so two probes reporting different
 * values for the same id are combined into one conflicted fact rather than
 * two facts that appear to agree.
 *
 * This vocabulary is intentionally small. Issue #36 ships the substrate, not a
 * repository domain, so what it can say about a repository is: where the root
 * is, whether a contract exists and is valid, and whether a declaration
 * surface is present. Package, workspace, command, and graph facts are Issue
 * #37 onward, and they are added here as first-class ids rather than smuggled
 * in through a probe that was never declared as one.
 */
export const FACT_IDS = [
  "repository.root",
  "repository.contract.present",
  "repository.contract.valid",
  "repository.declarationSurface.present",
] as const;

export type FactId = (typeof FACT_IDS)[number];

/**
 * The epistemic boundary. `declared` is asserted by a repository file,
 * `derived` is computed by a fixed rule from repository content,
 * `author-declared` is a human claim in `agent-ready.yaml`, and `unknown`
 * means discovery ran and could not determine the fact.
 *
 * `author-declared` is part of the vocabulary but has no production source in
 * this issue: nothing here extracts claims from a contract, and the fact ids
 * that would carry them are Issue #37's. The channel exists, is typed, and is
 * tested, so that a maintainer's description can be labelled when it arrives
 * rather than being introduced as a special case alongside real evidence.
 */
export type KnownFactKind = "declared" | "derived" | "author-declared";
export type FactKind = KnownFactKind | "unknown";

/**
 * Why a fact is unknown. `no-evidence` means the probe completed and found
 * nothing; `probe-failed` means the probe could not complete; `not-probed`
 * means the fact was out of scope for this run. A failed attempt to inspect
 * something is never evidence that it does not exist.
 */
export type UnknownReason = "no-evidence" | "probe-failed" | "not-probed";

/**
 * Where a claim came from, precise enough for a downstream consumer to
 * re-derive it. `source` is a repository-relative path; `pointer` locates a
 * position inside that document (a JSON Pointer or field name).
 */
export interface Evidence {
  readonly source: string;
  readonly pointer?: string;
  readonly detail?: string;
}

/** One source's assertion about a fact. Claims are never merged or dropped. */
export interface Claim {
  readonly kind: KnownFactKind;
  readonly value: JsonValue;
  readonly evidence: readonly Evidence[];
}

export interface UnknownFact {
  readonly id: FactId;
  readonly kind: "unknown";
  readonly reason: UnknownReason;
  /** Where the probe looked. Empty only for `not-probed`. */
  readonly evidence: readonly Evidence[];
}

export interface Corroboration {
  /** Every kind that independently supports the agreed value, code-unit sorted. */
  readonly kinds: readonly KnownFactKind[];
  /** True when an `author-declared` claim contributed. */
  readonly authorDeclared: boolean;
  /**
   * True only when at least two claims support the value from *different*
   * evidence. One source, however confident, is not corroboration — and two
   * claims citing the same file are one source asserting twice. A fact that is
   * `author-declared` with `corroborated: false` is a maintainer's uncorroborated
   * description, which is exactly the case ADR-0044 requires to stay visible.
   */
  readonly corroborated: boolean;
}

export interface AgreedFact {
  readonly id: FactId;
  readonly kind: KnownFactKind;
  /** Sources agree. A single representative value, never chosen by ranking. */
  readonly value: JsonValue;
  readonly claims: readonly Claim[];
  readonly corroboration: Corroboration;
}

export interface ConflictedFact {
  readonly id: FactId;
  readonly kind: KnownFactKind;
  /**
   * Sources disagree, so there is deliberately no `value`. Both claims and
   * their evidence are retained verbatim; resolving them is a later concern
   * and is never done by a winner-selection heuristic.
   */
  readonly claims: readonly Claim[];
  readonly corroboration: Corroboration;
}

export type Fact = UnknownFact | AgreedFact | ConflictedFact;

export function isUnknownFact(fact: Fact): fact is UnknownFact {
  return fact.kind === "unknown";
}

export function isConflictedFact(fact: Fact): fact is ConflictedFact {
  return fact.kind !== "unknown" && !("value" in fact);
}

export function isKnownFact(fact: Fact): fact is AgreedFact | ConflictedFact {
  return fact.kind !== "unknown";
}

/**
 * Discovery snapshot format version. Independent of the `agent-ready.yaml`
 * contract `version` and of the npm package version, per ADR-0040's
 * version taxonomy. `0` means *unstable*: no field carries the pre-1.0
 * stability promise of ADR-0009, and the published field-stability statement
 * is deferred to Issue #40. Versioned from first appearance so that
 * accidental drift is visible.
 */
export const DISCOVERY_SNAPSHOT_VERSION = 0;

export interface DiscoverySummary {
  readonly facts: number;
  readonly known: number;
  readonly unknown: number;
  readonly conflicts: number;
  /** False when at least one probe could not complete. */
  readonly complete: boolean;
}

export interface DiscoverySnapshot {
  readonly ok: true;
  readonly snapshotVersion: number;
  readonly facts: Readonly<Record<string, Fact>>;
  readonly summary: DiscoverySummary;
  /** Describes the discovery operation, not repository knowledge. */
  readonly diagnostics: readonly Diagnostic[];
  /**
   * Repository-relative anchor for every path in this snapshot. Always ".";
   * absolute paths are excluded so that byte-identical output does not depend
   * on where the repository happens to be checked out.
   */
  readonly root: string;
}

/**
 * Discovery reuses the project's shared diagnostic vocabulary rather than
 * inventing a parallel one: the same `code`, `severity`, `summary`,
 * `remediation`, and `metadata` fields, the same registry in
 * `src/diagnostics/codes.ts`, the same renderers, and the same exit-code
 * resolution. A consumer therefore needs no second error-handling path.
 */
export type DiscoveryDiagnostic = Diagnostic;

/**
 * The `DISCOVERY_*` slice of the shared registry, derived rather than
 * restated so the two cannot drift apart.
 */
export type DiscoveryDiagnosticCode = Extract<DiagnosticCode, `DISCOVERY_${string}`>;
