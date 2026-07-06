import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import type { BinaryClient, BinaryProbeResult, BinaryTarget } from "./types.js";
import { BinaryClientError } from "./types.js";

const execFile = promisify(execFileCallback);

/** Caps subprocess output size read into memory (defense against pathological binaries). */
const MAX_BUFFER_BYTES = 16 * 1024 * 1024;

/**
 * Real BinaryClient backed by `node:child_process.execFile`. Never uses a
 * shell (`execFile`, not `exec`) and never interpolates caller content
 * into argv. The argv pair is hardcoded `[<target>, "--version"]`, per
 * ADR-0013's invariants verbatim.
 *
 * Path resolution uses `which` on POSIX and `where` on Windows to surface
 * the resolved absolute path; both are themselves `execFile` invocations
 * with hardcoded argv.
 */
export class NodeBinaryClient implements BinaryClient {
  async probe(target: BinaryTarget, _root: string): Promise<BinaryProbeResult | undefined> {
    try {
      const { stdout } = await execFile(target, ["--version"], { maxBuffer: MAX_BUFFER_BYTES });
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
 * Normalizes a binary's `--version` output into the project's
 * canonical shape. Per ADR-0023:
 * - `pnpm` / `npm` / `yarn`: `MAJOR.MINOR.PATCH` with no `v` prefix.
 * - `git`: the literal `git version MAJOR.MINOR.PATCH` text the binary
 *   prints, including the prefix.
 *
 * Output may carry extra trailing lines (`pnpm --version` once printed
 * `pnpm 9.0.0\n...` and `git --version` may continue into a usage hint),
 * so we take only the first line and, for non-git, the first
 * whitespace-delimited token. We deliberately do **not** coerce with
 * `semver.clean` or otherwise mangle the version text: doctor feeds the
 * result to `semver.satisfies` directly per ADR-0023.
 */
function normalizeVersion(target: BinaryTarget, raw: string): string {
  const firstLine = raw.split("\n", 1)[0]?.trim() ?? "";
  if (target === "git") {
    return firstLine.startsWith("git version ") ? firstLine : `git version ${firstLine}`;
  }
  // For pnpm/npm/yarn, modern versions print only `MAJOR.MINOR.PATCH` on
  // the first line; older versions print `<name> MAJOR.MINOR.PATCH`
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
