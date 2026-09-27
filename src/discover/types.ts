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
 * The fixed, conceptual part of the discovery vocabulary.
 *
 * Every entry is a *property of the repository*, never a property of one entity
 * inside it. A repository with forty packages still has one
 * `repository.packages` fact holding forty entries, not forty facts. That is
 * what keeps this a reviewable union: an id a contributor can read in full and
 * check against the specification, rather than a key space generated from
 * repository content.
 *
 * `repository.packageManager` is the one deliberate exception, and it is
 * handled by `ScopedFactId` below rather than by enumerating paths here.
 */
export const FACT_IDS = [
  "repository.root",
  "repository.contract.present",
  "repository.contract.valid",
  "repository.declarationSurface.present",
  "repository.packages",
  "repository.workspace.root",
  "repository.workspace.declarations",
  "repository.workspace.candidates",
  "repository.workspace.members",
] as const;

/**
 * A fact identity that is a conceptual property *scoped to one path*.
 *
 * A package manager is a property of a manifest, not of a repository: a root
 * manifest naming pnpm beside a nested manifest naming npm is not a
 * contradiction about one thing, it is two true statements about two things.
 * Collapsing those into one repository-wide answer is the specific defect
 * Issue #37 exists to prevent, so package-manager facts carry the manifest
 * they were read from.
 *
 * The template is safe precisely because it is *not* an open key space: the
 * suffix is a normalized repository-relative path that discovery itself
 * derived from bounded reads, never an identifier supplied by the repository.
 * A repository cannot invent a fact identity out of thin air.
 */
export type ScopedFactId = `repository.packageManager.${string}`;

export type FactId = (typeof FACT_IDS)[number] | ScopedFactId;

/** The fixed part of the vocabulary, excluding scoped identities. */
export type ConceptualFactId = (typeof FACT_IDS)[number];

/**
 * The scope label for the repository root.
 *
 * A plain `.` would produce the identity `repository.packageManager..`, which is
 * technically unambiguous and practically unreadable in a snapshot a person is
 * meant to be able to reason about. `root` says the same thing and can be quoted
 * in a terminal without a second thought.
 */
export const ROOT_PACKAGE_SCOPE = "root";

/**
 * Builds the package-manager fact identity for a manifest.
 *
 * Exported rather than inlined as a template literal so that the one place that
 * decides how a scope is spelled is findable, and so a test can pin it.
 */
export function packageManagerFactId(scope: string): ScopedFactId {
  return `repository.packageManager.${scope}`;
}

/**
 * The scope label for a directory holding a manifest.
 *
 * The inverse of reading the suffix back off a fact id, which is what lets a
 * renderer print a nested package's manager without re-deriving it.
 */
export function packageManagerScope(directory: string): string {
  return directory === "." || directory === "" ? ROOT_PACKAGE_SCOPE : directory;
}

/**
 * True for any fact identity the implementation may emit: a conceptual id, or
 * a scoped one that follows the package-manager template. Every emitted id must
 * satisfy this, which is what stops a probe from inventing an identifier.
 */
export function isFactId(value: string): value is FactId {
  if ((FACT_IDS as readonly string[]).includes(value)) {
    return true;
  }
  if (!value.startsWith("repository.packageManager.")) {
    return false;
  }
  const scope = value.slice("repository.packageManager.".length);
  return (
    scope.length > 0 &&
    scope !== "." &&
    !scope.startsWith("/") &&
    !scope.endsWith("/") &&
    !scope.includes("..") &&
    !/[\\*?[\]{}]/.test(scope)
  );
}

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
  /** Always absent: an unknown fact has no value, so nothing can contradict it. */
  readonly contradictedBy?: undefined;
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
  /**
   * Always absent on an agreed fact.
   *
   * Declared explicitly so that "agreed" and "incomplete" are distinguishable
   * from the type rather than from a list of properties. Two interfaces that
   * differ only by an optional field are a union TypeScript cannot narrow, and
   * a renderer that forgot to check would read a contested value as a settled
   * one — so the distinction has to be structural, not conventional.
   */
  readonly contradictedBy?: undefined;
}

/**
 * A fact whose evidence is enough to assert something and not enough to assert
 * it fully.
 *
 * This is a third outcome, distinct from both an agreed fact and a conflict,
 * and it exists because a `declared` claim and a `derived` claim are not peers.
 * A `packageManager` field is an assertion about *identity*; a lockfile is an
 * observation of an *artifact*. When they disagree, neither "they conflict, so
 * the value is unknown" nor "the lockfile wins" is honest. The first denies
 * that the repository declared anything, which is false; the second is exactly
 * the confidently-wrong answer ADR-0044 exists to prevent.
 *
 * So the declaration is carried forward, every contradicting artifact is
 * retained and *published* in `contradictedBy`, and a warning is raised. No
 * source is preferred over another and nothing is discarded — a consumer that
 * wants certainty has to read `contradictedBy`, which is the point of making
 * the disagreement a required field rather than a diagnostic nobody sees.
 */
export interface IncompleteFact {
  readonly id: FactId;
  readonly kind: KnownFactKind;
  /**
   * The asserted value, carried from the identity claim. Every claim is
   * retained verbatim alongside it, so this is a *summary of what was declared*,
   * never a resolution of the disagreement.
   */
  readonly value: JsonValue;
  readonly claims: readonly Claim[];
  /**
   * The manager names the retained claims disagree with, code-unit sorted and
   * deduplicated. Empty is impossible on this variant: a fact with no
   * disagreement is an `AgreedFact`, which makes "this is incomplete" checkable
   * from the shape alone.
   *
   * These are names (`"npm"`), not claim values, so they compare directly with
   * the fact's `value`. The evidence that produced each one — which lockfile,
   * which declaration — stays in `claims`.
   */
  readonly contradictedBy: readonly JsonValue[];
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
  /** Always absent: a conflict has no value for anything to contradict. */
  readonly contradictedBy?: undefined;
}

export type Fact = UnknownFact | AgreedFact | IncompleteFact | ConflictedFact;

export function isUnknownFact(fact: Fact): fact is UnknownFact {
  return fact.kind === "unknown";
}

export function isConflictedFact(fact: Fact): fact is ConflictedFact {
  return fact.kind !== "unknown" && !("value" in fact);
}

/**
 * A fact that asserts a value while publishing the disagreement with it.
 * Callers that render a single value must check this first; rendering an
 * `IncompleteFact`'s value alone is how a conflict gets presented as a result.
 */
export function isIncompleteFact(fact: Fact): fact is IncompleteFact {
  return fact.kind !== "unknown" && fact.contradictedBy !== undefined;
}

export function isKnownFact(fact: Fact): fact is AgreedFact | IncompleteFact | ConflictedFact {
  return fact.kind !== "unknown";
}

/**
 * Discovery snapshot format version. Independent of the `agent-ready.yaml`
 * contract `version` and of the npm package version, per ADR-0040's
 * version taxonomy. `0` means *unstable*: no field carries the pre-1.0
 * stability promise of ADR-0009, and the published field-stability statement
 * is deferred to Issue #40. Versioned from first appearance so that
 * accidental drift is visible.
 *
 * Issue #37 grew the vocabulary additively and deliberately did **not** bump
 * this. No field was removed and none changed meaning, and `0` already denies
 * stability — reserving a version bump for routine vocabulary growth would
 * make the number carry no information at all. The bump is held for a change a
 * consumer could not survive. See ADR-0045.
 */
export const DISCOVERY_SNAPSHOT_VERSION = 0;

// ---------------------------------------------------------------------------
// Structured value shapes
//
// Issue #36's production facts were all boolean-shaped. Issue #37 introduces
// value-shaped facts, and the temptation to reach for `String(value)` is exactly
// what would print `[object Object]` and invent a yes/no for a list. These
// interfaces exist so a value's shape is declared once, checkable, and
// impossible to drift from what the probes actually build.
// ---------------------------------------------------------------------------

/**
 * Whether a manifest declares a usable package name.
 *
 * `absent` and `invalid` are separate on purpose. A readable manifest with no
 * `name` is a real and common state; a manifest whose `name` is a number is a
 * different real state. Both are reported, and in neither case is a name
 * invented from the directory name — inferring `@scope/pkg` from a path is
 * precisely the directory-naming heuristic this issue rejects.
 */
export type PackageNameStatus = "declared" | "absent" | "invalid";

/** How far reading one manifest got. Never conflated with "no such package". */
export type ManifestStatus = "read" | "malformed" | "unreadable";

/**
 * One discovered package. A package *is* a readable manifest; workspace
 * membership is a separate fact with a separate id, so these two statements are
 * never merged into one.
 *
 * Declared as a type alias rather than an interface for a mechanical reason
 * with a real payoff: TypeScript grants an object *type* an implicit index
 * signature but not an interface one, so `readonly PackageEntry[]` is
 * assignable to `JsonValue` and this can be a fact value directly. As an
 * interface it could not, and the only way to get it into a `JsonValue` fact
 * would have been the double assertion `as unknown as JsonValue` — a cast that
 * is exactly the "production facts may not match their declared shape"
 * blindness the structured-value work exists to prevent. A new field that is
 * not JSON is now a compile error here rather than a surprise in a snapshot.
 *
 * The one `consistent-type-definitions` exception in the project, and it is
 * local to the three collection entries below rather than a change to the rule.
 * The rule encodes "prefer an interface for an object shape", which is right
 * almost everywhere; here the distinction TypeScript draws between an
 * interface and an object type is the entire point, so the exception is
 * narrower than the rule and removable by anyone who disagrees.
 */
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- an object type gets an implicit index signature, an interface does not; see the note above
export type PackageEntry = {
  /** Repository-relative directory containing the manifest. */
  readonly path: string;
  /** Null unless `nameStatus` is `declared`. */
  readonly name: string | null;
  readonly nameStatus: PackageNameStatus;
  /** Null unless the manifest declares a boolean `private`. */
  readonly private: boolean | null;
  /** Null unless the manifest declares a string `version`. */
  readonly version: string | null;
  readonly manifestStatus: ManifestStatus;
};

/**
 * How a workspace declaration was written. Only forms implemented and tested
 * are named here; anything else is `unsupportedReason`, never coerced into the
 * nearest shape that happens to fit.
 */
export type WorkspaceDeclarationForm = "array" | "object" | "unsupported";

/**
 * One workspace declaration, as the repository wrote it. This is the
 * `declared` half of workspace discovery and is deliberately *not* an
 * expansion: `"packages/*"` is configuration, `["packages/a","packages/b"]` is
 * a derivation, and conflating them would erase the difference between what a
 * repository asserts and what Agent-Ready worked out from it.
 *
 * `patterns` are verbatim and in declaration order, because order is itself
 * declared information — a `!` exclusion only means something relative to the
 * patterns around it.
 */
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- see PackageEntry: an object type is assignable to JsonValue, an interface is not
export type WorkspaceDeclarationEntry = {
  /** Repository-relative path of the file carrying the declaration. */
  readonly source: string;
  readonly form: WorkspaceDeclarationForm;
  readonly patterns: readonly string[];
  /** Why the form is unsupported, or null when it is supported. */
  readonly unsupportedReason: string | null;
};

/**
 * One repository-relative path a declared workspace pattern refers to, and
 * whether a directory is actually there.
 *
 * `present` is deliberately three-valued. `false` means the path is absent,
 * which is a real and reportable state a later drift analysis needs; `null`
 * means it could not be inspected, which is ignorance and must never be
 * reported as absence. A glob match and a literal path both appear here, so a
 * declared-but-missing path stays visible instead of being dropped because it
 * produced no candidate.
 */
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- see PackageEntry: an object type is assignable to JsonValue, an interface is not
export type WorkspaceCandidateEntry = {
  readonly path: string;
  readonly source: string;
  readonly pattern: string;
  readonly present: boolean | null;
};

export interface DiscoverySummary {
  readonly facts: number;
  readonly known: number;
  readonly unknown: number;
  readonly conflicts: number;
  /**
   * False when at least one probe could not complete, or a discovered manifest
   * exists but could not be interpreted.
   *
   * A malformed manifest counts as incomplete even though its read succeeded,
   * because a consumer that trusts this flag would otherwise believe it had the
   * whole picture while a package's contents were unknown. The specific path and
   * whether it was malformed or unreadable are in the diagnostics; this flag is
   * the coarse signal that something was not fully established.
   */
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
