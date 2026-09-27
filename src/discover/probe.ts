import type { DiscoveryDiagnosticCode } from "./types.js";
import type {
  Evidence,
  FactId,
  JsonValue,
  KnownFactKind,
  PackageEntry,
  WorkspaceCandidateEntry,
  WorkspaceDeclarationForm,
} from "./types.js";

/**
 * One source's assertion about one fact, as a probe states it.
 *
 * `factId` is part of this type rather than inherited from the probe because a
 * single probe may legitimately report on several identities: a package
 * manager is scoped to a manifest, so the lockfile and declaration probes each
 * have to name which manifest they are talking about. The fact id is routing
 * information for the merge, and is dropped before the claim reaches the
 * snapshot — `Claim` in `types.ts` has no such field, so a consumer cannot
 * mistake it for an observation.
 */
export interface ProbeClaim {
  readonly factId: FactId;
  readonly kind: KnownFactKind;
  readonly value: JsonValue;
  readonly evidence: readonly Evidence[];
  /**
   * The axis on which this claim is compared to others about the same fact, for
   * claims that assert different shapes of thing. A declaration says
   * `"pnpm@10.0.0"`; a lockfile says `"pnpm-lock.yaml"`; compared verbatim they
   * would contradict each other when they agree. Both project to `pnpm`.
   */
  readonly projected?: string;
}

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
 *  - `asserted`     — several independent claims about one or more facts.
 *  - `not-found`    — the inspection completed and the thing is absent. This
 *                     is evidence of absence, not ignorance.
 *  - `failed`       — the inspection could not be completed (permissions,
 *                     I/O error). This is ignorance, and it is *not* evidence
 *                     that the thing is absent.
 *  - `unsupported`  — the probe completed and read something, but there is
 *                     nothing here it can turn into a claim. The fact becomes
 *                     `unknown` with reason `not-probed`.
 *
 * `unsupported` deliberately carries no reason code, and Issue #37 removed the
 * one it briefly had. The distinction it encoded — "there was no subject" versus
 * "the subject is in a form we do not model" — is real and worth keeping, but it
 * does not belong on the probe result: both cases produce the same *fact*, and
 * only one of them warrants a diagnostic. The subject's shape is observed where
 * the document is read, so the diagnostic is raised there, and a probe that found
 * no subject at all stays silent. That is what keeps a code meant for "I read
 * something I do not model" from firing on every repository without a contract.
 *
 * A probe must never return `undefined`, `null`, or an empty result to mean
 * "several different things".
 */
export type ProbeResult =
  | { readonly status: "found"; readonly value?: JsonValue; readonly evidence: readonly Evidence[] }
  | {
      readonly status: "asserted";
      readonly claims: readonly ProbeClaim[];
      /**
       * Identities this probe observed but cannot say anything about, because
       * what it found is in a form this version does not model.
       *
       * Separate from `claims` because an unmodelled identity must still produce
       * a *fact* — `unknown` with reason `not-probed` — rather than nothing at
       * all. Omitting it made a workspace member with an unmodelled
       * `packageManager` field simply absent from the snapshot, which is the one
       * outcome this project forbids outright: silence. The accompanying
       * `DISCOVERY_FACT_UNSUPPORTED` diagnostic is raised by the layout, which is
       * where the shape was read; this list exists so the *fact* is not missing.
       */
      readonly unsupported?: readonly FactId[];
    }
  | { readonly status: "not-found"; readonly evidence: readonly Evidence[] }
  | {
      readonly status: "failed";
      readonly detail: string;
      readonly evidence: readonly Evidence[];
      /**
       * The diagnostic code this failure is, when the probe recognised which
       * condition it hit.
       *
       * `DISCOVERY_PARTIAL` is the honest default — "a probe could not
       * complete" — and a probe that has nothing more specific should leave
       * this absent. Naming a code is a claim that the condition is one a
       * reader can be told about and looked up, so it is only for a failure the
       * probe can describe precisely: the lockfile probe saying "a lockfile
       * could not be inspected" knows more than "the probe failed", and the
       * diagnostic is what tells `agent-ready explain` which page to open.
       *
       * Absent means `DISCOVERY_PARTIAL`. It never changes the fact: a failed
       * probe is `unknown` with reason `probe-failed` whichever code is
       * reported, so a more specific diagnostic cannot make ignorance look
       * like an observation.
       */
      readonly code?: DiscoveryDiagnosticCode;
    }
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
 * How many distinct paths a single claim of each kind may cite.
 *
 * **Added by ADR-0045.** Under the amended corroboration rule, a fact is
 * corroborated once two claims support it, so nothing stops a probe from
 * inflating its own support by citing one file under many claims. This budget
 * closes that hole at the only place it can be closed: the probe boundary.
 *
 * A `derived` claim is allowed two paths because that is the honest shape of
 * the package-manager claim — "there is a pnpm-specific artifact at
 * `pnpm-lock.yaml`" legitimately cites both the lockfile that establishes *which*
 * manager and the manifest it was found beside. One claim is still one assertion
 * regardless of how many paths it cites, so this does not weaken the rule; it
 * stops the count of citations from being laundered into the count of sources.
 *
 * `author-declared` is held to one path because the contract is a single
 * document, and a claim that cited several files from it would be claiming to be
 * several sources when it is one.
 */
export function evidenceBudgetFor(kind: KnownFactKind): number {
  return kind === "derived" ? 2 : 1;
}

/**
 * The only capability a probe receives. It can read files and stat paths; it
 * cannot write, cannot execute processes, and cannot reach the network. The
 * absence of a runner, a Git client, or an HTTP client in this interface is
 * the read-only guarantee from ADR-0044, enforced by construction.
 */
/**
 * Whether a contract could be loaded, and if not, why.
 *
 * This is deliberately a status and not a summary of the contract's contents.
 * Issue #36 needs to know only whether a contract exists and whether it is
 * valid; a contract that carries facts of its own is Issue #37's business, and
 * widening this type is what would let a maintainer's description leak into the
 * discovered model unlabelled. Keeping the slice this narrow means the
 * `author-declared` channel cannot be used by accident.
 */
export type ContractStatus =
  | { readonly status: "absent" }
  | { readonly status: "invalid"; readonly reason: string }
  | { readonly status: "failed"; readonly detail: string }
  | { readonly status: "valid" };

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
   * List a repository-relative directory's immediate entries, code-unit sorted
   * by name. Never recurses.
   *
   * Added in ADR-0045 for workspace-pattern expansion, which cannot resolve
   * `packages/*` from `stat` alone. Like `readTextFile` and `stat` it is a pure
   * read: no write, process, Git, or network capability is reachable from it,
   * so the read-only guarantee from ADR-0044 is unaffected.
   */
  listDirectory(relativePath: string): Promise<readonly DiscoveryEntry[]>;
  /**
   * Resolve a repository-relative path through symbolic links to its real
   * target. Used to refuse following a workspace pattern out of the repository.
   */
  realPath(relativePath: string): Promise<string>;
  /**
   * Narrow, read-only contract access. The returned status keeps "there is no
   * contract" separate from "the contract is broken", which is the same
   * absence-versus-failure distinction the file-system helpers preserve.
   * Implementations must not cache across discovery runs.
   */
  readContract(): Promise<ContractStatus>;
  /**
   * The author's package-manager claim, if the contract makes one.
   *
   * Kept separate from `readContract` so that the narrow status Issue #36
   * needed cannot grow into a general "read anything from the contract"
   * capability by accident. ADR-0044 allows the contract to contribute facts,
   * but only as `author-declared` claims, and this accessor is the single place
   * such a claim may come from.
   */
  readContractPackageManager(): Promise<ContractPackageManagerClaim | undefined>;
  /**
   * The shared, per-run package and workspace view.
   *
   * Declared here as a structural interface so the probe protocol has no
   * dependency on the package domain that implements it. Probes stay
   * independently testable, and the expensive work — reading manifests,
   * normalizing patterns, expanding globs — happens once per run, so no two
   * probes can disagree about the same repository content.
   */
  readRepositoryLayout(): Promise<DiscoveryLayout>;
}

export interface DiscoveryLayout {
  readonly manifestPaths: readonly string[];
  readonly packages: readonly PackageEntry[];
  /** Files inspected for a workspace declaration, whether or not one was found. */
  readonly checkedDeclarationSources: readonly string[];
  readonly declarations: readonly DiscoveryDeclaration[];
  readonly candidates: readonly WorkspaceCandidateEntry[];
  readonly truncated: boolean;
  readonly unreadablePaths: readonly string[];
  readonly workspaceRootManifest: string | null;
  /** Manifests that exist but could not be interpreted. */
  readonly brokenManifests: readonly { readonly path: string; readonly status: string }[];
  /**
   * `packageManager` fields that exist but are not a `<name>@<version>` string.
   *
   * Collected by the layout rather than by the package-manager probe, because a
   * probe only learns about them while building its own claims — and a probe that
   * found a usable declaration *elsewhere* would have no reason to mention them.
   * That is how an unmodelled field in one workspace member used to be silently
   * swallowed whenever another member declared a supported one.
   */
  readonly unmodelledPackageManagers: readonly {
    readonly path: string;
    readonly raw: unknown;
  }[];
}

export interface DiscoveryDeclaration {
  readonly source: string;
  /**
   * The declaration's shape, as the vocabulary names it.
   *
   * Typed as `WorkspaceDeclarationForm` rather than a bare `string` so a
   * declaration can never reach the snapshot as a form the type system has not
   * heard of. `string` here would have made the probe's `as` cast to the
   * declared union a necessity, and a cast in the only code that turns a read
   * document into a published fact is the wrong place to have one.
   */
  readonly form: WorkspaceDeclarationForm;
  readonly patterns: readonly string[];
  readonly unsupportedReason: string | null;
  /** Patterns that passed normalization and can be expanded. */
  readonly normalizedPatterns: readonly string[];
  /** Patterns rejected as unsafe or unsupported, with the reason. */
  readonly rejectedPatterns: readonly { readonly raw: string; readonly reason: string }[];
}

export interface DiscoveryEntry {
  readonly name: string;
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly isSymbolicLink: boolean;
}

export interface ContractPackageManagerClaim {
  readonly name: string;
  readonly version: string;
}
