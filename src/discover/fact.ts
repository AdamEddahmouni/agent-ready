import type {
  AgreedFact,
  Claim,
  ConflictedFact,
  Corroboration,
  Evidence,
  Fact,
  FactId,
  JsonValue,
  KnownFactKind,
  UnknownFact,
  UnknownReason,
} from "./types.js";

/**
 * Strength order used only to label a merged fact whose sources *agree*. It
 * never selects a value: when sources disagree the merged fact has no value
 * at all. It is an explicit constant rather than an ordering buried in a
 * comparison so that a reader can see it, and the full set of contributing
 * kinds is always published in `corroboration.kinds` alongside it.
 */
const KIND_STRENGTH: readonly KnownFactKind[] = ["declared", "derived", "author-declared"];

/**
 * When several probes are unable to determine the same fact, the reported
 * reason is the most informative one. Explicit, fixed, and documented rather
 * than order-dependent: a probe that failed tells a consumer strictly more
 * than a probe that completed and found nothing.
 */
const REASON_INFORMATIVENESS: readonly UnknownReason[] = [
  "probe-failed",
  "no-evidence",
  "not-probed",
];

export interface KnownContribution {
  readonly id: FactId;
  readonly kind: KnownFactKind;
  readonly value: JsonValue;
  readonly evidence: readonly Evidence[];
}

export interface UnknownContribution {
  readonly id: FactId;
  readonly reason: UnknownReason;
  readonly evidence: readonly Evidence[];
}

export type Contribution = KnownContribution | UnknownContribution;

export function isKnownContribution(contribution: Contribution): contribution is KnownContribution {
  return "value" in contribution;
}

/**
 * Builds an unknown fact. An unknown never carries a value: there is nothing
 * to know, and a defaulted value here is exactly the fabricated certainty
 * ADR-0044 forbids.
 */
export function buildUnknownFact(
  id: FactId,
  reason: UnknownReason,
  evidence: readonly Evidence[],
): UnknownFact {
  return { id, kind: "unknown", reason, evidence: normalizeEvidence(evidence) };
}

/**
 * Builds a fact whose sources agree. Refuses to build one without evidence:
 * a known fact that cannot cite its source is a fabricated fact, and the only
 * legitimate response is to downgrade it to `unknown` upstream.
 */
export function buildAgreedFact(id: FactId, claims: readonly Claim[]): AgreedFact | ConflictedFact {
  if (claims.length === 0) {
    throw new Error(`Cannot build a known fact for "${id}" without any claim.`);
  }
  for (const claim of claims) {
    if (claim.evidence.length === 0) {
      throw new Error(
        `Cannot build a known fact for "${id}" from a claim with no evidence. ` +
          "A fact that cannot cite its source must be reported as unknown.",
      );
    }
  }

  const sorted = sortClaims(claims);
  const corroboration = describeCorroboration(sorted);
  const distinct = distinctValues(sorted);
  if (distinct.length > 1) {
    // Contradiction. No value is produced, and no source is preferred.
    return { id, kind: strongestKind(corroboration.kinds), claims: sorted, corroboration };
  }
  return {
    id,
    kind: strongestKind(corroboration.kinds),
    value: sorted[0]?.value ?? null,
    claims: sorted,
    corroboration,
  };
}

/**
 * The evidence invariant: every fact that makes a positive claim must be able
 * to cite where the claim came from. Exported so the guarantee is testable
 * directly rather than only implied by the builders.
 *
 * An unknown fact satisfies this vacuously — it asserts nothing, so it owes no
 * citation. A probe that failed is exactly the case where nothing was read,
 * which is why requiring evidence there would reject a correct snapshot
 * instead of catching a fabricated one. Use `isSelfDescribing` for the
 * stronger question of whether a fact accounts for its own state.
 */
export function hasEvidence(fact: Fact): boolean {
  if (fact.kind === "unknown") {
    return true;
  }
  return fact.claims.length > 0 && fact.claims.every((claim) => claim.evidence.length > 0);
}

/**
 * Whether a fact can account for its own state: a known fact cites its
 * sources, and an unknown fact either records where it looked or was never
 * probed at all. A `probe-failed` fact with no evidence is *not* an error —
 * failing to read something is precisely how nothing gets cited — so this
 * predicate deliberately permits it, and is therefore a statement about
 * observability rather than about correctness.
 */
export function isSelfDescribing(fact: Fact): boolean {
  if (fact.kind !== "unknown") {
    return hasEvidence(fact);
  }
  return fact.evidence.length > 0 || fact.reason === "not-probed";
}

/** True when a fact's sources disagree, which is reported, never resolved. */
export function isContradictory(fact: Fact): fact is ConflictedFact {
  return fact.kind !== "unknown" && !("value" in fact);
}

/**
 * Merges every contribution that shares a conceptual fact id into one fact.
 *
 * This is the seam later discovery issues extend: a new probe that reports on
 * an existing fact id is automatically combined with the existing sources, so
 * a disagreement surfaces as a `DISCOVERY_FACT_CONFLICT` instead of two facts
 * that appear to agree.
 */
export function mergeContributions(contributions: readonly Contribution[]): Fact[] {
  const grouped = new Map<FactId, { known: KnownContribution[]; unknown: UnknownContribution[] }>();
  for (const contribution of contributions) {
    let entry = grouped.get(contribution.id);
    if (entry === undefined) {
      entry = { known: [], unknown: [] };
      grouped.set(contribution.id, entry);
    }
    if (isKnownContribution(contribution)) {
      entry.known.push(contribution);
    } else {
      entry.unknown.push(contribution);
    }
  }

  const facts: Fact[] = [];
  for (const id of [...grouped.keys()].sort(compareIds)) {
    const entry = grouped.get(id);
    if (entry === undefined) {
      continue;
    }
    if (entry.known.length > 0) {
      const claims = entry.known.map((known) => ({
        kind: known.kind,
        value: known.value,
        evidence: known.evidence,
      }));
      facts.push(buildAgreedFact(id, claims));
      continue;
    }
    const reason = entry.unknown.reduce<UnknownReason>(
      (most, candidate) =>
        REASON_INFORMATIVENESS.indexOf(candidate.reason) < REASON_INFORMATIVENESS.indexOf(most)
          ? candidate.reason
          : most,
      "not-probed",
    );
    facts.push(
      buildUnknownFact(
        id,
        reason,
        entry.unknown.flatMap((unknown) => unknown.evidence),
      ),
    );
  }
  return facts;
}

function strongestKind(kinds: readonly KnownFactKind[]): KnownFactKind {
  for (const candidate of KIND_STRENGTH) {
    if (kinds.includes(candidate)) {
      return candidate;
    }
  }
  return "author-declared";
}

/**
 * Describes how much independent support a merged fact actually has.
 *
 * `corroborated` deliberately means *independent corroboration*: at least two
 * claims whose evidence comes from different files. The weaker reading — "some
 * claim is not the author's word" — is already published as `kinds`, and
 * conflating the two is how a single source ends up presented as though the
 * repository confirmed itself. Two claims citing the same file are one source
 * asserting twice, not two sources agreeing.
 *
 * A claim's several evidence entries count as one source: a probe that lists
 * five paths it checked made one assertion, and counting the paths would
 * manufacture agreement out of a single inspection.
 */
function describeCorroboration(claims: readonly Claim[]): Corroboration {
  const kinds = [...new Set(claims.map((claim) => claim.kind))].sort(compareKinds);
  const independentSources = new Set(
    claims
      .filter((claim) => claim.kind !== "author-declared")
      .map((claim) => evidenceKey(claim.evidence)),
  );
  return {
    kinds,
    authorDeclared: kinds.includes("author-declared"),
    corroborated: independentSources.size >= 2,
  };
}

/**
 * The distinct values asserted across claims, in a deterministic order. More
 * than one entry means a contradiction, which is reported rather than
 * resolved.
 */
function distinctValues(claims: readonly Claim[]): JsonValue[] {
  const values: JsonValue[] = [];
  for (const claim of claims) {
    if (!values.some((existing) => jsonEquals(existing, claim.value))) {
      values.push(claim.value);
    }
  }
  return values;
}

function sortClaims(claims: readonly Claim[]): Claim[] {
  return [...claims].sort(
    (a, b) =>
      compareKinds(a.kind, b.kind) ||
      compareStrings(stableKey(a.value), stableKey(b.value)) ||
      compareStrings(evidenceKey(a.evidence), evidenceKey(b.evidence)),
  );
}

/**
 * Canonicalizes an evidence list: sorted by code-unit order, with exact
 * duplicates collapsed. Deduplication is what keeps "we looked in these five
 * places" from growing an entry per look once several probes report on the
 * same path — a repeated citation is not additional support.
 */
function normalizeEvidence(evidence: readonly Evidence[]): Evidence[] {
  const byKey = new Map<string, Evidence>();
  for (const item of evidence) {
    byKey.set(evidenceKey([item]), item);
  }
  return [...byKey.entries()].sort((a, b) => compareStrings(a[0], b[0])).map((entry) => entry[1]);
}

function evidenceKey(evidence: readonly Evidence[]): string {
  return evidence.map((item) => `${item.source} ${item.pointer ?? ""} ${item.detail ?? ""}`).join("");
}

/** A stable, locale-independent textual key for a JSON value. */
function stableKey(value: JsonValue): string {
  return JSON.stringify(value);
}

function compareIds(a: FactId, b: FactId): number {
  return compareStrings(a, b);
}

function compareKinds(a: KnownFactKind, b: KnownFactKind): number {
  return compareStrings(a, b);
}

/**
 * Code-unit comparison. Deliberately not `localeCompare`, whose result
 * depends on the host's locale and would make snapshot bytes
 * machine-dependent.
 */
function compareStrings(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

function jsonEquals(a: JsonValue, b: JsonValue): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== typeof b || a === null || b === null) {
    return false;
  }
  if (typeof a !== "object" || typeof b !== "object") {
    return false;
  }
  const leftArray = asJsonArray(a);
  const rightArray = asJsonArray(b);
  if (leftArray !== undefined || rightArray !== undefined) {
    if (leftArray === undefined || rightArray === undefined) {
      return false;
    }
    if (leftArray.length !== rightArray.length) {
      return false;
    }
    return leftArray.every((item, index) => jsonEquals(item, rightArray[index] ?? null));
  }
  const left = asJsonObject(a);
  const right = asJsonObject(b);
  if (left === undefined || right === undefined) {
    return false;
  }
  const leftKeys = Object.keys(left).sort(compareStrings);
  const rightKeys = Object.keys(right).sort(compareStrings);
  if (leftKeys.length !== rightKeys.length || leftKeys.some((k, i) => k !== rightKeys[i])) {
    return false;
  }
  return leftKeys.every((key) => {
    const leftValue = left[key];
    const rightValue = right[key];
    return leftValue !== undefined && rightValue !== undefined && jsonEquals(leftValue, rightValue);
  });
}

/**
 * Narrows a `JsonValue` to an array of JSON values, or undefined when it is
 * not one. Returning undefined rather than asserting keeps an unexpected
 * shape from being compared as if it were structurally sound.
 */
function asJsonArray(value: JsonValue): readonly JsonValue[] | undefined {
  return Array.isArray(value) ? (value as readonly JsonValue[]) : undefined;
}

/**
 * Narrows a `JsonValue` to a record, or undefined when it is not a non-array
 * object. An array is deliberately excluded: it is a list, not a mapping, and
 * the two are compared by different rules above.
 */
function asJsonObject(value: JsonValue): Readonly<Record<string, JsonValue>> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Readonly<Record<string, JsonValue>>;
}
