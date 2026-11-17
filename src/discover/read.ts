import type { DiscoveryEntry, DiscoveryProbeContext } from "./probe.js";

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

export type ListOutcome =
  | { readonly status: "listed"; readonly entries: readonly DiscoveryEntry[] }
  | { readonly status: "absent" }
  | { readonly status: "failed"; readonly detail: string };

/**
 * Lists a directory, preserving the absent-versus-failed distinction for the
 * same reason `safeStat` does.
 *
 * A directory that is absent is not an error and yields no entries; a directory
 * that could not be listed is ignorance, and a walk that treated it as empty
 * would report "this workspace declares nothing here" for a path it was simply
 * not allowed to look at.
 */
export async function safeList(
  context: DiscoveryProbeContext,
  relativePath: string,
): Promise<ListOutcome> {
  try {
    return { status: "listed", entries: await context.listDirectory(relativePath) };
  } catch (error) {
    // A missing directory is absence, not failure. The boundary cannot tell the
    // two apart through a thrown error alone, so the stat below decides.
    const stat = await safeStat(context, relativePath);
    if (stat.status === "absent") {
      return { status: "absent" };
    }
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

/**
 * Upper bound on a package manifest. Repository-authored JSON is untrusted
 * input, so it is bounded before parsing rather than trusted because it is
 * "just a config file".
 *
 * A real `package.json` with a large dependency block is a few hundred
 * kilobytes; one megabyte is far above any legitimate manifest and far below
 * anything that would strain the process. Mirrors the YAML byte cap in ADR-0003
 * so both untrusted-input parsers in the project share one limit.
 */
export const MAX_MANIFEST_BYTES = 1_000_000;

/**
 * Maximum nesting depth accepted in a parsed manifest.
 *
 * `JSON.parse` itself will happily build a 100,000-deep object and then anything
 * that walks it recursively overflows the stack. Measuring iteratively before
 * use keeps a hostile manifest a failed manifest instead of a crashed process.
 */
export const MAX_MANIFEST_DEPTH = 64;

/**
 * Parses a manifest under a byte and depth cap.
 *
 * Every failure mode — too large, too deep, not JSON, not an object — is
 * reported as a plain outcome so the caller can degrade that one manifest to
 * `malformed` and leave every other fact intact. Nothing here throws, and
 * nothing here decides what a malformed manifest *means* for the repository.
 */
export function parseBoundedJsonObject(
  content: string,
): { ok: true; value: Record<string, unknown> } | { ok: false; detail: string } {
  const byteLength = Buffer.byteLength(content, "utf8");
  if (byteLength > MAX_MANIFEST_BYTES) {
    return {
      ok: false,
      detail:
        `The manifest is ${String(byteLength)} bytes, which exceeds the ` +
        `${String(MAX_MANIFEST_BYTES)} byte limit.`,
    };
  }
  const parsed = parseJsonObject(content);
  if (!parsed.ok) {
    return parsed;
  }
  const depth = measureDepth(parsed.value);
  if (depth > MAX_MANIFEST_DEPTH) {
    return {
      ok: false,
      detail:
        `The manifest nests ${String(depth)} levels deep, which exceeds the ` +
        `${String(MAX_MANIFEST_DEPTH)} level limit.`,
    };
  }
  return parsed;
}

/** Iterative, so the depth guard itself cannot overflow on adversarial input. */
function measureDepth(root: unknown): number {
  let maximum = 0;
  const stack: { readonly node: unknown; readonly depth: number }[] = [{ node: root, depth: 1 }];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    maximum = Math.max(maximum, current.depth);
    const node = current.node;
    if (node === null || typeof node !== "object") continue;
    if (Array.isArray(node)) {
      for (const item of node) {
        stack.push({ node: item, depth: current.depth + 1 });
      }
      continue;
    }
    for (const value of Object.values(node as Record<string, unknown>)) {
      stack.push({ node: value, depth: current.depth + 1 });
    }
  }
  return maximum;
}

function describeError(error: unknown, subject: string): string {
  if (error instanceof Error && error.message.length > 0) {
    return `${subject}: ${error.message}`;
  }
  return `${subject}: an unknown error occurred.`;
}
