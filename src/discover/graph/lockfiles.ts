/**
 * Lockfile resolution, behind a narrow adapter interface (ADR-0047 §15).
 *
 * Two formats are modelled, because two are modelable correctly today:
 *
 *  - `pnpm-lock.yaml` — the format this repository uses, so the support claim
 *    is tested against real output rather than against a fixture somebody
 *    imagined.
 *  - `package-lock.json` — `lockfileVersion` 2 and 3, the other overwhelmingly
 *    common format, whose `packages` map is structurally similar.
 *
 * Everything else is `unsupported` with a named reason. Not a partial parse, and
 * specifically not "the first `name@version:` line in the file": a version
 * string appears in a manifest, in a transitive entry, and inside a
 * peer-suffixed key like `1.0.0(eslint@10.7.0)`, and a text search cannot tell
 * which occurrence belongs to which declaration. The issue's central question is
 * *"why do you believe this dependency resolved to 8.17.1?"*, and only a
 * position from the format's own parser answers it.
 *
 * Positions come from `yaml`'s `LineCounter` and from the same TypeScript JSON
 * AST the manifest reader uses, so a resolved version cites the line the
 * `version:` scalar — or the `"version"` property — is actually on.
 */

import { LineCounter, isMap, isPair, isScalar, parseDocument } from "yaml";
import { compareCodeUnits } from "../ordering.js";
import { MAX_MANIFEST_DEPTH } from "../read.js";
import { indexJsonPositions } from "./jsonSource.js";
import type { SourceLocation } from "./types.js";

/** One importer's resolved direct dependencies. */
export interface LockfileResolution {
  /**
   * Dependency name → the version the lockfile resolved it to, with the line it
   * was written on.
   *
   * The value is the lockfile's `version` field **verbatim**, including any peer
   * suffix (`8.1.4(@types/node@26.1.1)`). Rewriting it to a bare semver would be
   * a claim the lockfile did not make, and the suffix is what distinguishes two
   * resolutions of the same range.
   */
  readonly versions: ReadonlyMap<string, ResolvedEntry>;
  /** `resolved`, `unsupported`, or `unreadable`. */
  readonly status: "resolved" | "unsupported" | "unreadable";
  /** Why the lockfile yielded nothing, or null. */
  readonly detail: string | null;
}

export interface ResolvedEntry {
  readonly version: string;
  readonly provenance: SourceLocation;
}

/** What a lockfile adapter can do. Deliberately narrow and read-only. */
export interface LockfileAdapter {
  readonly manager: string;
  /** True for the repository-relative paths this adapter handles. */
  supports(path: string): boolean;
  /**
   * Reads one importer's resolved direct dependencies.
   *
   * `importer` is a canonical package directory (`.` for the root). Adapters
   * never read outside the repository and never follow an installed tree.
   */
  resolve(path: string, text: string, importer: string): LockfileResolution;
}

/**
 * Maximum size of a lockfile this version will parse.
 *
 * Repository-authored input is untrusted and unbounded in principle, and a
 * lockfile is the largest document discovery has agreed to read — ADR-0045
 * stat-ed lockfiles precisely so that this cost did not exist. ADR-0047 accepts
 * that cost only because a resolved version has to cite a line, and bounds it
 * the same way ADR-0045 bounded manifests: a fixed constant, checked *before*
 * parsing, with the consequence published rather than the read attempted.
 */
export const MAX_LOCKFILE_BYTES = 8_000_000;

/**
 * The outcome of reading a lockfile, before an adapter interprets it.
 *
 * The byte cap lives here so both adapters get it and neither can forget it, and
 * so the caller can report "too large" as a distinct condition from "unparseable"
 * — a file this version declined to open is not a file that failed to parse.
 */
export type PreparedLockfile =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly status: "too-large" | "unreadable"; readonly detail: string };

/** Applies the byte cap to a lockfile's text. */
export function prepareLockfile(text: string): PreparedLockfile {
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > MAX_LOCKFILE_BYTES) {
    return {
      ok: false,
      status: "too-large",
      detail: `The lockfile is ${String(bytes)} bytes, above the ${String(MAX_LOCKFILE_BYTES)} byte limit, so it was not parsed. Declared dependencies are unaffected; only their resolved versions are unknown.`,
    };
  }
  return { ok: true, text };
}

/** An empty, honest resolution for "there was nothing here to read". */
function nothing(status: "unsupported" | "unreadable", detail: string): LockfileResolution {
  return { versions: new Map(), status, detail };
}

// ---------------------------------------------------------------------------
// pnpm
// ---------------------------------------------------------------------------

/**
 * `pnpm-lock.yaml` v9 and above, which is the `importers` layout.
 *
 * The layout pnpm v6 and below wrote (`specifiers:` plus a flat `dependencies`
 * map) is explicitly `unsupported` rather than half-read: guessing at it would
 * produce resolved versions this run cannot cite to a line.
 */
export const pnpmAdapter: LockfileAdapter = {
  manager: "pnpm",
  supports: (path) => path === "pnpm-lock.yaml",
  resolve(path, rawText, importer) {
    const prepared = prepareLockfile(rawText);
    if (!prepared.ok) {
      return nothing("unreadable", prepared.detail);
    }
    const text = prepared.text;
    const lineCounter = new LineCounter();
    let document: ReturnType<typeof parseDocument>;
    try {
      document = parseDocument(text, { lineCounter, merge: false, uniqueKeys: true });
    } catch (error) {
      return nothing("unreadable", describeError(error, path));
    }
    if (document.errors.length > 0) {
      return nothing(
        "unreadable",
        `The document is not parseable YAML (${String(document.errors.length)} error(s)), so no resolved version was read from it.`,
      );
    }
    const version = firstScalar(document, ["lockfileVersion"]);
    if (typeof version !== "string" && typeof version !== "number") {
      return nothing(
        "unsupported",
        "The lockfile declares no `lockfileVersion`, so this version does not know which layout it uses.",
      );
    }
    const numeric: number = typeof version === "number" ? version : Number.parseFloat(version);
    if (!Number.isFinite(numeric) || numeric < 9) {
      return nothing(
        "unsupported",
        `Lockfile format ${String(version)} is not modelled. This version reads the \`importers\` layout written by pnpm 9 and above; an older layout is left uninterpreted rather than approximated.`,
      );
    }

    const versions = new Map<string, ResolvedEntry>();
    const entryFor = (dependency: string, className: string): void => {
      const found: unknown = document.getIn(
        ["importers", importerKey(importer), className, dependency, "version"],
        true,
      );
      if (!isScalar(found) || typeof found.value !== "string" || found.range == null) {
        // A `version` that is absent, or that is not a string, is a lockfile
        // this version cannot cite. An uncitable resolved version is an
        // unresolved one: publishing a version with no line would be exactly
        // the decoration this record forbids.
        return;
      }
      const position = lineCounter.linePos(found.range[0]);
      versions.set(dependency, {
        version: found.value,
        provenance: { source: path, line: position.line, column: position.col },
      });
    };
    for (const className of ["dependencies", "devDependencies", "optionalDependencies"]) {
      for (const dependency of keysAt(document, ["importers", importerKey(importer), className])) {
        entryFor(dependency, className);
      }
    }
    return { versions, status: "resolved", detail: null };
  },
};

// ---------------------------------------------------------------------------
// npm
// ---------------------------------------------------------------------------

/**
 * `package-lock.json` at `lockfileVersion` 2 and 3.
 *
 * `packages[""].dependencies` names the root's direct declarations and
 * `packages["node_modules/<name>"].version` is what the lockfile resolved them
 * to. Version 1 — the pre-`packages` layout — is explicitly `unsupported` rather
 * than half-read, and so is a document with no `packages` map at all.
 */
export const npmAdapter: LockfileAdapter = {
  manager: "npm",
  supports: (path) => path === "package-lock.json" || path === "npm-shrinkwrap.json",
  resolve(path, rawText, importer) {
    const prepared = prepareLockfile(rawText);
    if (!prepared.ok) {
      return nothing("unreadable", prepared.detail);
    }
    const text = prepared.text;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      return nothing("unreadable", describeError(error, path));
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return nothing("unreadable", "The document is not a JSON object.");
    }
    const document = parsed as Record<string, unknown>;
    const lockfileVersion = document["lockfileVersion"];
    if (typeof lockfileVersion !== "number" || lockfileVersion < 2) {
      return nothing(
        "unsupported",
        `Lockfile format ${String(lockfileVersion)} is not modelled. This version reads the \`packages\` map written by npm 7 and above; an older layout is left uninterpreted rather than approximated.`,
      );
    }
    const packages = document["packages"];
    if (typeof packages !== "object" || packages === null || Array.isArray(packages)) {
      return nothing(
        "unsupported",
        "The lockfile declares no `packages` map, so nothing was read from it.",
      );
    }

    const locations = jsonLocationMap(indexJsonPositions(path, text, MAX_MANIFEST_DEPTH));
    const map = packages as Record<string, unknown>;
    // An importer other than the root is addressed by its own manifest entry,
    // which is the entry whose key equals the package directory plus
    // `/package.json`. Getting this wrong would attribute one workspace
    // package's resolutions to another, so it is a lookup with a stated rule
    // rather than an assumption that the root is the only importer.
    const manifestKey =
      importerKey(importer) === "." ? "" : `${importerKey(importer)}/package.json`;
    const declared = asRecord(map[manifestKey]);
    const dependencyNames = new Set<string>();
    for (const field of [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
      "peerDependencies",
    ]) {
      const block = asRecord(declared[field]);
      for (const name of Object.keys(block)) {
        dependencyNames.add(name);
      }
    }

    const versions = new Map<string, ResolvedEntry>();
    for (const name of [...dependencyNames].sort(compareCodeUnits)) {
      const entry = asRecord(map[`node_modules/${name}`]);
      const version = entry["version"];
      if (typeof version !== "string") {
        continue;
      }
      const pointer = `/packages/node_modules~1${name.replace(/~/g, "~0").replace(/\//g, "~1")}/version`;
      const found = locations.get(pointer);
      const cited: SourceLocation = found ?? { source: path, line: 1 };
      versions.set(name, {
        version,
        // The lockfile line, never the manifest line: the declaration's
        // provenance belongs to the declaration, and these are two claims about
        // two different questions. A missing index entry falls back to line 1,
        // which the graph validator rejects rather than accepts — an uncited
        // fact must fail loudly, not enter the graph looking legitimate.
        provenance: { ...cited, pointer },
      });
    }
    return { versions, status: "resolved", detail: null };
  },
};

/** Narrows a parsed JSON value to an object, or an empty record. */
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Renders a thrown value for a diagnostic, without inventing a message. */
function describeError(error: unknown, subject: string): string {
  return error instanceof Error && error.message.length > 0
    ? `${subject}: ${error.message}`
    : `${subject}: an unknown error occurred.`;
}

/** The parsed-document shape the pnpm adapter reads. */
type LockDocument = ReturnType<typeof parseDocument>;

/**
 * The position index of a JSON document, or an empty one.
 *
 * A separate function so the adapter never branches on the index result inline:
 * an empty index means no citation, and the citation fallback below is what
 * turns that into a validator-rejected line 1 rather than a plausible line.
 */
function jsonLocationMap(
  result: ReturnType<typeof indexJsonPositions>,
): Map<string, SourceLocation> {
  const copy = new Map<string, SourceLocation>();
  if (result.ok) {
    for (const [pointer, location] of result.locations) {
      copy.set(pointer, location);
    }
  }
  return copy;
}

/** The dependency names a pnpm importer declares for one class. */
function keysAt(document: LockDocument, path: readonly unknown[]): string[] {
  const found: unknown = document.getIn(path, true);
  if (!isMap(found)) {
    return [];
  }
  const names: string[] = [];
  for (const item of found.items) {
    if (!isPair(item) || !isScalar(item.key)) {
      continue;
    }
    const key = item.key.value;
    if (typeof key === "string") {
      names.push(key);
    }
  }
  return names.sort(compareCodeUnits);
}

/**
 * The value of the first scalar at a path, or undefined.
 *
 * `isScalar` rather than a shape test, so a map or a sequence at this path is
 * reported as "no version" instead of being read as though it were one.
 */
function firstScalar(document: LockDocument, path: readonly unknown[]): unknown {
  const found: unknown = document.getIn(path, true);
  return isScalar(found) ? found.value : undefined;
}

/** An importer key, in the form a lockfile writes it. */
function importerKey(importer: string): string {
  return importer === "." ? "." : importer;
}

/**
 * Every supported adapter, in a fixed order.
 *
 * A fixed list rather than a chain of `if`s in the graph builder, so adding a
 * format is a new entry here and nothing else, and so a repository with two
 * lockfiles produces the same graph regardless of the order an adapter list
 * happens to be walked in.
 */
export const LOCKFILE_ADAPTERS: readonly LockfileAdapter[] = [pnpmAdapter, npmAdapter];

/**
 * The adapters that claim a lockfile path, in the fixed adapter order.
 *
 * More than one can match — `pnpm-lock.yaml` and `package-lock.json` together is
 * a real and messy repository — and every claim is read separately, because
 * which manager a repository "uses" is ADR-0045's question and not this one's.
 * A graph here says "this lockfile resolved these versions", never "this
 * repository uses pnpm".
 */
export function adaptersFor(path: string): readonly LockfileAdapter[] {
  return LOCKFILE_ADAPTERS.filter((adapter) => adapter.supports(path));
}

/** Lockfile filenames this version reads, in code-unit order. */
export const SUPPORTED_LOCKFILES: readonly string[] = ["package-lock.json", "pnpm-lock.yaml"];
