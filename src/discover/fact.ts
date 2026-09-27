import type {
  AgreedFact,
  Claim,
  ConflictedFact,
  Corroboration,
  Evidence,
  Fact,
  FactId,
  IncompleteFact,
  JsonValue,
  KnownFactKind,
  UnknownFact,
  UnknownReason,
} from "./types.js";
import { compareCodeUnits } from "./ordering.js";

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
 * than order-dependent, because the order *is* the policy: a probe that failed
 * tells a consumer strictly more than one that declined to interpret, which in
 * turn tells more than one that completed and found nothing.
 *
 * `not-probed` outranks `no-evidence` for a reason Issue #37 forced. A manifest
 * that declares `packageManager: "workspace:*"` alongside no lockfile produces
 * one probe that read something it will not model and another that found
 * nothing. Reporting `no-evidence` there would say "we looked and there was
 * nothing", which is false — there was something, and we declined it. The
 * reason a consumer can act on is the one that names the obstruction.
 */
const REASON_INFORMATIVENESS: readonly UnknownReason[] = [
  "probe-failed",
  "not-probed",
  "no-evidence",
];

/**
 * The reason a reduction starts from: the least informative one in the table.
 *
 * Derived rather than written out so the two cannot drift. The two only agreed
 * by coincidence before, and when the order changed the hardcoded seed quietly
 * became the wrong end of the table — which reported every `no-evidence` fact as
 * `not-probed` and made absence look like a coverage gap.
 */
const LEAST_INFORMATIVE_REASON: UnknownReason = REASON_INFORMATIVENESS.at(-1) ?? "no-evidence";

/**
 * How claims for one fact identity are combined.
 *
 * `"value-equality"` is ADR-0044's rule and is right whenever two claims are
 * peers making the same sort of assertion: they agree, or they contradict, and
 * the honest options are a value or no value. It is *not* right for a fact
 * whose claims are about different things — see `"package-manager"`.
 *
 * The registry is a deliberate lookup rather than a per-probe strategy field
 * or a general combinator. A probe chooses what it observed; it does not get to
 * choose how disagreement with another probe is interpreted. That choice is a
 * semantic decision about a domain, and it lives in code a reviewer can read
 * here.
 */
export type FactMergeStrategy = "value-equality" | "package-manager";

const MERGE_STRATEGIES: Readonly<readonly (readonly [string, FactMergeStrategy])[]> = [
  ["repository.packageManager.", "package-manager"],
];

function mergeStrategyFor(id: FactId): FactMergeStrategy {
  for (const [prefix, strategy] of MERGE_STRATEGIES) {
    if (id.startsWith(prefix)) {
      return strategy;
    }
  }
  return "value-equality";
}

export interface KnownContribution {
  readonly id: FactId;
  readonly kind: KnownFactKind;
  readonly value: JsonValue;
  readonly evidence: readonly Evidence[];
  /**
   * Optional axis on which claims about this fact are compared when they are
   * not peers. Package-manager claims assert different *shapes* of thing — a
   * declaration string, a lockfile path — so comparing them verbatim would call
   * agreement a contradiction and contradiction agreement. The projection puts
   * them on a common axis.
   *
   * Internal only: it is stripped before the fact reaches the snapshot, so a
   * consumer never sees it and cannot mistake a projection for an observation.
   */
  readonly projected?: string;
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
 * Which claim decides a package-manager fact's carried-forward value, in
 * preference order.
 *
 * A `declared` claim comes first, and this ordering is the whole point. The
 * carried-forward value answers "what did the *repository* say", and a
 * maintainer's description is a claim _about_ the repository, not a statement
 * _of_ it. Without this order, a fact whose claims happen to sort with
 * `author-declared` first — which code-unit order does, being alphabetically
 * before `declared` — would carry the author's value as though the repository
 * had written it. That is precisely the promotion ADR-0044 forbids, reached
 * through the sort rather than through an explicit rule, which is the worst way
 * to reach it.
 *
 * `author-declared` is still a valid primary, so a contract on its own is not
 * discarded: the fact then has `kind: "author-declared"` and
 * `corroborated: false`, which is the visibly uncorroborated state ADR-0044
 * requires.
 */
const IDENTITY_PREFERENCE: readonly KnownFactKind[] = ["declared", "author-declared"];

/**
 * Builds a fact from claims that have already been reduced to what the snapshot
 * will show, where they all agree. Refuses to build one without evidence: a
 * known fact that cannot cite its source is a fabricated fact, and the only
 * legitimate response is to downgrade it to `unknown` upstream.
 */
function buildKnown(
  id: FactId,
  claims: readonly Claim[],
): AgreedFact | IncompleteFact | ConflictedFact {
  assertClaimsAreCitable(id, claims);
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
 * Builds a fact whose evidence is sufficient for a partial assertion and
 * insufficient for a complete one.
 *
 * `primaryClaim` is the claim whose value is carried forward, chosen by the
 * caller through `IDENTITY_PREFERENCE` rather than by sort order. `contradictedBy`
 * must be non-empty: a fact with no disagreement is an `AgreedFact`, which makes
 * "this is incomplete" checkable from the shape alone.
 *
 * No value is ever *chosen* here. Every claim is retained verbatim, and the
 * disagreement is published rather than resolved; carrying the primary claim
 * forward says what the repository asserted, not which source is right.
 */
export function buildIncompleteFact(
  id: FactId,
  claims: readonly Claim[],
  primaryClaim: Claim,
  contradictedBy: readonly JsonValue[],
): IncompleteFact {
  return {
    id,
    kind: strongestKind([...new Set(claims.map((claim) => claim.kind))].sort(compareKinds)),
    value: primaryClaim.value,
    claims,
    contradictedBy: sortJsonValues(contradictedBy),
    corroboration: describeCorroboration(claims),
  };
}

/**
 * Builds a fact whose sources agree. Refuses to build one without evidence:
 * a known fact that cannot cite its source is a fabricated fact, and the only
 * legitimate response is to downgrade it to `unknown` upstream.
 */
export function buildAgreedFact(id: FactId, claims: readonly Claim[]): AgreedFact | ConflictedFact {
  assertClaimsAreCitable(id, claims);
  const built = buildKnown(id, claims);
  // `buildKnown` can only return an incomplete fact when a caller passes
  // contradicting values, which this entry point never does. The assertion keeps
  // that guarantee mechanical rather than a comment: if a future change made
  // `buildKnown` disagree here, this fails at compile time instead of letting an
  // incomplete fact escape through an API typed as settled-or-conflicted.
  if ("contradictedBy" in built && built.contradictedBy !== undefined) {
    throw new Error(`Cannot build an agreed fact for "${id}" from contradicting claims.`);
  }
  return built;
}

function assertClaimsAreCitable(id: FactId, claims: readonly Claim[]): void {
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
 * a disagreement surfaces as a conflict or an incomplete fact instead of two
 * facts that appear to agree.
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
      facts.push(
        mergeStrategyFor(id) === "package-manager"
          ? mergePackageManagerClaims(id, entry.known)
          : buildKnown(
              id,
              entry.known.map((known) => ({
                kind: known.kind,
                value: known.value,
                evidence: known.evidence,
              })),
            ),
      );
      continue;
    }
    // Seeded from the table rather than written out, so the seed can never drift
    // from the policy. Hardcoding it worked only while the table happened to end
    // with the same value it started as; when the order changed, the seed became
    // silently wrong and every `no-evidence` fact was reported as `not-probed`.
    const reason = entry.unknown.reduce<UnknownReason>(
      (most, candidate) =>
        REASON_INFORMATIVENESS.indexOf(candidate.reason) < REASON_INFORMATIVENESS.indexOf(most)
          ? candidate.reason
          : most,
      LEAST_INFORMATIVE_REASON,
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
 * Combines package-manager claims, which assert different *shapes* of thing.
 *
 * Claims are compared on a *projection* — the manager name — rather than on
 * their raw values. A `declared` claim carries `pnpm@10.0.0` and a `derived`
 * one carries `pnpm-lock.yaml`; compared verbatim they would contradict each
 * other while agreeing completely. Projecting both to `pnpm` is what makes
 * "these two sources agree" expressible at all.
 *
 * The three outcomes, and why they are three:
 *
 *  - Every projectable claim indicates the same manager: an agreed fact. A
 *    `packageManager` field naming pnpm beside a `pnpm-lock.yaml` is two
 *    independent sources agreeing, which is the one case where corroboration is
 *    real.
 *  - An identity claim indicates a *different* manager from some other claim: an
 *    **incomplete** fact. The identity claim is carried forward, the managers it
 *    disagrees with are published in `contradictedBy`, and no winner is named.
 *    Reporting no value would deny that the repository declared anything;
 *    reporting the artifact would promote a file to an opinion.
 *  - No identity claim, and the artifacts disagree with each other: a
 *    **conflict** with no value at all. `pnpm-lock.yaml`, `yarn.lock`, and
 *    `package-lock.json` together is the canonical case, and it must never
 *    resolve to whichever manager happens to appear first in a table.
 *
 * Claims that cannot indicate a manager — an unrecognized lockfile name, a
 * `packageManager` field that is not `<name>@<version>` — project to undefined
 * and are excluded from agreement in both directions. They carry no weight, and
 * the probe that saw them is responsible for saying so out loud.
 */
function mergePackageManagerClaims(
  id: FactId,
  contributions: readonly KnownContribution[],
): AgreedFact | IncompleteFact | ConflictedFact {
  const projectable = contributions.filter(
    (known): known is KnownContribution & { readonly projected: string } =>
      known.projected !== undefined,
  );
  const claims = sortClaims(contributions.map(toClaim));
  const kind = strongestKind([...new Set(claims.map((claim) => claim.kind))].sort(compareKinds));
  const projections = [...new Set(projectable.map((known) => known.projected))].sort(
    compareCodeUnits,
  );

  // The identity claim, chosen by explicit preference rather than by sort order.
  // Everything that projects to a different manager contradicts it, whether it is
  // a lockfile or the author's own contract — a maintainer disagreeing with the
  // repository is a disagreement the snapshot must show, not one to smooth over.
  const primary = projectable.find(
    (known) => known.kind === IDENTITY_PREFERENCE.find((kind) => kind === known.kind),
  );

  if (projections.length === 0) {
    // Nothing could indicate a manager, yet something was observed. There is no
    // value to report and no disagreement to publish, so this takes the same
    // honest shape as a conflict: no value, every claim retained.
    return { id, kind, claims, corroboration: describeCorroboration(claims) };
  }

  if (projections.length === 1) {
    return {
      id,
      kind,
      // Everything agrees, so there is nothing to resolve. The identity claim's
      // own value is preferred where there is one, because a declaration carries
      // a pinned version that a bare lockfile path does not.
      value: toClaim(primary ?? (projectable[0] as KnownContribution)).value,
      claims,
      corroboration: describeCorroboration(claims),
    };
  }

  if (primary === undefined) {
    // The artifacts disagree with each other and nothing was declared, so there
    // is no claim to carry forward. `pnpm-lock.yaml` beside `yarn.lock` has no
    // answer, and inventing one from table order is the confidently-wrong result
    // this whole boundary exists to prevent.
    return { id, kind, claims, corroboration: describeCorroboration(claims) };
  }

  return buildIncompleteFact(
    id,
    claims,
    toClaim(primary),
    projections.filter((projection) => projection !== primary.projected),
  );
}

function toClaim(known: KnownContribution): Claim {
  return { kind: known.kind, value: known.value, evidence: known.evidence };
}

/**
 * Describes how much independent support a merged fact actually has.
 *
 * **Amended by ADR-0045.** ADR-0044 defined `corroborated` as "two claims whose
 * evidence comes from different files", which holds for the single-file facts
 * that issue shipped and collapses for a fact whose evidence is naturally
 * spread over several files: a package manager evidenced by three lockfiles
 * would report `corroborated: false` for every one of its claims, so the field
 * would carry no information in the one domain it was needed for.
 *
 * `corroborated` now means **at least two claims support the value**. The
 * property the original rule protected — a single source must not be presented
 * as though the repository confirmed itself — is preserved by two narrower
 * rules rather than by counting cited paths:
 *
 *  1. **One claim is one source.** A probe that looked at four lockfiles made
 *     one assertion, and splitting it into four claims to manufacture
 *     corroboration is forbidden. The evidence budget is enforced in
 *     `discover.ts`, which rejects a claim citing more paths than its kind
 *     allows.
 *  2. **One document is one source.** No probe may split a single document into
 *     more than one claim, so independence can never be manufactured by
 *     re-reading the same field. `package.json`'s `packageManager` field and a
 *     lockfile genuinely are independent and do corroborate; a second probe of
 *     the same field is not, and cannot be written.
 */
function describeCorroboration(claims: readonly Claim[]): Corroboration {
  const kinds = [...new Set(claims.map((claim) => claim.kind))].sort(compareKinds);
  const independentSources = claims.filter((claim) => claim.kind !== "author-declared");
  return {
    kinds,
    authorDeclared: kinds.includes("author-declared"),
    corroborated: independentSources.length >= 2,
  };
}

/**
 * The distinct values asserted across claims, in a deterministic order. More
 * than one entry means a contradiction, which is reported rather than
 * resolved.
 */
function distinctValues(claims: readonly Claim[]): JsonValue[] {
  return sortJsonValues(dedupeByValue(claims.map((claim) => claim.value)));
}

function dedupeByValue(values: readonly JsonValue[]): JsonValue[] {
  const result: JsonValue[] = [];
  for (const value of values) {
    if (!result.some((existing) => jsonEquals(existing, value))) {
      result.push(value);
    }
  }
  return result;
}

/**
 * Canonical order for a set of JSON values: deduplicated, then sorted by their
 * serialized form in code-unit order. Serialization is used as the key because
 * it is already the snapshot's own canonical form, so the order here cannot
 * drift from the order a consumer sees in the JSON.
 */
function sortJsonValues(values: readonly JsonValue[]): JsonValue[] {
  return dedupeByValue(values).sort((a, b) => compareCodeUnits(stableKey(a), stableKey(b)));
}

function sortClaims(claims: readonly Claim[]): Claim[] {
  return [...claims].sort(
    (a, b) =>
      compareKinds(a.kind, b.kind) ||
      compareCodeUnits(stableKey(a.value), stableKey(b.value)) ||
      compareCodeUnits(evidenceKey(a.evidence), evidenceKey(b.evidence)),
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
  return [...byKey.entries()].sort((a, b) => compareCodeUnits(a[0], b[0])).map((entry) => entry[1]);
}

function evidenceKey(evidence: readonly Evidence[]): string {
  return evidence
    .map((item) => `${item.source}\u0000${item.pointer ?? ""}\u0000${item.detail ?? ""}`)
    .join("\u0001");
}

/** A stable, locale-independent textual key for a JSON value. */
function stableKey(value: JsonValue): string {
  return JSON.stringify(value);
}

function compareIds(a: FactId, b: FactId): number {
  return compareCodeUnits(a, b);
}

function compareKinds(a: KnownFactKind, b: KnownFactKind): number {
  return compareCodeUnits(a, b);
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
  const leftKeys = Object.keys(left).sort(compareCodeUnits);
  const rightKeys = Object.keys(right).sort(compareCodeUnits);
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
