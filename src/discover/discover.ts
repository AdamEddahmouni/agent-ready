import { CANONICAL_CONTRACT_FILENAME } from "../contract/discovery.js";
import { loadContract } from "../contract/pipeline.js";
import type { FileSystem } from "../filesystem/types.js";
import { joinPath } from "../filesystem/pathJoin.js";
import { createProbeContext, resolveRepositoryRoot } from "./context.js";
import { isContradictory, mergeContributions } from "./fact.js";
import type { Contribution } from "./fact.js";
import type { ContractStatus, DiscoveryProbe, ProbeResult } from "./probe.js";
import { contractPresenceProbe, contractValidityProbe } from "./probes/contract.js";
import { declarationSurfaceProbe } from "./probes/declarationSurface.js";
import type {
  DiscoveryDiagnostic,
  DiscoverySnapshot,
  DiscoverySummary,
  Evidence,
  Fact,
  FactId,
} from "./types.js";
import { DISCOVERY_SNAPSHOT_VERSION } from "./types.js";

/**
 * The Issue #36 probe set.
 *
 * Deliberately tiny. This issue's deliverable is the discovery *substrate* —
 * provenance, explicit uncertainty, the absence-versus-failure distinction,
 * contradiction preservation, and the read-only capability boundary — and every
 * one of those is provable without a substantive repository domain.
 *
 * `declarationSurfaceProbe` is here as a deliberately minimal heterogeneous
 * existence probe: it demonstrates the substrate against something other than
 * the Agent-Ready contract itself, and it reads presence only, never
 * interpreting what any of those files say.
 *
 * Package, workspace, command, and module-graph discovery are Issue #37 and
 * later. Shipping a real domain here would make #36 look like a partial #37 and
 * would put the architecture decisions and the first domain expansion in the
 * same review, which is how the layering gets lost. The contradiction and
 * corroboration machinery that package-manager discovery needs is built and
 * tested here; the probes that exercise it arrive in #37.
 */
export const DEFAULT_PROBES: readonly DiscoveryProbe[] = [
  contractPresenceProbe,
  contractValidityProbe,
  declarationSurfaceProbe,
];

export interface DiscoverOptions {
  /** Directory the walk starts from. Defaults to the file system's cwd. */
  readonly startDir?: string;
  /** Overrides the built-in probe set. Used by tests to inject failures. */
  readonly probes?: readonly DiscoveryProbe[];
}

export type DiscoverResult =
  | { readonly ok: true; readonly snapshot: DiscoverySnapshot; readonly repoRoot: string }
  | { readonly ok: false; readonly diagnostics: readonly DiscoveryDiagnostic[] };

/**
 * Discovers a deterministic repository snapshot.
 *
 * Read-only by construction: the only capability handed to a probe is
 * repository-relative reading and stat-ing. There is no writer, no process
 * runner, no Git client, no HTTP client, and no clock in the path, so the
 * command cannot mutate the repository, execute anything, or reach the
 * network even by mistake.
 *
 * Diagnostics describe the discovery operation. Facts describe what is known
 * about the repository. The two are deliberately separate: a probe that
 * failed produces both a `DISCOVERY_PARTIAL` diagnostic and a
 * `repository.*` fact that is `unknown` with reason `probe-failed`, and
 * neither is a duplicate of the other.
 */
export async function discoverRepository(
  fs: FileSystem,
  options: DiscoverOptions = {},
): Promise<DiscoverResult> {
  const startDir = options.startDir ?? fs.cwd;
  const resolved = await resolveRepositoryRoot(fs, startDir);
  if (!resolved.ok) {
    return { ok: false, diagnostics: [resolved.diagnostic] };
  }

  const { repoRoot, evidence } = resolved.root;
  const probes = options.probes ?? DEFAULT_PROBES;
  const probeContext = createProbeContext(fs, repoRoot, createContractReader(fs, repoRoot));

  const diagnostics: DiscoveryDiagnostic[] = [];
  const contributions: Contribution[] = [
    // The root is a precondition rather than an observation, so it is
    // established directly instead of through a probe. Its value is the
    // repository-relative anchor: absolute paths are excluded so that
    // identical repository content yields identical bytes on any machine.
    {
      id: "repository.root",
      kind: "derived",
      value: ".",
      evidence,
    },
  ];

  let foundOutcomes = 0;
  let failedOutcomes = 0;
  for (const probe of probes) {
    const result = normalizeProbeResult(probe, await runProbeSafely(probe, probeContext));
    if (result.status === "found") {
      foundOutcomes++;
    }
    if (result.status === "failed") {
      failedOutcomes++;
      diagnostics.push(
        probeFailedDiagnostic(probe.id, probe.factId, result.detail, result.evidence),
      );
    }
    contributions.push(toContribution(probe, result));
  }

  const facts = mergeContributions(contributions);
  diagnostics.push(...describeFacts(facts));
  if (foundOutcomes === 0 && failedOutcomes === 0) {
    // Only when every probe actually completed. With a failure in the set,
    // "no evidence" is not the finding — "not everything was looked at" is,
    // and DISCOVERY_PARTIAL already says so. Emitting both would put a
    // completeness claim in the same snapshot that contradicts it.
    diagnostics.push(noSignalsDiagnostic());
  }

  const summary = summarize(facts, contributions);
  return {
    ok: true,
    repoRoot,
    snapshot: {
      ok: true,
      snapshotVersion: DISCOVERY_SNAPSHOT_VERSION,
      facts: toFactRecord(facts),
      summary,
      diagnostics,
      root: ".",
    },
  };
}

/**
 * Maps a probe outcome onto a contribution. The four-way distinction is
 * translated here, in exactly one place, so no probe can quietly decide on its
 * own that a failure means absence.
 */
function toContribution(probe: DiscoveryProbe, result: ProbeResult): Contribution {
  switch (result.status) {
    case "found":
      return {
        id: probe.factId,
        kind: probe.kind,
        // `found` means the probe observed something. Only a probe that
        // observed *no value at all* takes the existence default of `true`
        // ("it is there"). An observed `false` — an `agent-ready.yaml` that
        // is a directory, an invalid contract — and an observed `null` are
        // real observations and must survive verbatim. Defaulting on
        // nullishness would silently convert a value the probe did report
        // into a different one, which is the exact fabrication this whole
        // boundary exists to prevent.
        value: result.value === undefined ? true : result.value,
        evidence: result.evidence,
      };
    case "not-found":
      // An existence fact resolves to a known `false`: the inspection
      // completed and the thing is not there. A value fact cannot, because
      // the absence of evidence is not itself a value.
      return probe.shape === "existence"
        ? { id: probe.factId, kind: probe.kind, value: false, evidence: result.evidence }
        : { id: probe.factId, reason: "no-evidence", evidence: result.evidence };
    case "failed":
      return { id: probe.factId, reason: "probe-failed", evidence: result.evidence };
    case "unsupported":
      return { id: probe.factId, reason: "not-probed", evidence: [] };
  }
}

/**
 * Checks a probe's result against the shape the probe declared.
 *
 * An existence probe legitimately reports `found` with no value — "it is
 * there" is the whole answer — and that becomes `true`. A *value* probe
 * reporting `found` with no value has not said what it found, and defaulting it
 * to `true` would record a value the probe never observed. That is downgraded to
 * a failed probe here, for the same reason a thrown probe is: a probe that
 * established nothing must not become a repository fact.
 *
 * This is what makes the existence default in `toContribution` safe: by the
 * time a result reaches the merge, a value-shaped probe can only arrive with a
 * value actually present — including `null` and `false`, which are observations,
 * not absences.
 */
function normalizeProbeResult(probe: DiscoveryProbe, result: ProbeResult): ProbeResult {
  if (result.status === "found" && probe.shape === "value" && result.value === undefined) {
    return {
      status: "failed",
      detail:
        "The probe reported that it found a value but supplied none, so nothing was recorded.",
      evidence: result.evidence,
    };
  }
  return result;
}

function describeFacts(facts: readonly Fact[]): DiscoveryDiagnostic[] {
  return facts.filter(isContradictory).map((fact) => {
    const asserted = fact.claims
      .map((claim) => `${claim.kind}=${JSON.stringify(claim.value)}`)
      .join(", ");
    return {
      code: "DISCOVERY_FACT_CONFLICT",
      severity: "warning",
      summary: `Sources disagree about ${fact.id}; the snapshot reports the conflict without choosing a winner.`,
      detail: `Claims: ${asserted}.`,
      remediation:
        "Inspect the cited evidence and decide which source is authoritative. Agent-Ready deliberately does not resolve this for you.",
      metadata: {
        factId: fact.id,
        claimedValues: fact.claims.map((claim) => claim.value),
      },
    };
  });
}

/**
 * Describes a failed probe. `sourcePath` is the repository-relative path the
 * probe could not inspect, so the remediation can name the file to check
 * without a reader having to parse it back out of the free-text detail.
 */
function probeFailedDiagnostic(
  probeId: string,
  factId: FactId,
  detail: string,
  evidence: readonly Evidence[],
): DiscoveryDiagnostic {
  const sourcePath = evidence[0]?.source;
  return {
    code: "DISCOVERY_PARTIAL",
    severity: "warning",
    summary: `Probe ${probeId} could not complete, so ${factId} is reported as unknown.`,
    detail,
    ...(sourcePath !== undefined && { sourcePath }),
    remediation:
      "Check file permissions and readability. The path was not inspected; it is not known to be absent.",
    metadata: { probeId, factId },
  };
}

function noSignalsDiagnostic(): DiscoveryDiagnostic {
  return {
    code: "DISCOVERY_NO_SIGNALS",
    severity: "warning",
    summary: "No repository signal was found. Every probe completed and none found evidence.",
    detail:
      "This is a complete, valid result for a repository that contains none of the probed signals.",
    remediation: "Confirm --root points at the repository you intended to inspect.",
  };
}

function summarize(
  facts: readonly Fact[],
  contributions: readonly Contribution[],
): DiscoverySummary {
  const unknown = facts.filter((fact) => fact.kind === "unknown").length;
  const conflicts = facts.filter(isContradictory).length;
  return {
    facts: facts.length,
    known: facts.length - unknown,
    unknown,
    conflicts,
    complete: !contributions.some(
      (contribution) => !("value" in contribution) && contribution.reason === "probe-failed",
    ),
  };
}

function toFactRecord(facts: readonly Fact[]): Readonly<Record<string, Fact>> {
  const record: Record<string, Fact> = {};
  for (const fact of facts) {
    record[fact.id] = fact;
  }
  return record;
}

/**
 * A probe that throws has not established anything, and treating a thrown
 * error as a result would let an unexpected internal failure masquerade as a
 * repository fact. It is downgraded to a failed probe instead.
 */
async function runProbeSafely(
  probe: DiscoveryProbe,
  context: Parameters<DiscoveryProbe["run"]>[0],
): Promise<ProbeResult> {
  try {
    return await probe.run(context);
  } catch (error) {
    return {
      status: "failed",
      detail: error instanceof Error ? error.message : "The probe threw an unknown error.",
      evidence: [],
    };
  }
}

/**
 * Loads the contract at most once per discovery run. The memo is scoped to a
 * single run, so no result can leak between invocations, and it changes no
 * observable behaviour — it only avoids parsing the same file twice.
 */
function createContractReader(fs: FileSystem, repoRoot: string): () => Promise<ContractStatus> {
  let pending: Promise<ContractStatus> | undefined;
  return () => {
    pending ??= loadContractStatus(fs, repoRoot);
    return pending;
  };
}

/**
 * Reports only whether a contract exists and whether it is valid. Nothing is
 * extracted from it: a contract that is allowed to contribute facts of its own
 * is Issue #37, and returning a content summary here is precisely how a
 * maintainer's description would reach the snapshot unlabelled.
 */
async function loadContractStatus(fs: FileSystem, repoRoot: string): Promise<ContractStatus> {
  try {
    const stat = await fs.stat(joinPath(repoRoot, CANONICAL_CONTRACT_FILENAME));
    if (stat?.isFile !== true) {
      return { status: "absent" };
    }
  } catch (error) {
    return {
      status: "failed",
      detail: error instanceof Error ? error.message : "The contract path could not be inspected.",
    };
  }

  const loaded = await loadContract({ fs, startDir: repoRoot });
  if (!loaded.ok) {
    const first = loaded.diagnostics[0];
    return {
      status: "invalid",
      reason: first === undefined ? "the contract did not validate" : first.code,
    };
  }
  return { status: "valid" };
}
