/**
 * Narrow binary-probing boundary, mirroring `git/types.ts`'s pattern:
 * domain/CLI code depends on this interface, not on `node:child_process`
 * directly, so `agent-ready doctor` can be tested against a fake without
 * invoking any binary. See ADR-0013 for the argv-hardcoding invariant
 * this surface upholds: every argv pair is hardcoded `[<target>, "--version"]`,
 * callers cannot influence argv.
 */

export type BinaryTarget = "git" | "pnpm" | "npm" | "yarn";

export interface BinaryProbeResult {
  /** Raw version text exactly as the binary reports it. Doctor feeds this to `semver.satisfies` directly — no `semver.major` extraction, no `v`-prepending. */
  readonly version: string;
  /** Absolute path the binary resolves to on the current PATH (best-effort; falls back to the program name if a `which`/`where` lookup fails). */
  readonly path: string;
}

export interface BinaryClient {
  /**
   * Probe `target` and return its version + resolved path, or `undefined`
   * if the binary is not on PATH. The real implementation always shells
   * the Agent-Ready-hardcoded argv pair `[<target>, "--version"]`; the
   * argv cannot vary.
   *
   * `root` mirrors the parameter shape of `GitClient.isRepository(root)`
   * and `GitClient.getChangedFiles(root, base)`. The argument is currently
   * unused by the real `NodeBinaryClient` but uniform with the existing
   * `GitClient` boundary, so a future caller that wants a repo-rooted
   * PATH lookup needs no signature change.
   */
  probe(target: BinaryTarget, root: string): Promise<BinaryProbeResult | undefined>;
}

export class BinaryClientError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "BinaryClientError";
  }
}
