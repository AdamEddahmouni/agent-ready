/**
 * CODEOWNERS: parsing, matching, and the explicit `unowned` state
 * (ADR-0047 §17–§19).
 *
 * Three things this module refuses to do, and each refusal is load-bearing:
 *
 *  - **It does not reuse `contract/globMatch.ts`.** That matcher implements
 *    ADR-0005's *contract-path* grammar. A CODEOWNERS file is gitignore-derived
 *    and has different anchoring (`/src/*` anchored, `src/*` not), different
 *    directory semantics (a pattern matching a directory covers everything under
 *    it), and no negation at all. Reusing one matcher and calling it
 *    compatibility would be a claim this implementation cannot make, so the
 *    grammar below is its own, small, and separately tested.
 *  - **It does not approximate an unsupported pattern.** A character class, an
 *    extglob, a backslash escape, or a leading `!` is skipped and reported with
 *    its file and line, while every supported rule beside it keeps applying. One
 *    exotic line must not delete the twenty ordinary ones next to it.
 *  - **It does not guess an owner when there is none.** No Git history, no last
 *    committer, no repository owner, no sentinel `UNOWNED` node. `unowned` is a
 *    state on the subject, and the state is real.
 */

import { compareCodeUnits } from "../ordering.js";
import { REPOSITORY_ROOT, isRepositoryRelativePath } from "./provenance.js";
import type { UnsupportedPattern } from "./types.js";

/**
 * The supported CODEOWNERS locations, in upstream precedence order.
 *
 * First match wins, so `.github/CODEOWNERS` is consulted before `docs/CODEOWNERS`
 * before the root — which is what upstream semantics say. Files are never
 * merged: a repository with two of them has one ownership surface, the winning
 * one, and reporting a synthetic union would publish a policy nobody wrote.
 */
export const CODEOWNERS_LOCATIONS: readonly string[] = [
  ".github/CODEOWNERS",
  "docs/CODEOWNERS",
  "CODEOWNERS",
];

/** One parsed, supported rule. */
export interface CodeownersRule {
  /** The pattern, verbatim, with its leading `/` and trailing `/` intact. */
  readonly pattern: string;
  /** Owner tokens, verbatim, in the order the rule wrote them. */
  readonly owners: readonly string[];
  /** 1-based line the rule is on. */
  readonly line: number;
}

/** A parsed CODEOWNERS file, and what became of the lines it did not model. */
export interface CodeownersFile {
  readonly path: string;
  readonly rules: readonly CodeownersRule[];
  readonly unsupported: readonly UnsupportedPattern[];
  /** Lines in the file, so a rule's citation can be range-checked. */
  readonly lineCount: number;
}

/**
 * Finds and parses the winning CODEOWNERS file.
 *
 * Returns a `surface` describing what was found — including "nothing was",
 * which is a **successful, complete** answer rather than a failure. A repository
 * with no ownership policy has zero rules and every subject is explicitly
 * unowned, and saying that plainly is more useful than inventing a default
 * owner.
 */
export async function readOwnershipSurface(
  read: (
    path: string,
  ) => Promise<
    | { status: "read"; content: string }
    | { status: "absent" }
    | { status: "failed"; detail: string }
  >,
): Promise<{ readonly file: CodeownersFile | null; readonly detail: string | null }> {
  for (const path of CODEOWNERS_LOCATIONS) {
    const outcome = await safeReadFrom(read, path);
    if (outcome.status === "read") {
      return { file: parseCodeowners(path, outcome.content), detail: null };
    }
    if (outcome.status === "failed") {
      // The file exists and could not be read. That is ignorance, not absence,
      // and continuing to the next location would report a policy that was
      // never evaluated as though it had been.
      return {
        file: null,
        detail: `A supported CODEOWNERS file exists at ${path} but could not be read: ${outcome.detail}`,
      };
    }
  }
  return { file: null, detail: null };
}

async function safeReadFrom(
  read: (
    path: string,
  ) => Promise<
    | { status: "read"; content: string }
    | { status: "absent" }
    | { status: "failed"; detail: string }
  >,
  path: string,
): Promise<
  { status: "read"; content: string } | { status: "absent" } | { status: "failed"; detail: string }
> {
  try {
    return await read(path);
  } catch (error) {
    return {
      status: "failed",
      detail: error instanceof Error ? error.message : "an unknown error occurred",
    };
  }
}

/**
 * Parses a CODEOWNERS file into supported rules and reported unsupported lines.
 *
 * Comments and blank lines are skipped, and **line numbers are preserved** — a
 * skipped line is still a line, and citing line 9 for a rule on line 11 because
 * two comments were dropped above it would be a citation that points at the
 * wrong rule.
 */
export function parseCodeowners(path: string, text: string): CodeownersFile {
  const rules: CodeownersRule[] = [];
  const unsupported: UnsupportedPattern[] = [];
  const lines = text.split("\n");

  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#")) {
      return;
    }
    const tokens = line.split(/[ \t]+/).filter((token) => token.length > 0);
    const pattern = tokens[0];
    if (pattern === undefined) {
      return;
    }
    const unsupportedReason = unsupportedPatternReason(pattern);
    if (unsupportedReason !== null) {
      unsupported.push({ source: path, line: index + 1, pattern, reason: unsupportedReason });
      return;
    }
    const owners = tokens.slice(1);
    if (owners.length === 0) {
      // A rule with no owner asserts nothing about responsibility. It is
      // reported as unsupported rather than treated as a rule that unowns
      // everything, which would be a large, confident claim from a malformed
      // line.
      unsupported.push({
        source: path,
        line: index + 1,
        pattern,
        reason:
          "The rule names a pattern but no owner. It was not applied, and it does not make anything unowned.",
      });
      return;
    }
    rules.push({ pattern, owners, line: index + 1 });
  });

  return { path, rules, unsupported, lineCount: lines.length };
}

/**
 * Why a pattern is outside the supported subset, or null when it is supported.
 *
 * The subset is `*`, `**`, `?`, literal paths, a leading `/`, and a trailing `/`.
 * Everything else is named rather than approximated, and every one of these
 * reasons is a fact a reader can act on.
 */
export function unsupportedPatternReason(pattern: string): string | null {
  if (pattern.startsWith("!")) {
    return "A leading `!` is not supported. A CODEOWNERS file is not a `.gitignore`, and treating it as one would let a line remove an owner rather than name one.";
  }
  if (pattern.includes("\\")) {
    return "Backslash escaping is not supported.";
  }
  if (pattern.includes("[")) {
    return "Character classes are not supported.";
  }
  if (/(^|[^*?])\(|\(/.test(stripBrackets(pattern))) {
    return "Extended glob forms are not supported.";
  }
  if (pattern.startsWith("/") && pattern.slice(1).includes("..")) {
    return "A pattern escaping the repository root is not supported.";
  }
  return null;
}

function stripBrackets(pattern: string): string {
  return pattern.replace(/\[[^\]]*\]/g, "");
}

/**
 * The owner tokens that apply to a repository-relative path, and the rule that
 * established them.
 *
 * **Last match wins**, which is the upstream rule implemented exactly. Every
 * owner on the winning rule is returned; none is selected over another, because
 * choosing between two declared owners is precisely the ranking this project
 * refuses.
 */
export function ownersForPath(
  rules: readonly CodeownersRule[],
  path: string,
): { readonly owners: readonly string[]; readonly rule: CodeownersRule } | undefined {
  let winner: CodeownersRule | undefined;
  for (const rule of rules) {
    if (ruleMatches(rule.pattern, path)) {
      // The file order is the evaluation order, and the last match replaces the
      // previous winner rather than merging with it.
      winner = rule;
    }
  }
  return winner === undefined ? undefined : { owners: winner.owners, rule: winner };
}

/**
 * Whether one supported pattern covers a repository-relative path.
 *
 * The rule is gitignore-shaped and is stated here in full:
 *
 *  - a pattern with **no `/`** matches an entry name at any depth, so
 *    `README.md` matches `docs/README.md`;
 *  - a pattern with a `/` is matched against the whole repository-relative
 *    path, with a leading `/` anchoring it to the root;
 *  - a pattern with a **trailing `/`** is directory-only;
 *  - a pattern that matches a **directory** also covers everything inside it,
 *    which is what makes `/src/payments/` and `/src/*` both reach
 *    `src/payments/service.ts`;
 *  - `*` matches any run of characters except `/`, `**` any run including `/`,
 *    and `?` exactly one character except `/`.
 */
export function ruleMatches(pattern: string, path: string): boolean {
  const directoryOnly = pattern.endsWith("/");
  const body = directoryOnly ? pattern.slice(0, -1) : pattern;
  if (body.length === 0) {
    return false;
  }
  const anchored = body.startsWith("/");
  const core = anchored ? body.slice(1) : body;
  if (core.length === 0) {
    return false;
  }

  // A pattern with no separator matches at any depth, so it is compared against
  // each ancestor's final segment as well as against the path itself.
  if (!core.includes("/")) {
    for (const segment of segmentsOf(path)) {
      if (matchSegment(core, segment)) {
        return true;
      }
    }
    return false;
  }

  if (anchored) {
    return matchesAtOrBelow(core, path);
  }
  // Unanchored but containing a separator: gitignore matches this against the
  // path from any level, so the suffix of the path is tried at each depth.
  for (const prefixLength of prefixesOf(path)) {
    if (matchesAtOrBelow(core, path.slice(prefixLength))) {
      return true;
    }
  }
  return false;
}

/**
 * Whether `core` matches `path` itself or an ancestor directory of it.
 *
 * The ancestor case is the directory semantics, and it is why `/src/*` reaches
 * `src/payments/service.ts` — `*` matches the *directory* `payments`, and a
 * rule that covers a directory covers what is inside it.
 */
function matchesAtOrBelow(core: string, path: string): boolean {
  if (matchesGlobText(core, path)) {
    return true;
  }
  let current = path;
  for (;;) {
    const separator = current.lastIndexOf("/");
    if (separator < 0) {
      return false;
    }
    current = current.slice(0, separator);
    if (matchesGlobText(core, current)) {
      return true;
    }
  }
}

/** The `/`-separated segments of a path, shallowest first. */
function segmentsOf(path: string): string[] {
  return path.split("/");
}

/** Suffix start offsets of a path: 0, then after each separator. */
function prefixesOf(path: string): number[] {
  const offsets = [0];
  for (let at = path.indexOf("/"); at >= 0; at = path.indexOf("/", at + 1)) {
    offsets.push(at + 1);
  }
  return offsets;
}

/** One path segment against a segment-shaped pattern. */
function matchSegment(pattern: string, segment: string): boolean {
  return matchesGlobText(pattern, segment);
}

/** Suppresses the unused-parameter warning for a pattern-only comparison. */
void matchSegment;

/**
 * The `*` / `**` / `?` matcher for one whole path or one segment.
 *
 * Written as a translation to a regular expression rather than a hand-rolled
 * backtracker, because the three wildcards have exactly three translations and
 * a backtracking matcher is a place a subtle bug hides. `*` and `?` stop at a
 * separator; `**` crosses them, and a path segment written as a double star
 * matches zero or more intermediate segments, which is what makes a pattern
 * like `a/` + `**` + `/b` match `a/b`.
 */
export function matchesGlobText(pattern: string, text: string): boolean {
  return globExpression(pattern).test(text);
}

const EXPRESSION_CACHE = new Map<string, RegExp>();

function globExpression(pattern: string): RegExp {
  const cached = EXPRESSION_CACHE.get(pattern);
  if (cached !== undefined) {
    return cached;
  }
  let source = "^";
  for (let at = 0; at < pattern.length; at++) {
    const char = pattern.charAt(at);
    if (char === "*") {
      if (pattern.charAt(at + 1) === "*") {
        const isSegment = pattern.charAt(at + 2) === "/";
        // A whole-segment double star matches any run of characters including
        // separators; followed by a separator it additionally matches the
        // *absence* of a segment, so the surrounding separators become optional.
        source += isSegment ? "(?:.*/)?" : ".*";
        at += isSegment ? 2 : 1;
        continue;
      }
      source += "[^/]*";
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      continue;
    }
    source += escapeForExpression(char);
  }
  source += "$";
  const expression = new RegExp(source, "u");
  EXPRESSION_CACHE.set(pattern, expression);
  return expression;
}

function escapeForExpression(char: string): string {
  return /[\\^$.|?*+()[\]{}]/u.test(char) ? `\\${char}` : char;
}

/** True when a path is one a CODEOWNERS file could match. */
export function isMatchablePath(path: string): boolean {
  return path !== REPOSITORY_ROOT && isRepositoryRelativePath(path);
}

/** Code-unit ordering for a rule list, used when a caller needs one. */
export function compareRules(a: CodeownersRule, b: CodeownersRule): number {
  return a.line - b.line || compareCodeUnits(a.pattern, b.pattern);
}
