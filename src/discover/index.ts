/**
 * Public surface of the repository discovery core.
 *
 * Discovery is evidence acquisition. It is deliberately independent of CLI
 * presentation, adapter rendering, and verification execution, and it is the
 * lower layer that a future System Twin would consume — never the other way
 * round.
 */
export { discoverRepository, DEFAULT_PROBES } from "./discover.js";
export type { DiscoverOptions, DiscoverResult } from "./discover.js";
export { createProbeContext, resolveRepositoryRoot } from "./context.js";
export {
  buildAgreedFact,
  buildUnknownFact,
  hasEvidence,
  isContradictory,
  isKnownContribution,
  isSelfDescribing,
  mergeContributions,
} from "./fact.js";
export type { Contribution, KnownContribution, UnknownContribution } from "./fact.js";
export type {
  ContractStatus,
  DiscoveryProbe,
  DiscoveryProbeContext,
  ProbeResult,
} from "./probe.js";
export {
  DISCOVERY_SNAPSHOT_VERSION,
  FACT_IDS,
  isConflictedFact,
  isKnownFact,
  isUnknownFact,
} from "./types.js";
export type {
  AgreedFact,
  Claim,
  ConflictedFact,
  Corroboration,
  DiscoveryDiagnostic,
  DiscoveryDiagnosticCode,
  DiscoverySnapshot,
  DiscoverySummary,
  Evidence,
  Fact,
  FactId,
  FactKind,
  JsonValue,
  KnownFactKind,
  UnknownFact,
  UnknownReason,
} from "./types.js";
