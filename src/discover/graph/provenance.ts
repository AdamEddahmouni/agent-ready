/**
 * Turning a parser offset into a citable `SourceLocation` (ADR-0047 §7).
 *
 * Three jobs live here and nowhere else, because each of them is the kind of
 * thing that is right in one call site and forgotten in another:
 *
 *  1. Converting TypeScript's 0-based line/character into 1-based line/column.
 *     Line 1 is the first line of a file; that is what a person means, and a
 *     citation that says otherwise is a citation nobody can check.
 *  2. Proving a path is a canonical repository-relative path, so no absolute
 *     checkout path can reach the snapshot and make its bytes depend on where
 *     the repository happens to live.
 *  3. Caching offset→line conversion per file, so a file with two thousand
 *     imports is split into lines once rather than two thousand times.
 */

import { compareCodeUnits } from "../ordering.js";
import type { SourceLocation } from "./types.js";

/** The repository root as a repository-relative path. */
export const REPOSITORY_ROOT = ".";

/**
 * True when `path` is a canonical repository-relative path.
 *
 * Canonical means: `/`-separated, no leading slash, no `.` or `..` segment, no
 * empty segment, and no backslash. Every one of those exclusions exists because
 * admitting it would make two different strings name the same file, and an
 * identity that has two spellings is an identity a validator cannot check.
 *
 * `.` is the one accepted special case, because it is how a snapshot names the
 * repository root (ADR-0044) and every collection in this codebase uses it.
 */
export function isRepositoryRelativePath(path: string): boolean {
  if (path.length === 0) {
    return false;
  }
  if (path === REPOSITORY_ROOT) {
    return true;
  }
  if (path.startsWith("/") || path.startsWith("./") || path.includes("\\")) {
    return false;
  }
  if (path.includes("//")) {
    return false;
  }
  if (/^[A-Za-z]:/.test(path)) {
    // A Windows drive-absolute path reaches a snapshot only if a host-specific
    // path leaked into it, and `C:\...` is caught above; `C:/...` is caught here.
    return false;
  }
  return path
    .split("/")
    .every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

/** True when `path` is relative to, or equal to, the package rooted at `root`. */
export function isWithinDirectory(path: string, root: string): boolean {
  if (root === REPOSITORY_ROOT) {
    return true;
  }
  return path === root || path.startsWith(`${root}/`);
}

/**
 * The containing directory of a repository-relative path, `.` at the top.
 *
 * String surgery rather than `path.dirname` because the snapshot's paths are
 * `/`-separated on every platform, and a host separator reaching a comparison
 * would make the result depend on where discovery ran.
 */
export function parentDirectory(path: string): string {
  const lastSeparator = path.lastIndexOf("/");
  return lastSeparator < 0 ? REPOSITORY_ROOT : path.slice(0, lastSeparator);
}

/** The final segment of a repository-relative path. */
export function baseName(path: string): string {
  const lastSeparator = path.lastIndexOf("/");
  return lastSeparator < 0 ? path : path.slice(lastSeparator + 1);
}

/**
 * The extension used to select a source file, with the leading dot.
 *
 * A `.d.ts` file reports `.ts` from a naive last-dot search, and that is exactly
 * the file type this graph refuses (§11 of ADR-0047), so the compound extension
 * is recognised first. Getting this wrong would put declaration files into the
 * module universe as if they were code.
 */
export function sourceExtensionOf(path: string): string {
  const name = baseName(path);
  for (const declarationExtension of DECLARATION_EXTENSIONS) {
    if (name.endsWith(declarationExtension)) {
      // The compound extension is sliced, not measured from a constant: a fixed
      // offset works only for two-character extensions, so `.d.ts` happened to
      // come out right while `.d.mts` lost its leading dot and reported
      // `d.mts` — an extension no exclusion list matches, which would have put
      // every declaration file into the module universe as if it were code.
      return name.slice(name.length - declarationExtension.length);
    }
  }
  const lastDot = name.lastIndexOf(".");
  return lastDot < 0 ? "" : name.slice(lastDot);
}

/** The compound extensions of TypeScript declaration files, longest first. */
const DECLARATION_EXTENSIONS: readonly string[] = [".d.mts", ".d.cts", ".d.ts"];

/**
 * How many lines a file has, under this codebase's one rule.
 *
 * Every line count discovery reports comes from here rather than from a local
 * `split("\n").length`, because that count is the validator's *upper bound* for a
 * citation: a per-caller count that disagreed by one would either reject a real
 * citation or accept a phantom one, and the disagreement would be invisible.
 */
export function countLines(text: string): number {
  return LineIndex.of(text).lineCount;
}

/**
 * A per-file line index, built once and reused for every position in that file.
 *
 * Source positions are needed per import, per dependency, and per rule, and
 * `text.split("\n")` is linear in file length — so a file with a thousand
 * imports would otherwise be split a thousand times. The cache is run-local and
 * bounded by the number of files actually parsed, so it cannot outlive the run
 * or grow without limit.
 */
export class LineIndex {
  private readonly starts: number[];

  private constructor(text: string) {
    this.starts = [0];
    for (let at = text.indexOf("\n"); at >= 0; at = text.indexOf("\n", at + 1)) {
      this.starts.push(at + 1);
    }
    // A file ending in a newline does not have a final empty line. Keeping the
    // phantom line would make `lineCount` one too high, and `lineCount` is the
    // validator's upper bound: a citation onto it would pass a range check for a
    // line a reader cannot open.
    if (this.starts.length > 1 && this.starts[this.starts.length - 1] === text.length) {
      this.starts.pop();
    }
  }

  static of(text: string): LineIndex {
    return new LineIndex(text);
  }

  /** Total lines in the file. A trailing newline does not add a line. */
  get lineCount(): number {
    return this.starts.length;
  }

  /**
   * A 1-based line for a 0-based character offset.
   *
   * Binary search rather than a scan, because a large file with many imports
   * would otherwise be quadratic in the number of positions asked about.
   */
  lineAt(offset: number): number {
    let low = 0;
    let high = this.starts.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      const start = this.starts[middle];
      if (start !== undefined && start <= offset) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    return low + 1;
  }

  /** A 1-based column for a 0-based character offset on `line` (1-based). */
  columnAt(line: number, offset: number): number {
    const start = this.starts[line - 1] ?? 0;
    return offset - start + 1;
  }
}

/**
 * A run-local cache of line indexes, keyed by repository-relative path.
 *
 * Deliberately *not* a persistent cache: ADR-0047 §13 forbids state that
 * outlives a run, and a cache file would also be the first thing in this
 * command to write to the repository.
 */
export class LineIndexCache {
  private readonly indexes = new Map<string, LineIndex>();

  constructor(private readonly texts: ReadonlyMap<string, string>) {}

  /** Records file text so positions in it can later be resolved. */
  remember(path: string, text: string): void {
    this.indexes.set(path, LineIndex.of(text));
  }

  /** A 1-based line/column pair for an offset in a remembered file. */
  positionOf(path: string, offset: number): { line: number; column: number } {
    const index = this.indexes.get(path);
    if (index === undefined) {
      // A position in a file whose text was never seen cannot be cited, and a
      // fabricated line is worse than none — so this returns the only line
      // number that is always in range and the validator will reject the item.
      return { line: 1, column: 1 };
    }
    const line = index.lineAt(offset);
    return { line, column: index.columnAt(line, offset) };
  }

  /** Number of lines in a remembered file, or 0 when it was never read. */
  lineCountOf(path: string): number {
    return this.indexes.get(path)?.lineCount ?? 0;
  }

  /** Every remembered file, with its line count. */
  lineCounts(): ReadonlyMap<string, number> {
    const counts = new Map<string, number>();
    for (const [path, index] of this.indexes) {
      counts.set(path, index.lineCount);
    }
    return counts;
  }

  /** The text of a remembered file, for tests that check a cited line. */
  textOf(path: string): string | undefined {
    return this.texts.get(path);
  }
}

/**
 * Builds a `SourceLocation` from a remembered file and a 0-based offset range.
 *
 * The one place a graph citation is constructed from a TypeScript position.
 * `endOffset` is the offset *after* the last character, which is how TypeScript
 * reports `node.end`; passing it through unchanged is what makes a cited span
 * line up with the source the reader opens.
 */
export function locationFromNode(
  cache: LineIndexCache,
  source: string,
  start: number,
  end: number,
  pointer?: string,
): SourceLocation {
  const from = cache.positionOf(source, start);
  const to = cache.positionOf(source, end);
  return {
    source,
    line: from.line,
    column: from.column,
    endLine: to.line,
    endColumn: to.column,
    ...(pointer !== undefined && { pointer }),
  };
}

/** The comparison ADR-0045's single ordering rule provides, re-exported. */
export { compareCodeUnits };
