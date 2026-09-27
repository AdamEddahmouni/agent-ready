import type { DiscoveryProbeContext } from "./probe.js";

/**
 * Distinguishes "this path is not there" from "we could not look". The
 * `FileSystem` boundary already encodes the distinction — `stat` returns
 * `undefined` only for a genuinely absent path and throws for an I/O failure —
 * so the job here is to preserve it rather than collapse it. Collapsing the
 * two is how a probe ends up reporting "unknown" for a file that is present
 * and unreadable, or "absent" for a directory it was not permitted to enter.
 */
export type StatOutcome =
  | { readonly status: "present"; readonly isFile: boolean; readonly isDirectory: boolean }
  | { readonly status: "absent" }
  | { readonly status: "failed"; readonly detail: string };

export type ReadOutcome =
  | { readonly status: "read"; readonly content: string }
  | { readonly status: "absent" }
  | { readonly status: "failed"; readonly detail: string };

export async function safeStat(
  context: DiscoveryProbeContext,
  relativePath: string,
): Promise<StatOutcome> {
  try {
    const stat = await context.stat(relativePath);
    if (stat === undefined) {
      return { status: "absent" };
    }
    return { status: "present", isFile: stat.isFile, isDirectory: stat.isDirectory };
  } catch (error) {
    return { status: "failed", detail: describeError(error, relativePath) };
  }
}

/**
 * Reads a file only after confirming it exists, so that a read failure is
 * reported as `failed` rather than being indistinguishable from absence.
 */
export async function safeRead(
  context: DiscoveryProbeContext,
  relativePath: string,
): Promise<ReadOutcome> {
  const stat = await safeStat(context, relativePath);
  if (stat.status === "absent") {
    return { status: "absent" };
  }
  if (stat.status === "failed") {
    return { status: "failed", detail: stat.detail };
  }
  if (!stat.isFile) {
    return { status: "absent" };
  }
  try {
    return { status: "read", content: await context.readTextFile(relativePath) };
  } catch (error) {
    return { status: "failed", detail: describeError(error, relativePath) };
  }
}

/**
 * Reads and parses JSON without ever guessing. A parse failure is a probe
 * failure of *this* probe, not a statement about the repository, so the
 * caller decides how to represent it.
 */
export function parseJsonObject(content: string):
  | { ok: true; value: Record<string, unknown> }
  | {
      ok: false;
      detail: string;
    } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    return { ok: false, detail: describeError(error, "JSON") };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, detail: "The document is not a JSON object." };
  }
  return { ok: true, value: parsed as Record<string, unknown> };
}

function describeError(error: unknown, subject: string): string {
  if (error instanceof Error && error.message.length > 0) {
    return `${subject}: ${error.message}`;
  }
  return `${subject}: an unknown error occurred.`;
}
