/**
 * Reading and interpreting one package manifest.
 *
 * Kept separate from both the probes and the aggregation so the domain can be
 * tested against a string rather than through a CLI: a malformed manifest is a
 * parsing question, not a discovery question.
 *
 * Two rules run through everything here:
 *
 *  - **A package is a readable manifest, and nothing else.** A directory
 *    matched by a workspace glob is not a package. A directory named `packages`
 *    is not a package. A directory with source files is not a package.
 *  - **Absence, invalidity, and unreadability are three different states.**
 *    Collapsing them is how a manifest that declares no name becomes a
 *    manifest with an invented one.
 */

import type { DiscoveryProbeContext } from "../probe.js";
import { parseBoundedJsonObject, safeRead } from "../read.js";
import type { ManifestStatus, PackageEntry, PackageNameStatus } from "../types.js";

/** The manifest filename. The only file that makes a directory a package. */
export const MANIFEST_FILENAME = "package.json";

export type ManifestRead =
  | { readonly status: "read"; readonly document: Record<string, unknown> }
  | { readonly status: "malformed"; readonly detail: string }
  | { readonly status: "unreadable"; readonly detail: string }
  | { readonly status: "absent" };

/**
 * Reads and parses one manifest.
 *
 * Every failure is an outcome rather than a throw, because the caller has to be
 * able to degrade *this* manifest to `malformed` while leaving the rest of the
 * repository intact. A single broken `package.json` must never be able to make
 * workspace discovery fail wholesale.
 */
export async function readManifest(
  context: DiscoveryProbeContext,
  manifestPath: string,
): Promise<ManifestRead> {
  const read = await safeRead(context, manifestPath);
  if (read.status === "absent") {
    return { status: "absent" };
  }
  if (read.status === "failed") {
    return { status: "unreadable", detail: read.detail };
  }
  const parsed = parseBoundedJsonObject(read.content);
  if (!parsed.ok) {
    return { status: "malformed", detail: parsed.detail };
  }
  return { status: "read", document: parsed.value };
}

/**
 * Interprets a manifest into a package entry.
 *
 * `manifestStatus` is carried on the entry rather than inferred from the
 * absence of a name, because "this manifest declares no name" and "this
 * manifest could not be read" produce very different packages and a consumer
 * must be able to tell them apart without a second lookup.
 */
export function interpretManifest(
  directory: string,
  read: Extract<ManifestRead, { status: "read" }>,
): PackageEntry {
  const document = read.document;
  return {
    path: directory,
    name: declaredName(document),
    nameStatus: nameStatusOf(document),
    private: typeof document["private"] === "boolean" ? document["private"] : null,
    version: typeof document["version"] === "string" ? document["version"] : null,
    manifestStatus: "read",
  };
}

/**
 * An entry for a manifest that exists but could not be interpreted.
 *
 * It is still a package *path* with a known manifest — the file is there, which
 * is not the same as being readable — so the path is reported with
 * `manifestStatus` explaining why nothing more is known. Reporting nothing at
 * all would make an unreadable manifest indistinguishable from a directory that
 * holds no manifest, which is the exact false negative ADR-0044 calls out.
 */
export function unreadableEntry(
  directory: string,
  status: Extract<ManifestStatus, "malformed" | "unreadable">,
): PackageEntry {
  return {
    path: directory,
    name: null,
    nameStatus: "absent",
    private: null,
    version: null,
    manifestStatus: status,
  };
}

function declaredName(document: Record<string, unknown>): string | null {
  const name = document["name"];
  return nameStatusOf(document) === "declared" ? (name as string) : null;
}

function nameStatusOf(document: Record<string, unknown>): PackageNameStatus {
  if (!("name" in document)) {
    return "absent";
  }
  const name = document["name"];
  if (typeof name !== "string") {
    return "invalid";
  }
  // An empty or whitespace-only name is declared-but-unusable. Reporting it as
  // `declared` would put an empty string in a field a consumer reads as a
  // package name, and reporting it as `absent` would claim the manifest says
  // nothing about its name when it in fact said something unusable.
  return name.trim().length === 0 ? "invalid" : "declared";
}

/** The `packageManager` field of a manifest, as observed — not yet interpreted. */
export function readPackageManagerField(
  document: Record<string, unknown>,
  field: string,
): { readonly present: true; readonly raw: unknown } | { readonly present: false } {
  if (!(field in document)) {
    return { present: false };
  }
  return { present: true, raw: document[field] };
}

/** Builds the JSON Pointer for a field inside a manifest, for evidence. */
export function fieldPointer(field: string): string {
  return `/${field}`;
}
