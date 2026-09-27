/**
 * Expanding a declared workspace pattern against the file system.
 *
 * This is the one place where repository-authored text causes file-system
 * reads, which makes it the security boundary of the whole issue. Three
 * properties are load-bearing, and each has a test that fails if it is broken:
 *
 *  1. **Fenced to the repository root.** A pattern is normalized by
 *     `contract/paths.ts` before anything is read, so an absolute path or a
 *     `..` escape is rejected before it reaches the file system. Matched
 *     entries are checked for real-path containment, and a symbolic link is
 *     never traversed — so a link inside the repository is not a way out of it.
 *  2. **Bounded.** Depth and entry counts are code constants, not configuration,
 *     so the cost of expansion is the same for every repository and cannot be
 *     tuned into an unbounded scan.
 *  3. **Deterministic.** Entries are sorted by code-unit at every level, so
 *     file-system enumeration order is never observable in the snapshot.
 *
 * Pattern *semantics* are delegated entirely to the ADR-0005 subset already
 * implemented in `contract/globMatch.ts` and covered by
 * `tests/unit/globMatch.test.ts`. This module only decides **which** directories
 * are worth offering to that matcher, which keeps a single implementation of
 * the grammar rather than a second one that would eventually disagree.
 */

import { matchesGlobPattern } from "../../contract/globMatch.js";
import { compareCodeUnits } from "../ordering.js";
import { normalizePathPattern } from "../../contract/paths.js";
import type { DiscoveryProbeContext } from "../probe.js";
import { safeList, safeStat } from "../read.js";
import type { WorkspaceCandidateEntry } from "../types.js";

/**
 * Maximum directory depth below a pattern's literal prefix that expansion will
 * reach.
 *
 * A pattern without `**` is expanded to exactly its own segment count, so
 * `packages/*` never looks inside a matched package. A pattern containing `**`
 * is bounded by this constant instead, which is what stops `**` from becoming a
 * whole-repository walk.
 */
export const MAX_WORKSPACE_DEPTH = 8;

/**
 * Maximum number of directory entries enumerated across one expansion.
 *
 * An absolute ceiling on work, independent of how many patterns are declared, so
 * a repository cannot make discovery expensive by declaring more of them.
 *
 * The bound is on entries the walk *enumerates*, and it is charged one entry at
 * a time so that it is a real bound rather than a check applied after the fact.
 * A previous version summed a whole `listDirectory` result and tested the
 * remaining budget on the next iteration, which meant a single directory with
 * five thousand children was listed, then all five thousand became candidates,
 * and the bound was only then noticed — a ceiling the walk could sail straight
 * past. Counting as entries are processed means the candidate list can never
 * exceed this constant, which is the property the bound exists to provide.
 */
export const MAX_WORKSPACE_ENTRIES = 2000;

/**
 * Directories that are never entered.
 *
 * `node_modules` and `.git` are excluded by convention rather than by
 * preference: neither is part of a repository's own source model, and entering
 * `node_modules` would make discovery cost scale with install state, so two
 * checkouts of the same commit would do different amounts of work to produce the
 * same answer.
 */
export const NEVER_TRAVERSED_DIRECTORIES: readonly string[] = ["node_modules", ".git"];

/** A declared pattern that passed normalization, ready to expand. */
export interface NormalizedPattern {
  /** Repository-relative, `/`-separated, NFC, possibly `!`-prefixed. */
  readonly pattern: string;
  /** The declaration it came from, for evidence. */
  readonly source: string;
  /** JSON Pointer into the declaration, so a consumer can point at the entry. */
  readonly pointer: string;
}

export type PatternNormalization =
  | { readonly ok: true; readonly pattern: NormalizedPattern }
  | { readonly ok: false; readonly raw: string; readonly reason: string };

export interface ExpansionResult {
  readonly candidates: readonly WorkspaceCandidateEntry[];
  /**
   * True when a bound stopped expansion before it finished. Reported rather
   * than silently applied: a truncated result must never be presented as a
   * complete one.
   */
  readonly truncated: boolean;
  /** Paths that could not be inspected, so absence could not be established. */
  readonly unreadable: readonly string[];
}

/**
 * Normalizes one declared pattern, rejecting anything that could escape the
 * repository.
 *
 * ADR-0005's normalizer already rejects absolute paths, `..` escapes, extglobs,
 * unbalanced brackets, and control characters, and normalizes separators and
 * Unicode form. Reusing it means the safety rules for an author-declared
 * workspace pattern are the *same code* as the safety rules for a
 * contract-declared path, rather than a parallel implementation that could
 * drift away from it.
 *
 * The one deliberate departure is the repository root. ADR-0005 rejects a
 * pattern that normalizes to `.` because, for a contract path category,
 * referencing the root carries no information. For a workspace it carries
 * exactly that: `packages: ["."]` is how a single-package pnpm repository says
 * "the root is a member of the workspace", and it is real configuration this
 * project itself uses. Treating it as malformed would raise a spurious warning
 * on a large share of the ecosystem, and a diagnostic that fires on ordinary
 * repositories is a diagnostic nobody reads.
 */
export function normalizeWorkspacePattern(
  raw: string,
  source: string,
  pointer: string,
): PatternNormalization {
  const negated = raw.startsWith("!");
  const body = negated ? raw.slice(1) : raw;
  const rootCandidate = body.replace(/\/+$/, "");
  if (body.trim().length === 0) {
    return { ok: false, raw, reason: "the pattern is empty" };
  }
  if (rootCandidate === "" || rootCandidate === ".") {
    // The repository root, spelled the way `listDirectory` and `stat` address
    // it. Using `.` rather than a sentinel keeps the reported pattern identical
    // to what the author wrote, and keeps the literal-path branch below — which
    // already stats and records presence — responsible for handling it.
    return { ok: true, pattern: { pattern: negated ? "!." : ".", source, pointer } };
  }

  const result = normalizePathPattern(raw, `${source}${pointer}`, { allowGlob: true });
  if ("diagnostics" in result) {
    const first = result.diagnostics[0];
    return {
      ok: false,
      raw,
      reason:
        first === undefined
          ? "the pattern was rejected as an unsafe repository path"
          : first.summary,
    };
  }
  const normalizedBody = result.normalized.startsWith("!")
    ? result.normalized.slice(1)
    : result.normalized;
  if (normalizedBody.length === 0) {
    return { ok: false, raw, reason: "the pattern normalizes to an empty path" };
  }
  return { ok: true, pattern: { pattern: result.normalized, source, pointer } };
}

/**
 * Expands every pattern of every declaration into candidate paths.
 *
 * Positional `!` exclusion is honoured exactly as ADR-0005 defines it, and only
 * **within a single declaration source**. An exclusion written in
 * `package.json` does not remove a path matched by `pnpm-workspace.yaml`:
 * merging the two lists would apply a rule across documents the repository
 * wrote separately, and the result would be a pattern set nobody described. If
 * both files exclude the same path, both declarations are still reported and
 * the overlap is visible.
 */
export async function expandPatterns(
  context: DiscoveryProbeContext,
  patterns: readonly NormalizedPattern[],
): Promise<ExpansionResult> {
  const budget = new EntryBudget();
  const candidates = new Map<string, WorkspaceCandidateEntry>();
  const unreadable = new Set<string>();
  // Set when a bound actually cost something, and reported rather than silently
  // applied: a truncated candidate list must never look like a complete one.
  let truncated = false;
  // Paths a `!` pattern has removed, tracked per source.
  const excluded = new Map<string, Set<string>>();

  for (const entry of patterns) {
    const { source } = entry;
    if (entry.pattern.startsWith("!")) {
      const removed = excluded.get(source) ?? new Set<string>();
      for (const candidate of candidates.values()) {
        if (candidate.source === source && matchesGlobPattern(candidate.path, entry.pattern)) {
          removed.add(candidate.path);
        }
      }
      excluded.set(source, removed);
      continue;
    }

    if (isLiteralPath(entry.pattern)) {
      await recordLiteralCandidate(context, candidates, unreadable, entry);
      continue;
    }

    const body = entry.pattern;
    const prefix = literalPrefixOf(body);
    const enumerated = await enumerateDirectories(context, prefix, depthFor(body), budget);
    for (const directory of enumerated.paths) {
      if (!matchesGlobPattern(directory, body)) {
        continue;
      }
      const key = candidateKey(source, entry.pattern, directory);
      candidates.set(key, {
        path: directory,
        source,
        pattern: entry.pattern,
        present: true,
      });
    }
    if (enumerated.truncated) {
      truncated = true;
    }
    if (budget.exhausted) {
      break;
    }
  }

  const surviving = [...candidates.values()].filter(
    (candidate) => !(excluded.get(candidate.source)?.has(candidate.path) ?? false),
  );

  return {
    candidates: surviving.sort(compareCandidates),
    truncated,
    unreadable: [...unreadable].sort(compareCodeUnits),
  };
}

/**
 * Records a literal declared path as a candidate whether or not it is there.
 *
 * This is what keeps a workspace declaring `packages/a` and `packages/missing`
 * honest: the missing path stays in the snapshot as an explicit absence rather
 * than disappearing because it produced no candidate. `present` is three-valued
 * because `false` (absent) and `null` (could not be inspected) are different
 * claims, and reporting ignorance as absence is the false negative ADR-0044
 * calls out.
 */
async function recordLiteralCandidate(
  context: DiscoveryProbeContext,
  candidates: Map<string, WorkspaceCandidateEntry>,
  unreadable: Set<string>,
  entry: NormalizedPattern,
): Promise<void> {
  const stat = await safeStat(context, entry.pattern);
  const present = stat.status === "failed" ? null : stat.status === "present" && stat.isDirectory;
  if (stat.status === "failed") {
    unreadable.add(entry.pattern);
  }
  candidates.set(candidateKey(entry.source, entry.pattern, entry.pattern), {
    path: entry.pattern,
    source: entry.source,
    pattern: entry.pattern,
    present,
  });
}

/**
 * A single shared entry budget, so the ceiling applies to the whole expansion
 * rather than resetting per pattern and being multiplied by the declaration.
 *
 * Shared across every pattern on purpose. A budget per pattern would make the
 * effective ceiling the product of the bound and the number of declared
 * patterns, which is a number the repository controls — the opposite of a
 * constant.
 */
class EntryBudget {
  private remaining = MAX_WORKSPACE_ENTRIES;

  /**
   * Charges one enumerated entry and reports whether any budget is left.
   *
   * Callers stop as soon as it reports `false`. Charging before the check is
   * what makes the last entry inside the bound rather than one past it.
   */
  spendOne(): boolean {
    this.remaining -= 1;
    return this.remaining > 0;
  }

  get exhausted(): boolean {
    return this.remaining <= 0;
  }
}

/**
 * Enumerates directories at or below `prefix`, no deeper than `maxDepth`.
 *
 * Symbolic links are never followed and every matched directory is confirmed to
 * be inside the repository by real path. The prefix is walked without listing
 * whenever it is literal, so a pattern like `packages/*` reads one directory
 * listing rather than the whole tree.
 */
async function enumerateDirectories(
  context: DiscoveryProbeContext,
  prefix: string,
  maxDepth: number,
  budget: EntryBudget,
): Promise<{ readonly paths: readonly string[]; readonly truncated: boolean }> {
  const found: string[] = [];
  let truncated = false;
  if (prefix !== "") {
    const stat = await safeStat(context, prefix);
    if (stat.status !== "present" || !stat.isDirectory) {
      return { paths: found, truncated };
    }
    found.push(prefix);
  }

  const queue: { path: string; depth: number }[] = [{ path: prefix, depth: 0 }];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) {
      break;
    }
    if (budget.exhausted) {
      truncated = true;
      continue;
    }
    if (current.depth >= maxDepth) {
      // The depth bound stopped this branch. Whether anything was actually
      // missed has to be *checked*, not assumed: a repository shallower than the
      // bound must not be reported as truncated, and a truncated walk must never
      // be silent. So the directory is listed once to find out, and the bound is
      // recorded only if there was something below it.
      if (await hasChildDirectory(context, current.path, budget)) {
        truncated = true;
      }
      continue;
    }
    const listing = await safeList(context, current.path);
    if (listing.status !== "listed") {
      continue;
    }
    let spendExhausted = false;
    for (const entry of listing.entries) {
      // Charged for every entry looked at, including one that is skipped. The
      // budget is a bound on work performed, and deciding not to enter
      // `node_modules` is work performed.
      spendExhausted = !budget.spendOne();
      if (NEVER_TRAVERSED_DIRECTORIES.includes(entry.name)) {
        if (spendExhausted) break;
        continue;
      }
      if (entry.isSymbolicLink || !entry.isDirectory) {
        if (spendExhausted) break;
        continue;
      }
      const child = current.path === "" ? entry.name : `${current.path}/${entry.name}`;
      if (!(await isInsideRepository(context, child))) {
        if (spendExhausted) break;
        continue;
      }
      found.push(child);
      if (spendExhausted) break;
      queue.push({ path: child, depth: current.depth + 1 });
    }
    if (spendExhausted) {
      // The ceiling is spent, so the rest of this listing is not enumerated and
      // the queued directories are not entered. Reported, never applied
      // silently: a candidate list that stopped at a bound has to say so.
      truncated = true;
    }
  }
  return { paths: dedupe(found), truncated };
}

/**
 * Whether a directory holds at least one subdirectory that is traversable.
 *
 * Used only at the depth boundary, to decide whether the bound actually cost
 * anything. Symlinks and excluded directories do not count, because the walk
 * would not have entered them either — reporting truncation for paths the walk
 * was never going to take would be a false alarm on every repository that
 * happens to contain a `node_modules` at its deepest level.
 *
 * The entries it looks at are charged to the same budget, so the constant bounds
 * every entry the expansion examines rather than only the ones it descends
 * into. That is a real cost: a boundary directory with many entries can spend
 * the budget on a check whose result is discarded. It is charged anyway,
 * because a bound that stops being enforced the moment an entry is skipped is
 * not a bound.
 */
async function hasChildDirectory(
  context: DiscoveryProbeContext,
  directory: string,
  budget: EntryBudget,
): Promise<boolean> {
  const listing = await safeList(context, directory);
  if (listing.status !== "listed") {
    return false;
  }
  for (const entry of listing.entries) {
    if (!budget.spendOne()) {
      break;
    }
    if (
      entry.isDirectory &&
      !entry.isSymbolicLink &&
      !NEVER_TRAVERSED_DIRECTORIES.includes(entry.name)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Confirms a repository-relative path really is inside the repository.
 *
 * A real directory entry cannot be reached through a symbolic link, so this is
 * belt-and-braces for platforms that report a directory junction as a
 * directory. Comparing real paths is the check that actually holds. A path that
 * cannot be resolved is not traversed: failing closed is the entire point.
 */
async function isInsideRepository(
  context: DiscoveryProbeContext,
  relativePath: string,
): Promise<boolean> {
  try {
    const root = await context.realPath(".");
    const resolved = await context.realPath(relativePath);
    return isContained(normalizeAbsolute(root), normalizeAbsolute(resolved));
  } catch {
    return false;
  }
}

function isContained(root: string, candidate: string): boolean {
  if (candidate === root) {
    return true;
  }
  return candidate.startsWith(root.endsWith("/") ? root : `${root}/`);
}

/**
 * Canonicalizes an absolute path for a containment comparison.
 *
 * Both sides go through this, and that is the point. The root is requested as
 * `"."`, which the context joins onto the repository root, so it arrives as
 * `<root>/.` — a spelling that is equal to the root but does not *start with*
 * it. Comparing raw strings therefore rejects every legitimate child, and the
 * whole walk silently finds nothing. A `realPath` implementation that happens to
 * resolve `.` hides the bug on a real filesystem; an identity implementation
 * does not. Normalizing both sides makes the check correct regardless of what
 * the `FileSystem` does, so the safety property does not depend on a detail of
 * an interface this module does not own.
 *
 * Deliberately minimal: it resolves `.` segments, collapses repeated
 * separators, strips a trailing separator, and normalizes Unicode form. It does
 * **not** resolve `..` — a real path has none, and a `..` surviving here would
 * be a reason to refuse the path rather than to resolve it.
 */
function normalizeAbsolute(path: string): string {
  const segments: string[] = [];
  for (const segment of path.replace(/\\/g, "/").normalize("NFC").split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/");
}

/** The longest leading run of literal segments, used to narrow the walk. */
function literalPrefixOf(pattern: string): string {
  const segments: string[] = [];
  for (const segment of pattern.split("/")) {
    if (isLiteralPath(segment)) {
      segments.push(segment);
      continue;
    }
    break;
  }
  return segments.join("/");
}

/**
 * How deep below the literal prefix the walk needs to go.
 *
 * A pattern with no `**` is exactly as deep as it is long, so `packages/*` looks
 * one level below `packages` and never inside a matched package. Only a `**`
 * pattern is allowed the full depth bound.
 */
function depthFor(pattern: string): number {
  if (pattern.includes("**")) {
    return MAX_WORKSPACE_DEPTH;
  }
  const prefix = literalPrefixOf(pattern);
  const prefixSegments = prefix === "" ? 0 : prefix.split("/").length;
  return Math.max(1, pattern.split("/").length - prefixSegments);
}

function isLiteralPath(pattern: string): boolean {
  return !/[*?[\]{}]/.test(pattern);
}

function candidateKey(source: string, pattern: string, path: string): string {
  return `${source} ${pattern} ${path}`;
}

function compareCandidates(a: WorkspaceCandidateEntry, b: WorkspaceCandidateEntry): number {
  return (
    compareCodeUnits(a.path, b.path) ||
    compareCodeUnits(a.source, b.source) ||
    compareCodeUnits(a.pattern, b.pattern)
  );
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareCodeUnits);
}
