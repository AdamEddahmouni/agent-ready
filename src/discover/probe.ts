import type { Evidence, FactId, KnownFactKind, JsonValue } from "./types.js";

/**
 * A probe is a bounded, read-only inspection that gathers evidence for one
 * conceptual fact. Probes are independent of the CLI, of presentation, and of
 * each other: each performs its own small set of reads and reports only what
 * it observed.
 *
 * The outcome is a four-way distinction, and collapsing any pair of these
 * would be a correctness bug rather than a simplification:
 *
 *  - `found`        — the thing was observed; evidence is non-empty.
 *  - `not-found`    — the inspection completed and the thing is absent. This
 *                     is evidence of absence, not ignorance.
 *  - `failed`       — the inspection could not be completed (permissions,
 *                     I/O error). This is ignorance, and it is *not* evidence
 *                     that the thing is absent.
 *  - `unsupported`  — the probe is out of scope for this repository or run.
 *
 * A probe must never return `undefined`, `null`, or an empty result to mean
 * "several different things".
 */
export type ProbeResult =
  | { readonly status: "found"; readonly value?: JsonValue; readonly evidence: readonly Evidence[] }
  | { readonly status: "not-found"; readonly evidence: readonly Evidence[] }
  | { readonly status: "failed"; readonly detail: string; readonly evidence: readonly Evidence[] }
  | { readonly status: "unsupported"; readonly detail: string };

export interface DiscoveryProbe {
  /** Stable probe identifier, used in diagnostics metadata. */
  readonly id: string;
  /** The conceptual fact this probe reports on. */
  readonly factId: FactId;
  /** The epistemic kind a `found` outcome from this probe carries. */
  readonly kind: KnownFactKind;
  /**
   * How a `not-found` outcome should be interpreted. An `existence` fact
   * resolves to a known `false` (we checked, it is not there); a `value` fact
   * becomes `unknown` with reason `no-evidence`, because absence of evidence
   * is not a value.
   */
  readonly shape: "existence" | "value";
  run(context: DiscoveryProbeContext): Promise<ProbeResult>;
}

/**
 * The only capability a probe receives. It can read files and stat paths; it
 * cannot write, cannot execute processes, and cannot reach the network. The
 * absence of a runner, a Git client, or an HTTP client in this interface is
 * the read-only guarantee from ADR-0044, enforced by construction.
 */
/**
 * The slice of a loaded contract that discovery is allowed to see. Discovery
 * treats a contract as a source of *claims*, not as repository truth, so it
 * receives the minimum it needs to report an author-declared fact and nothing
 * that would let it reimplement contract validation.
 */
export interface ContractSummary {
  /** `environment.packageManager.name`, when the contract declares one. */
  readonly packageManagerName?: string;
}

export type ContractStatus =
  | { readonly status: "absent" }
  | { readonly status: "invalid"; readonly reason: string }
  | { readonly status: "failed"; readonly detail: string }
  | { readonly status: "valid"; readonly summary: ContractSummary };

export interface DiscoveryProbeContext {
  /** Absolute path of the repository root, already resolved. */
  readonly repoRoot: string;
  /** Read a repository-relative path as UTF-8 text. */
  readTextFile(relativePath: string): Promise<string>;
  /** Stat a repository-relative path. Returns undefined when nothing exists. */
  stat(
    relativePath: string,
  ): Promise<{ readonly isFile: boolean; readonly isDirectory: boolean } | undefined>;
  /**
   * Narrow, read-only contract access. The returned status keeps "there is no
   * contract" separate from "the contract is broken", which is the same
   * absence-versus-failure distinction the file-system helpers preserve.
   * Implementations must not cache across discovery runs.
   */
  readContract(): Promise<ContractStatus>;
}
