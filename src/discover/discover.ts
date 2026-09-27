import { CANONICAL_CONTRACT_FILENAME } from "../contract/discovery.js";
import { loadContract } from "../contract/pipeline.js";
import type { FileSystem } from "../filesystem/types.js";
import { joinPath } from "../filesystem/pathJoin.js";
import { createProbeContext, resolveRepositoryRoot } from "./context.js";
import { compareCodeUnits } from "./ordering.js";
import { isContradictory, mergeContributions } from "./fact.js";
import type { Contribution } from "./fact.js";
import { readRepositoryLayout, toDiscoveryLayout } from "./packages/layout.js";
import { MAX_WORKSPACE_DEPTH, MAX_WORKSPACE_ENTRIES } from "./packages/expand.js";
import type {
  ContractPackageManagerClaim,
  ContractStatus,
  DiscoveryLayout,
  DiscoveryProbe,
  DiscoveryProbeContext,
  ProbeResult,
} from "./probe.js";
import { evidenceBudgetFor } from "./probe.js";
import { isIncompleteFact } from "./types.js";
import { contractPresenceProbe, contractValidityProbe } from "./probes/contract.js";
import { contractPackageManagerClaimProbe } from "./probes/contractClaim.js";
import { contractVerificationProbe } from "./probes/contractVerification.js";
import { commandsProbe, verificationEntrypointsProbe } from "./probes/commands.js";
import { declarationSurfaceProbe } from "./probes/declarationSurface.js";
import {
  packageManagerDeclarationProbe,
  packageManagerLockfileProbe,
} from "./probes/packageManager.js";
import {
  packagesProbe,
  workspaceCandidatesProbe,
  workspaceDeclarationsProbe,
  workspaceMembersProbe,
  workspaceRootProbe,
} from "./probes/workspace.js";
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
 * The Issue #36 and #37 probe set.
 *
 * Issue #36's contribution was the *substrate* — provenance, explicit
 * uncertainty, the absence-versus-failure distinction, contradiction
 * preservation, and a read-only capability boundary — proved with a four-fact
 * vocabulary and injected probes. Issue #37 supplies the first real domain, and
 * the substrate is what has to survive it.
 *
 * Ordering is a fixed list rather than a dependency graph, and that is
 * deliberate: probes are independent by construction (each performs its own
 * small set of reads through a context it cannot escape), and a shared read-only
 * layout memo keeps them from disagreeing about the same content. The order
 * therefore affects only which diagnostic is emitted first, never which facts
 * are produced.
 */
export const DEFAULT_PROBES: readonly DiscoveryProbe[] = [
  contractPresenceProbe,
  contractValidityProbe,
  declarationSurfaceProbe,
  packagesProbe,
  workspaceDeclarationsProbe,
  workspaceCandidatesProbe,
  workspaceMembersProbe,
  workspaceRootProbe,
  packageManagerDeclarationProbe,
  packageManagerLockfileProbe,
  contractPackageManagerClaimProbe,
  commandsProbe,
  verificationEntrypointsProbe,
  contractVerificationProbe,
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
  const layoutContext = probeContextSource(fs, repoRoot);
  const runContext = createProbeContext(
    fs,
    repoRoot,
    createContractReader(fs, repoRoot),
    createContractPackageManagerReader(fs, repoRoot),
    createContractVerificationReader(fs, repoRoot),
    createLayoutReader(layoutContext),
  );

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
    const result = normalizeProbeResult(probe, await runProbeSafely(probe, runContext));
    if (result.status === "found" || result.status === "asserted") {
      foundOutcomes++;
    }
    if (result.status === "failed") {
      failedOutcomes++;
      diagnostics.push(probeFailedDiagnostic(probe, result, probe.factId));
    }
    contributions.push(...toContributions(probe, result));
  }

  const facts = mergeContributions(contributions);
  diagnostics.push(...describeFacts(facts));
  const layoutDiagnostics = await describeLayout(runContext);
  diagnostics.push(...layoutDiagnostics);
  const incompleteLayoutItems = await countIncompleteLayout(runContext);
  if (foundOutcomes === 0 && failedOutcomes === 0) {
    // Only when every probe actually completed. With a failure in the set,
    // "no evidence" is not the finding — "not everything was looked at" is,
    // and DISCOVERY_PARTIAL already says so. Emitting both would put a
    // completeness claim in the same snapshot that contradicts it.
    diagnostics.push(noSignalsDiagnostic());
  }

  const summary = summarize(facts, contributions, incompleteLayoutItems);
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
 * Maps a probe outcome onto contributions. The four-way distinction is
 * translated here, in exactly one place, so no probe can quietly decide on its
 * own that a failure means absence.
 *
 * An `asserted` outcome expands into one contribution per claim, which is what
 * lets a single probe report on several fact identities — package managers are
 * scoped to a manifest, so the lockfile probe has to say *which* manifest each
 * artifact speaks for. Routing happens here and nowhere else, so the snapshot's
 * `Claim` shape stays free of merge plumbing.
 */
function toContributions(probe: DiscoveryProbe, result: ProbeResult): Contribution[] {
  switch (result.status) {
    case "found":
      return [
        {
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
        },
      ];
    case "asserted":
      return [
        ...result.claims.map((claim) => ({
          id: claim.factId,
          kind: claim.kind,
          value: claim.value,
          evidence: claim.evidence,
          ...(claim.projected !== undefined && { projected: claim.projected }),
        })),
        // An identity observed but not interpretable still gets a fact, so the
        // snapshot says "unknown, not-probed" rather than saying nothing.
        ...(result.unsupported ?? []).map((factId): Contribution => ({
          id: factId,
          reason: "not-probed",
          evidence: [],
        })),
      ];
    case "not-found":
      // An existence fact resolves to a known `false`: the inspection
      // completed and the thing is not there. A value fact cannot, because the
      // absence of evidence is not itself a value.
      return [
        probe.shape === "existence"
          ? { id: probe.factId, kind: probe.kind, value: false, evidence: result.evidence }
          : { id: probe.factId, reason: "no-evidence", evidence: result.evidence },
      ];
    case "failed":
      return [{ id: probe.factId, reason: "probe-failed", evidence: result.evidence }];
    case "unsupported":
      return [{ id: probe.factId, reason: "not-probed", evidence: [] }];
  }
}

/**
 * Enforces ADR-0045's evidence budget at the probe boundary.
 *
 * Under the amended corroboration rule a fact is corroborated once two claims
 * support it, so nothing structurally stops a probe from inflating its own
 * support by citing many paths, or by splitting one document into many claims.
 * Both are refused here, where they can still be refused, rather than being
 * documented as conventions a future probe might not notice.
 *
 * A violation is downgraded to a failed probe rather than trusted: a claim that
 * cannot be shown to come from one inspection has not established anything, and
 * a snapshot that quietly accepted it would report manufactured corroboration
 * with the confidence fields attached.
 */
function withinEvidenceBudget(result: ProbeResult): ProbeResult {
  if (result.status !== "asserted") {
    return result;
  }
  for (const claim of result.claims) {
    const budget = evidenceBudgetFor(claim.kind);
    if (claim.evidence.length > budget) {
      return {
        status: "failed",
        detail:
          `The probe produced a ${claim.kind} claim citing ${String(claim.evidence.length)} ` +
          `paths, above the budget of ${String(budget)} for that kind. Splitting one ` +
          "inspection into many claims would manufacture corroboration, so nothing was recorded.",
        evidence: claim.evidence,
      };
    }
    if (new Set(claim.evidence.map((item) => item.source)).size > budget) {
      return {
        status: "failed",
        detail:
          `The probe produced a ${claim.kind} claim citing more than ${String(budget)} ` +
          "distinct sources. One document is one source, so nothing was recorded.",
        evidence: claim.evidence,
      };
    }
  }
  const split = documentSplitAcrossClaims(result.claims);
  if (split !== undefined) {
    return {
      status: "failed",
      detail:
        `The probe split one document into ${String(split.claims)} claims, all citing ` +
        `${JSON.stringify(split.source)}. One document is one source, so treating them as ` +
        "independent support would manufacture corroboration from a single inspection; " +
        "nothing was recorded.",
      evidence: split.evidence,
    };
  }
  return result;
}

/**
 * The second half of the evidence invariant: a document is a source, and a
 * source makes at most one claim.
 *
 * The per-claim budget above bounds how many paths one claim may cite. It
 * cannot see the case this one sees, because the budget is checked per claim
 * and a probe that wants corroboration out of a single file does not need a
 * big budget — it needs *two claims*. Two `declared` claims from one document,
 * each citing one path, pass every budget above and would then be reported as
 * `corroborated: true`: one document appearing to confirm itself.
 *
 * So the check is across claims. A `source` cited by more than one claim of the
 * same result is a document this probe read once and turned into several
 * assertions, which is exactly the independence ADR-0045 refuses to
 * manufacture. It is refused here, at the boundary, for the same reason the
 * budget is: a claim that cannot be shown to come from one inspection has not
 * established anything.
 *
 * Genuinely independent evidence is unaffected. `package.json`'s
 * `packageManager` field and `pnpm-lock.yaml` are two documents and produce two
 * claims that do corroborate; a lockfile in each of two workspace members is
 * likewise two documents. Only one document cited twice is refused.
 */
function documentSplitAcrossClaims(
  claims: readonly { readonly evidence: readonly Evidence[] }[],
):
  | { readonly source: string; readonly claims: number; readonly evidence: readonly Evidence[] }
  | undefined {
  const bySource = new Map<string, { count: number; evidence: Evidence[] }>();
  for (const claim of claims) {
    for (const item of claim.evidence) {
      const entry = bySource.get(item.source);
      if (entry === undefined) {
        bySource.set(item.source, { count: 1, evidence: [item] });
        continue;
      }
      entry.count++;
      entry.evidence.push(item);
    }
  }
  // Sorted so a probe that splits several documents reports the same one every
  // time; a diagnostic that named a different source per run would be its own
  // non-determinism.
  for (const [source, entry] of [...bySource.entries()].sort((a, b) =>
    compareCodeUnits(a[0], b[0]),
  )) {
    if (entry.count > 1) {
      return { source, claims: entry.count, evidence: entry.evidence };
    }
  }
  return undefined;
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
  if (result.status === "asserted" && result.claims.length === 0) {
    if ((result.unsupported?.length ?? 0) > 0) {
      // Nothing could be claimed, but some identities were observed in a form
      // this version does not model. Those still need their facts, so the result
      // is kept rather than collapsed — collapsing it here is what previously
      // made an unmodelled package disappear from the snapshot.
      return result;
    }
    // A probe that asserts nothing has observed nothing it can support, and has
    // no identity to report as out of reach. For a value-shaped fact that is
    // `no-evidence`, not a failed probe: the inspection completed and there was
    // genuinely nothing there.
    return { status: "not-found", evidence: [] };
  }
  return withinEvidenceBudget(result);
}

function describeFacts(facts: readonly Fact[]): DiscoveryDiagnostic[] {
  const described: DiscoveryDiagnostic[] = [];
  for (const fact of facts) {
    if (isContradictory(fact)) {
      const asserted = fact.claims
        .map((claim) => `${claim.kind}=${JSON.stringify(claim.value)}`)
        .join(", ");
      described.push({
        code: "DISCOVERY_FACT_CONFLICT",
        severity: "warning",
        summary: `Sources disagree about ${fact.id}; the snapshot reports the conflict without choosing a winner.`,
        detail: `Claims: ${asserted}.`,
        remediation:
          "Inspect the cited evidence and decide which source is authoritative. Agent-Ready deliberately does not resolve this for you.",
        metadata: { factId: fact.id, claimedValues: fact.claims.map((claim) => claim.value) },
      });
      continue;
    }
    if (isIncompleteFact(fact)) {
      described.push({
        code: "DISCOVERY_FACT_INCOMPLETE",
        severity: "warning",
        summary: `${fact.id} is reported with a value that other repository evidence does not support.`,
        detail:
          `The declared value ${JSON.stringify(fact.value)} is contradicted by ` +
          `${fact.contradictedBy.map((value) => JSON.stringify(value)).join(", ")}. ` +
          "Every claim is retained; no source was preferred over another.",
        remediation:
          "Both the declaration and the contradicting artifacts are reported. Decide which is authoritative; Agent-Ready will not choose for you.",
        metadata: {
          factId: fact.id,
          claimedValues: fact.claims.map((claim) => claim.value),
          contradictedBy: fact.contradictedBy,
        },
      });
    }
  }
  return described;
}

/**
 * Describes a failed probe. `sourcePath` is the repository-relative path the
 * probe could not inspect, so the remediation can name the file to check
 * without a reader having to parse it back out of the free-text detail.
 */
/**
 * Describes what the shared layout learned, independently of any probe.
 *
 * Some conditions are only visible once the whole layout is in hand — a
 * declaration in a form we do not model, a pattern refused as unsafe, a walk
 * stopped by a bound, a manifest that will not parse — and attaching them to
 * whichever probe happened to notice would make the diagnostics depend on probe
 * order. They are described here instead, from the layout, so the same repository
 * always produces the same diagnostics in the same order.
 *
 * This is also the only place `DISCOVERY_FACT_UNSUPPORTED` is raised. The layout
 * is where manifests are read, so it is where a form this version does not model
 * is observed — and putting the diagnostic here rather than in a probe is what
 * stops it firing for a probe that simply had no subject. A repository with no
 * contract produces no unmodelled anything, and therefore no such diagnostic.
 */
async function describeLayout(context: DiscoveryProbeContext): Promise<DiscoveryDiagnostic[]> {
  let layout: DiscoveryLayout;
  try {
    layout = await context.readRepositoryLayout();
  } catch {
    // The probes already reported whatever failure got here. Adding a second
    // diagnostic for the same condition would double-count it.
    return [];
  }

  const described: DiscoveryDiagnostic[] = [];
  for (const declaration of layout.declarations) {
    if (declaration.unsupportedReason !== null) {
      described.push({
        code: "DISCOVERY_WORKSPACE_UNSUPPORTED",
        severity: "warning",
        summary: `The workspace declaration in ${declaration.source} is in a form this version does not model.`,
        detail: `${declaration.source}: ${declaration.unsupportedReason}. It was not interpreted, and no workspace membership was derived from it.`,
        remediation:
          "Use an array of strings, or an object with a packages array. Other forms are left uninterpreted rather than approximated.",
        metadata: { source: declaration.source, reason: declaration.unsupportedReason },
      });
    }
    for (const rejected of declaration.rejectedPatterns) {
      described.push({
        code: "DISCOVERY_WORKSPACE_UNSUPPORTED",
        severity: "warning",
        summary: `A workspace pattern in ${declaration.source} was not expanded.`,
        detail: `${declaration.source} declares ${JSON.stringify(rejected.raw)}, which was not expanded: ${rejected.reason}`,
        remediation:
          "Repository-relative patterns only. A pattern that is absolute or escapes the root is never read from the file system.",
        metadata: { source: declaration.source, pattern: rejected.raw, reason: rejected.reason },
      });
    }
  }

  if (layout.truncated) {
    described.push({
      code: "DISCOVERY_PARTIAL",
      severity: "warning",
      summary: "Workspace expansion stopped at its bound, so the candidate list is incomplete.",
      detail: `More than ${String(MAX_WORKSPACE_ENTRIES)} directory entries or ${String(MAX_WORKSPACE_DEPTH)} levels of nesting were reached while expanding workspace patterns. Paths beyond the bound are not reported.`,
      remediation:
        "Narrow the workspace patterns, or treat this snapshot's candidate list as a lower bound rather than a complete one.",
      metadata: { maxEntries: MAX_WORKSPACE_ENTRIES, maxDepth: MAX_WORKSPACE_DEPTH },
    });
  }

  for (const path of layout.unreadablePaths) {
    described.push({
      code: "DISCOVERY_PARTIAL",
      severity: "warning",
      summary: `A path matched by a workspace pattern could not be inspected: ${path}.`,
      detail:
        "The path is recorded with `present: null` rather than as absent, because failing to read something is not evidence that it is not there.",
      remediation: "Check read permissions on the path and re-run.",
      metadata: { path },
    });
  }

  for (const unmodelled of layout.unmodelledPackageManagers) {
    described.push({
      code: "DISCOVERY_FACT_UNSUPPORTED",
      severity: "warning",
      summary: `A package manager declaration in ${unmodelled.path} is in a form this version does not model.`,
      detail: `${unmodelled.path} declares ${JSON.stringify(unmodelled.raw)}, which is not a <name>@<version> string. No manager name was derived from it, and the field's value is reported here rather than guessed at.`,
      remediation:
        "Nothing needs fixing in the repository. Evidence from other sources for the same package is still reported and may still establish its manager.",
      metadata: { path: unmodelled.path, raw: unmodelled.raw },
    });
  }

  for (const located of layout.scripts) {
    if (located.status === "unsupported") {
      described.push({
        code: "DISCOVERY_FACT_UNSUPPORTED",
        severity: "warning",
        summary: `The scripts declaration in ${located.manifestPath} is in a form this version does not model.`,
        detail:
          located.unsupportedReason ??
          `${located.manifestPath} declares an unmodelled scripts shape.`,
        remediation:
          "Use a JSON object of name/command-string pairs. Other forms are left uninterpreted rather than approximated, and every command in every other package is still reported.",
        metadata: { path: located.manifestPath, field: "scripts" },
      });
    }
    for (const entry of located.unmodelled) {
      described.push({
        code: "DISCOVERY_FACT_UNSUPPORTED",
        severity: "warning",
        summary: `A script in ${located.manifestPath} is not a command string and was not interpreted.`,
        detail: `${located.manifestPath} declares ${entry.pointer}, which is ${entry.reason}. It was not converted to a command; every string-valued entry beside it still is.`,
        remediation:
          "Package script values must be strings. Nothing about the other declared scripts changed.",
        metadata: { path: located.manifestPath, script: entry.name, pointer: entry.pointer },
      });
    }
  }

  for (const broken of layout.brokenManifests) {
    described.push({
      code: "DISCOVERY_PARTIAL",
      severity: "warning",
      summary: `A package manifest could not be interpreted: ${broken.path}.`,
      detail:
        broken.status === "malformed"
          ? "The file exists and was read, but its contents are not a usable JSON object, so nothing is known about the package it declares."
          : "The file exists but could not be read, so nothing is known about the package it declares.",
      remediation:
        "Check the file's syntax and read permissions. Every other package in the repository is still reported; only this one is affected.",
      metadata: { path: broken.path, manifestStatus: broken.status },
    });
  }

  return described;
}

function probeFailedDiagnostic(
  probe: DiscoveryProbe,
  result: Extract<ProbeResult, { status: "failed" }>,
  factId: FactId,
): DiscoveryDiagnostic {
  const evidence = result.evidence;
  const sourcePath = evidence[0]?.source;
  // A probe that recognised *which* condition it hit names it, so a reader is
  // pointed at a code that explains the condition rather than at the generic
  // "a probe could not complete". `DISCOVERY_PARTIAL` stays the default: it is
  // the honest description of a failure nobody classified, and a probe that has
  // a specific code is stating something the generic one cannot.
  return {
    code: result.code ?? "DISCOVERY_PARTIAL",
    severity: "warning",
    summary: `Probe ${probe.id} could not complete, so ${factId} is reported as unknown.`,
    detail: result.detail,
    ...(sourcePath !== undefined && { sourcePath }),
    remediation:
      "Check file permissions and readability. The path was not inspected; it is not known to be absent.",
    metadata: { probeId: probe.id, factId },
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

/**
 * How many things left the snapshot short of complete.
 *
 * Counted from the layout rather than from probe outcomes because a truncated
 * walk and a broken manifest are both cases where every probe *succeeded* and
 * the repository is still not fully described. A consumer that trusts
 * `summary.complete` would otherwise believe it had the whole picture while a
 * bound had silently cost coverage — which is the one thing the flag exists to
 * prevent.
 */
async function countIncompleteLayout(context: DiscoveryProbeContext): Promise<number> {
  try {
    const layout = await context.readRepositoryLayout();
    return (
      layout.brokenManifests.length + layout.unreadablePaths.length + (layout.truncated ? 1 : 0)
    );
  } catch {
    // The probes already reported whatever failure got here. Counting it again
    // would double-report one condition.
    return 0;
  }
}

function summarize(
  facts: readonly Fact[],
  contributions: readonly Contribution[],
  incompleteLayoutItems: number,
): DiscoverySummary {
  const unknown = facts.filter((fact) => fact.kind === "unknown").length;
  const conflicts = facts.filter(isContradictory).length;
  return {
    facts: facts.length,
    known: facts.length - unknown,
    unknown,
    conflicts,
    complete:
      incompleteLayoutItems === 0 &&
      !contributions.some(
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
 * Reads the contract's package-manager claim, at most once per run.
 *
 * Separate from `createContractReader` because it answers a different question:
 * `readContract` asks whether a contract exists and validates, which is all
 * Issue #36 needed, and this asks what the contract *claims*. Sharing one memo
 * would put a content accessor behind a status accessor, which is exactly how a
 * maintainer's description reaches a discovered fact unlabelled.
 *
 * Returns undefined for an absent, invalid, or unreadable contract. In all three
 * cases there is no claim to report, and a claim invented from a broken contract
 * would be the worst possible outcome for the Phase 1 evaluation.
 */
function createContractPackageManagerReader(
  fs: FileSystem,
  repoRoot: string,
): () => Promise<ContractPackageManagerClaim | undefined> {
  let pending: Promise<ContractPackageManagerClaim | undefined> | undefined;
  return () => {
    pending ??= readContractPackageManager(fs, repoRoot);
    return pending;
  };
}

async function readContractPackageManager(
  fs: FileSystem,
  repoRoot: string,
): Promise<ContractPackageManagerClaim | undefined> {
  const loaded = await loadContract({ fs, startDir: repoRoot });
  if (!loaded.ok) {
    return undefined;
  }
  const declared = loaded.value.contract.environment.packageManager;
  if (declared === undefined) {
    return undefined;
  }
  return { name: declared.name, version: declared.version };
}

/**
 * Reads the contract's verification sequence, at most once per run.
 *
 * A separate memo for the same reason as the package-manager one: it answers a
 * different question from `readContract`, and folding content accessors into a
 * status accessor is how a maintainer's description reaches a discovered fact
 * without its `author-declared` label.
 *
 * Returns undefined for an absent, invalid, or unreadable contract. Command
 * discovery is downstream of this and must not fail when it is absent — the
 * repository's own commands are the primary answer, and the contract is only
 * ever a second, author-declared one.
 */
function createContractVerificationReader(
  fs: FileSystem,
  repoRoot: string,
): () => Promise<readonly string[] | undefined> {
  let pending: Promise<readonly string[] | undefined> | undefined;
  return () => {
    pending ??= readContractVerification(fs, repoRoot);
    return pending;
  };
}

async function readContractVerification(
  fs: FileSystem,
  repoRoot: string,
): Promise<readonly string[] | undefined> {
  const loaded = await loadContract({ fs, startDir: repoRoot });
  if (!loaded.ok) {
    return undefined;
  }
  const required = loaded.value.contract.verification.required;
  // The normalized contract always carries a `verification` block and defaults
  // `required` to the empty list, so "absent" and "declared empty" arrive here
  // as the same value. That is not a guess: the v1 schema requires at least one
  // entry, so a valid contract cannot declare an empty verification sequence and
  // the empty list can only mean the block was not written.
  if (required.length === 0) {
    return undefined;
  }
  // Verbatim, and deliberately unsorted. Verification sequence ordering is
  // source semantics (ADR-0046 §6), so canonicalising it would destroy a
  // declaration in the act of reporting it.
  return [...required];
}

/**
 * Builds the raw probe context used to gather the shared repository layout.
 *
 * Distinct from the context handed to probes so the layout is computed over the
 * *same* capability surface a probe would have — reads, stats, and listings, and
 * nothing else. If the layout were computed with more power than a probe has,
 * the read-only guarantee would be true of the probes and false of what they
 * were told.
 */
function probeContextSource(fs: FileSystem, repoRoot: string): DiscoveryProbeContext {
  const unavailable = (): never => {
    throw new Error("the layout must be read through the probe context, not the raw file system.");
  };
  return createProbeContext(fs, repoRoot, unavailable, unavailable, unavailable, unavailable);
}

/**
 * Gathers the shared package and workspace layout at most once per run.
 *
 * Two probes that each expanded the same patterns would be two answers to the
 * same question, and nothing guarantees they would agree. One memo makes the
 * second read impossible rather than merely unlikely.
 */
function createLayoutReader(context: DiscoveryProbeContext): () => Promise<DiscoveryLayout> {
  let pending: Promise<DiscoveryLayout> | undefined;
  return () => {
    pending ??= readRepositoryLayout(context).then(toDiscoveryLayout);
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
