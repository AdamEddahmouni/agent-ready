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
import { MAX_MANIFEST_DEPTH, parseBoundedJsonObject, safeRead } from "../read.js";
import { indexJsonPositions } from "../graph/jsonSource.js";
import type { JsonLocationIndex } from "../graph/jsonSource.js";
import { countLines } from "../graph/provenance.js";
import type {
  CommandEntry,
  JsonValue,
  ManifestStatus,
  PackageEntry,
  PackageNameStatus,
  ScriptsStatus,
  UnmodelledScriptEntry,
} from "../types.js";
import type { DependencyClass, DependencyDeclaration, SourceLocation } from "../graph/types.js";

/** The manifest filename. The only file that makes a directory a package. */
export const MANIFEST_FILENAME = "package.json";

/** The field a manifest declares its commands in. */
export const SCRIPTS_FIELD = "scripts";

/**
 * The manifest fields that declare a dependency, and the class each implies.
 *
 * `peerDependenciesMeta` is deliberately **not** read. It marks a peer
 * dependency as optional, which is a real nuance — but modelling it would mean
 * a `peer` class that sometimes means optional, which is a second vocabulary
 * over one field. The raw declaration is published verbatim either way, so the
 * nuance is inspectable without this version interpreting it (ADR-0047 §14).
 */
export const DEPENDENCY_FIELDS: readonly {
  readonly field: string;
  readonly dependencyClass: DependencyClass;
}[] = [
  { field: "dependencies", dependencyClass: "runtime" },
  { field: "devDependencies", dependencyClass: "dev" },
  { field: "peerDependencies", dependencyClass: "peer" },
  { field: "optionalDependencies", dependencyClass: "optional" },
];

/** One manifest field's dependency declaration, with the line it was written on. */
export type LocatedDependencyDeclaration = DependencyDeclaration & {
  /** The dependency's declared name, exactly as the manifest wrote it. */
  readonly name: string;
};

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
  | {
      readonly status: "read";
      readonly document: Record<string, unknown>;
      /**
       * Every declared dependency, with the line each declaration is on.
       *
       * Read here, in the one authoritative manifest parse, rather than by a
       * second reader. A dependency reader that re-read the manifests would be
       * free to disagree with this one about the byte cap, the depth guard, or
       * what "malformed" means — and two answers about the same file in one
       * snapshot is the failure ADR-0046 §11 exists to prevent.
       */
      readonly dependencies: readonly LocatedDependencyDeclaration[];
      /**
       * A `dependencies`-shaped field present in a form this version does not
       * model, e.g. `"dependencies": ["ajv"]`.
       *
       * Retained rather than coerced, because coercing an array of names to an
       * object would invent declarations the repository never wrote. The
       * declared dependency graph for this package is then *unknown*, not
       * empty, and the diagnostic says which field was left uninterpreted.
       */
      readonly unsupportedDependencyFields: readonly {
        readonly field: string;
        readonly reason: string;
      }[];
      /** JSON Pointer → position index, for citing a declaration exactly. */
      readonly locations: JsonLocationIndex;
      /** Lines in the file, so a citation can be range-checked. */
      readonly lineCount: number;
    }
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
 *
 * ADR-0045's byte cap and depth guard still run first and still decide whether
 * this manifest is readable at all. Positions are gathered afterwards, from the
 * same text, by a parse that is *only* asked where things are. A manifest that
 * passes the caps and fails to parse is still `malformed`; a manifest that
 * parses but has no indexable positions is still `read`, with citations that
 * the graph validator will reject rather than fabricate.
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
  const indexed = indexJsonPositions(manifestPath, read.content, MAX_MANIFEST_DEPTH);
  const locations: JsonLocationIndex = indexed.ok ? indexed.locations : new Map();
  const lineCount = indexed.ok ? indexed.lineCount : countLines(read.content);
  return {
    status: "read",
    document: parsed.value,
    ...readDependencies(parsed.value, manifestPath, locations),
    locations,
    lineCount,
  };
}

/**
 * Reads the four dependency fields, with a citation for each declaration.
 *
 * Three properties are load-bearing:
 *
 *  - **The specifier is verbatim.** `^8.17.1` stays `^8.17.1`, `workspace:*`
 *    stays `workspace:*`, `file:../x` stays `file:../x`. Nothing is normalised
 *    through a semver range, because a range is a claim about what the
 *    repository will accept and rewriting it is a claim about what it declared.
 *  - **A non-string value is not a declaration.** `"ajv": 8` is retained as
 *    unmodelled with its raw value, and `"ajv": "^8"` beside it still is. One
 *    unusable entry must not delete the valid ones beside it.
 *  - **The same name in two fields is two declarations.** A package that lists
 *    `ajv` in both `dependencies` and `devDependencies` has two declarations,
 *    and the graph publishes both rather than letting object order choose.
 */
function readDependencies(
  document: Record<string, unknown>,
  manifestPath: string,
  locations: JsonLocationIndex,
): {
  dependencies: readonly LocatedDependencyDeclaration[];
  unsupportedDependencyFields: readonly { field: string; reason: string }[];
} {
  const dependencies: LocatedDependencyDeclaration[] = [];
  const unsupportedDependencyFields: { field: string; reason: string }[] = [];

  for (const { field, dependencyClass } of DEPENDENCY_FIELDS) {
    if (!(field in document)) {
      continue;
    }
    const raw = document[field];
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      unsupportedDependencyFields.push({
        field,
        reason: `\`${field}\` is ${describeJsonType(raw)} rather than a JSON object of name/specifier pairs. It was not interpreted, and no dependency was derived from it.`,
      });
      continue;
    }
    const source = raw as Record<string, unknown>;
    for (const name of Object.keys(source)) {
      const pointer = `/${field}/${escapePointerSegment(name)}`;
      const value = source[name];
      if (typeof value !== "string") {
        continue;
      }
      dependencies.push({
        name,
        dependencyClass,
        declaredSpecifier: value,
        pointer,
        provenance: locationFor(locations, manifestPath, pointer),
      });
    }
  }

  return {
    dependencies: dependencies.sort(
      (a, b) => compareCodeUnits(a.name, b.name) || compareCodeUnits(a.pointer, b.pointer),
    ),
    unsupportedDependencyFields,
  };
}

/**
 * The citation for a pointer, carrying a line 1 fallback the validator rejects.
 *
 * See `graph/jsonSource.ts` for why the fallback is line 1 and not nothing: a
 * graph item with no citeable location must fail the graph's own invariants
 * rather than enter the graph looking legitimate.
 */
function locationFor(
  locations: JsonLocationIndex,
  source: string,
  pointer: string,
): SourceLocation {
  const found = locations.get(pointer);
  if (found === undefined) {
    return { source, line: 1, pointer };
  }
  return { ...found, pointer };
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
