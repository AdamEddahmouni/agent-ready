import type { BinaryClient, BinaryProbeResult, BinaryTarget } from "./types.js";

export interface FakeBinaryClientOptions {
  /**
   * Per-target probe results. A target mapping to `undefined` reports
   * the binary as unavailable; a target mapping to `{ version, path }`
   * reports that exact value. Targets absent from the map are treated as
   * unavailable.
   */
  readonly probe?: Partial<Record<BinaryTarget, BinaryProbeResult | undefined>>;
  /**
   * If set, probe throws this error (a Node-side execFile failure
   * distinct from "binary not on PATH") for every target.
   */
  readonly throwOnProbe?: Error;
  /**
   * Per-target throw map. When a target key is set, probe throws that
   * error for that target only. Useful when a test needs one binary's
   * probe to throw (e.g. only `pnpm`) without dragging the others
   * (e.g. `git`) into the same failure path. Takes precedence over the
   * per-target `probe` result map when both are set; the global
   * `throwOnProbe` (above) still takes precedence over this map for
   * callers who want one error to fire on every target.
   */
  readonly throwOnProbeByTarget?: Partial<Record<BinaryTarget, Error>>;
}

/**
 * Deterministic test double for BinaryClient, in the same spirit as
 * FakeGitClient: no real binary is ever invoked.
 */
export class FakeBinaryClient implements BinaryClient {
  constructor(private readonly options: FakeBinaryClientOptions = {}) {}

  // eslint-disable-next-line @typescript-eslint/require-await -- interface is async for parity with real I/O
  async probe(target: BinaryTarget, _root: string): Promise<BinaryProbeResult | undefined> {
    if (this.options.throwOnProbe !== undefined) {
      throw this.options.throwOnProbe;
    }
    const targetError = this.options.throwOnProbeByTarget?.[target];
    if (targetError !== undefined) {
      throw targetError;
    }
    return this.options.probe?.[target];
  }
}
