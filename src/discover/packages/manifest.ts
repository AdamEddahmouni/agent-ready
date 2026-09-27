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

import { compareCodeUnits } from "../ordering.js";
import type { DiscoveryProbeContext } from "../probe.js";
import { parseBoundedJsonObject, safeRead } from "../read.js";
import type {
  CommandEntry,
  JsonValue,
  ManifestStatus,
  PackageEntry,
  PackageNameStatus,
  ScriptsStatus,
  UnmodelledScriptEntry,
} from "../types.js";

/** The manifest filename. The only file that makes a directory a package. */
export const MANIFEST_FILENAME = "package.json";

/** The field a manifest declares its commands in. */
export const SCRIPTS_FIELD = "scripts";

/**
 * What a manifest's `scripts` field declares, read once by the same bounded
 * parser that reads the rest of the manifest.
 *
 * There is deliberately no second parser here. A command parser that could
 * disagree with the package parser about byte caps, nesting limits, or failure
 * semantics would be two answers to "what does this manifest say", and the
 * second one would be the one nobody reviewed. ADR-0046 §11 extends the one
 * authoritative parse rather than duplicating it.
 */
export interface ScriptDeclaration {
  readonly status: ScriptsStatus;
  /** Every string-valued entry, code-unit sorted by name. */
  readonly commands: readonly CommandEntry[];
  /** Entries whose value is not a string, retained with the raw JSON value. */
  readonly unmodelled: readonly UnmodelledScriptEntry[];
  readonly unsupportedReason: string | null;
}

/** The declaration of a manifest that was never successfully parsed. */
export function unobservableScripts(): ScriptDeclaration {
  return { status: "unobservable", commands: [], unmodelled: [], unsupportedReason: null };
}

/**
 * Reads a manifest's `scripts` declaration, or reports why it cannot be read.
 *
 * The four outcomes are the four states ADR-0046 §7 requires, and the important
 * one is `absent`: a parsed manifest with no `scripts` key declares **zero**
 * commands, which is knowledge, not ignorance. Reporting it as unknown would be
 * a false negative, and reporting it as unsupported would be a false alarm.
 *
 * Within a `scripts` object, a value that is not a string is retained as
 * unmodelled while every valid sibling survives. That is the narrowest
 * defensible failure boundary: one unusable entry must not delete the twenty
 * valid commands beside it, and quietly dropping valid entries while claiming a
 * complete observation is the dishonest outcome. Values are never coerced.
 */
export function readScripts(
  document: Record<string, unknown>,
  manifestPath: string,
): ScriptDeclaration {
  if (!(SCRIPTS_FIELD in document)) {
    return { status: "absent", commands: [], unmodelled: [], unsupportedReason: null };
  }
  const raw = document[SCRIPTS_FIELD];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {
      status: "unsupported",
      commands: [],
      unmodelled: [],
      unsupportedReason:
        `\`${SCRIPTS_FIELD}\` is ${describeJsonType(raw)} rather than a JSON object of ` +
        "name/command pairs. It was not interpreted, and no command was derived from it.",
    };
  }

  const source = document[SCRIPTS_FIELD] as Record<string, unknown>;
  const commands: CommandEntry[] = [];
  const unmodelled: UnmodelledScriptEntry[] = [];
  for (const name of Object.keys(source)) {
    const value = source[name];
    const pointer = `/${SCRIPTS_FIELD}/${escapePointerSegment(name)}`;
    if (typeof value === "string") {
      // Verbatim, including an empty body. `{"noop": ""}` is a real, runnable,
      // meaningless declaration, and `if (!body)` would delete it.
      commands.push({ name, body: value, source: manifestPath, pointer });
      continue;
    }
    unmodelled.push({
      name,
      value: toJsonValue(value),
      reason: `\`${pointer}\` is ${describeJsonType(value)} rather than a string`,
      pointer,
    });
  }

  return {
    status: "declared",
    commands: commands.sort(compareByName),
    unmodelled: unmodelled.sort(compareByName),
    unsupportedReason: null,
  };
}

/**
 * JSON Pointer escaping for a `scripts` key.
 *
 * `~` and `/` are the only characters a pointer must escape, and a script named
 * `build/prod` or `a~b` is a legal npm script name. Without this, its pointer
 * would resolve to a *different* location in the document, which is worse than
 * no pointer: the citation would look precise and be wrong.
 */
function escapePointerSegment(name: string): string {
  return name.replace(/~/g, "~0").replace(/\//g, "~1");
}

function compareByName(a: { readonly name: string }, b: { readonly name: string }): number {
  return compareCodeUnits(a.name, b.name);
}

/**
 * Describes a JSON value's shape without rendering it.
 *
 * Used for the *reason* a value was not a command. Rendering the value instead
 * would put arbitrary repository content into a diagnostic string, and
 * `String({})` would produce the literal text `[object Object]`, which is
 * precisely the rendering artefact the project forbids.
 */
function describeJsonType(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "an array";
  }
  switch (typeof value) {
    case "object":
      return "a JSON object";
    case "string":
      return "a string";
    case "number":
      return "a number";
    case "boolean":
      return "a boolean";
    default:
      return "a value of an unmodelled type";
  }
}

/**
 * Narrows a parsed JSON value to the model's `JsonValue`.
 *
 * `JSON.parse` can only produce JSON, so this is structurally always true. It
 * is written as a narrowing rather than an assertion because the whole point of
 * `UnmodelledScriptEntry.value` is to publish the raw observation faithfully —
 * and a cast here would be a cast in the one place that decides what gets
 * published.
 */
function toJsonValue(value: unknown): JsonValue {
  return value as JsonValue;
}

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
