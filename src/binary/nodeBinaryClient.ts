import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import type { BinaryClient, BinaryProbeResult, BinaryTarget } from "./types.js";
import { BinaryClientError } from "./types.js";

const execFile = promisify(execFileCallback);

/** Caps subprocess output size read into memory (defense against pathological binaries). */
const MAX_BUFFER_BYTES = 16 * 1024 * 1024;

/**
 * Per-target probe argv. Every entry is a hardcoded constant keyed only by
 * `BinaryTarget` (an enum value, never contract- or caller-supplied text),
 * per ADR-0013's invariant. Most targets accept `--version`; `go` does not
 * — its CLI rejects `--version` as an undefined flag and requires the bare
 * subcommand `version` instead (verified directly, not assumed; see
 * ADR-0038).
 */
const PROBE_ARGS: Readonly<Record<BinaryTarget, readonly string[]>> = {
  git: ["--version"],
  pnpm: ["--version"],
  npm: ["--version"],
  yarn: ["--version"],
  python: ["--version"],
  cargo: ["--version"],
  go: ["version"],
};

/**
 * Real BinaryClient backed by `node:child_process.execFile`. Never uses a
 * shell (`execFile`, not `exec`) and never interpolates caller content
 * into argv. The argv pair is a hardcoded, per-target constant (`PROBE_ARGS`),
 * per ADR-0013's invariant.
 *
 * Path resolution uses `which` on POSIX and `where` on Windows to surface
 * the resolved absolute path; both are themselves `execFile` invocations
 * with hardcoded argv.
 */
export class NodeBinaryClient implements BinaryClient {
  async probe(target: BinaryTarget, _root: string): Promise<BinaryProbeResult | undefined> {
    try {
      const { stdout } = await execFile(target, [...PROBE_ARGS[target]], {
        maxBuffer: MAX_BUFFER_BYTES,
      });
      const version = normalizeVersion(target, stdout);
      const path = await resolveBinaryPath(target);
      return { version, path };
    } catch (error) {
      if (isEnoentError(error)) {
        return undefined;
      }
      throw new BinaryClientError(`The \`${target}\` binary failed during probing.`, {
        cause: error,
      });
    }
  }
}

/**
 * Normalizes a binary's version-probe output into the project's canonical
 * shape. Per ADR-0023 and ADR-0038:
 * - `pnpm` / `npm` / `yarn` / `python` / `cargo`: `MAJOR.MINOR.PATCH` with
 *   no `v` prefix (`python --version` and `cargo --version` were confirmed
 *   to already fit this shape; no target-specific branch needed).
 * - `git`: the literal `git version MAJOR.MINOR.PATCH` text the binary
 *   prints, including the prefix.
 * - `go`: `MAJOR.MINOR.PATCH`, extracted from `go version goX.Y.Z OS/ARCH`
 *   (see `normalizeGoVersion`).
 *
 * Output may carry extra trailing lines (`pnpm --version` once printed
 * `pnpm 9.0.0\n...` and `git --version` may continue into a usage hint),
 * so we take only the first line and, for the generic case, the first
 * whitespace-delimited token. We deliberately do **not** coerce with
 * `semver.clean` or otherwise mangle the version text: doctor feeds the
 * result to `semver.satisfies` directly per ADR-0023.
 *
 * Exported for testing; not part of the public API surface (not exported
 * from src/index.ts). The alternative — covering it only through
 * `NodeBinaryClient.probe` — would require invoking real binaries, which
 * is exactly what the `BinaryClient` boundary exists to avoid.
 */
export function normalizeVersion(target: BinaryTarget, raw: string): string {
  const firstLine = raw.split("\n", 1)[0]?.trim() ?? "";
  if (target === "git") {
    return firstLine.startsWith("git version ") ? firstLine : `git version ${firstLine}`;
  }
  if (target === "go") {
    return normalizeGoVersion(firstLine);
  }
  // For pnpm/npm/yarn/python/cargo, modern versions print only
  // `MAJOR.MINOR.PATCH` on the first line; older versions print
  // `<name> MAJOR.MINOR.PATCH`
  // (e.g. `pnpm 8.15.4`). Take the first token, but skip a leading
  // non-numeric prefix so we never bubble the binary name into the
  // version field. ADR-0023 forbids `semver.major` extraction and
  // `v`-prepending, so the result is fed to `semver.satisfies` verbatim.
  const tokens = firstLine.split(/\s+/u).filter((t) => t.length > 0);
  if (tokens.length === 0) return "";
  const first = tokens[0] ?? "";
  if (/^\d/u.test(first)) return first;
  return tokens[1] ?? first;
}

/**
 * Extracts a semver-comparable version from `go version` output
 * (`go version go1.22.0 linux/amd64`). The version-bearing token itself
 * carries a literal `go` prefix (`go1.22.0`, not `go 1.22.0`), which the
 * generic token-skip logic above cannot handle — it would return the
 * literal word `"version"`. Go's initial release of a minor version once
 * shipped as a bare two-component `goX.Y` before any `goX.Y.Z` patch
 * existed (e.g. `go1.21` before `go1.21.1`); `semver.satisfies` rejects a
 * two-component version, so one is appended when needed. This is a
 * targeted normalization of Go's own versioning convention — not a general
 * `semver.clean`-style coercion of arbitrary input.
 */
function normalizeGoVersion(firstLine: string): string {
  const tokens = firstLine.split(/\s+/u).filter((t) => t.length > 0);
  const versionToken = tokens[2] ?? "";
  const stripped = versionToken.startsWith("go") ? versionToken.slice(2) : versionToken;
  return /^\d+\.\d+$/u.test(stripped) ? `${stripped}.0` : stripped;
}

async function resolveBinaryPath(target: BinaryTarget): Promise<string> {
  const resolver = process.platform === "win32" ? "where" : "which";
  try {
    const { stdout } = await execFile(resolver, [target], { maxBuffer: MAX_BUFFER_BYTES });
    const first = stdout.split(/\r?\n/u)[0]?.trim() ?? target;
    return first.length > 0 ? first : target;
  } catch {
    // `which`/`where` is best-effort. If it fails or is unavailable, fall
    // back to the program name so doctor still surfaces a useful value.
    return target;
  }
}

function isEnoentError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
