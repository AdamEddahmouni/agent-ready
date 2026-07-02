/**
 * Matches repository-relative paths against the glob subset validated by
 * `contract/paths.ts` and documented in
 * docs/specification/paths-and-globs.md (`*`, `**`, `?`, `[...]`,
 * `{a,b}`, leading `!` negation). Pure string matching; never touches the
 * file system. See ADR-0005 for the supported grammar and ADR-0013 for why
 * this is hand-rolled rather than a third-party glob dependency.
 */

const compiledPatternCache = new Map<string, RegExp>();

function splitTopLevelCommas(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of body) {
    if (char === "{" || char === "[") depth++;
    else if (char === "}" || char === "]") depth--;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts;
}

const REGEX_ESCAPE = new Set(["\\", "^", "$", ".", "|", "+", "(", ")"]);

function translate(pattern: string): string {
  let regex = "";
  let i = 0;
  const n = pattern.length;

  while (i < n) {
    // `.charAt()` always returns a `string` (empty past the end), unlike
    // bracket indexing under `noUncheckedIndexedAccess`, and doubles as a
    // convenient out-of-bounds sentinel throughout this scan.
    const char = pattern.charAt(i);

    if (char === "*") {
      if (pattern.charAt(i + 1) === "*") {
        let j = i + 2;
        while (pattern.charAt(j) === "*") j++; // collapse any run of 3+ stars into "**"
        const precededBySlash = i === 0 || pattern.charAt(i - 1) === "/";
        const followedBySlash = pattern.charAt(j) === "/";
        const atEnd = j >= n;
        if (precededBySlash && followedBySlash) {
          regex += "(?:.*/)?";
          i = j + 1; // also consume the following "/"
          continue;
        }
        if (precededBySlash && atEnd) {
          regex += ".*";
          i = j;
          continue;
        }
        // "**" not bounded by slashes on both sides: treat as a generic
        // cross-segment wildcard, a superset of single "*" behavior.
        regex += ".*";
        i = j;
        continue;
      }
      regex += "[^/]*";
      i++;
      continue;
    }

    if (char === "?") {
      regex += "[^/]";
      i++;
      continue;
    }

    if (char === "[") {
      let j = i + 1;
      let cls = "";
      if (pattern.charAt(j) === "!" || pattern.charAt(j) === "^") {
        cls += "^";
        j++;
      }
      while (j < n && pattern.charAt(j) !== "]") {
        const c = pattern.charAt(j);
        cls += c === "\\" ? "\\\\" : c;
        j++;
      }
      regex += `[${cls}]`;
      i = j + 1;
      continue;
    }

    if (char === "{") {
      let j = i + 1;
      let depth = 1;
      let body = "";
      while (j < n && depth > 0) {
        const c = pattern.charAt(j);
        if (c === "{") depth++;
        else if (c === "}") {
          depth--;
          if (depth === 0) break;
        }
        body += c;
        j++;
      }
      const alternatives = splitTopLevelCommas(body).map(translate);
      regex += `(?:${alternatives.join("|")})`;
      i = j + 1;
      continue;
    }

    if (REGEX_ESCAPE.has(char)) {
      regex += `\\${char}`;
      i++;
      continue;
    }

    regex += char;
    i++;
  }

  return regex;
}

function compilePattern(pattern: string): RegExp {
  const cached = compiledPatternCache.get(pattern);
  if (cached !== undefined) {
    return cached;
  }
  const compiled = new RegExp(`^${translate(pattern)}$`);
  compiledPatternCache.set(pattern, compiled);
  return compiled;
}

/**
 * Tests whether a normalized, repository-relative candidate path matches a
 * single normalized glob pattern. A leading `!` (the negation marker used
 * for category storage) is ignored here — negation is only meaningful when
 * evaluating an ordered pattern list, via `matchesAnyPattern`/
 * `findMatchingPattern`.
 */
export function matchesGlobPattern(candidatePath: string, pattern: string): boolean {
  const body = pattern.startsWith("!") ? pattern.slice(1) : pattern;
  const normalizedCandidate = candidatePath.normalize("NFC").replace(/\\/g, "/");
  return compilePattern(body).test(normalizedCandidate);
}

/**
 * Evaluates an ordered pattern list (as stored in
 * `NormalizedContract.paths.protected`/`generated`/`ignored`) against a
 * candidate path, applying last-match-wins negation semantics. Returns the
 * pattern responsible for the final verdict, or `undefined` if no pattern
 * ultimately matches (either nothing matched, or the last match was a `!`
 * negation).
 */
export function findMatchingPattern(
  candidatePath: string,
  patterns: readonly string[],
): string | undefined {
  let result: string | undefined;
  for (const pattern of patterns) {
    if (matchesGlobPattern(candidatePath, pattern)) {
      result = pattern.startsWith("!") ? undefined : pattern;
    }
  }
  return result;
}

/**
 * Convenience boolean wrapper around `findMatchingPattern`.
 */
export function matchesAnyPattern(candidatePath: string, patterns: readonly string[]): boolean {
  return findMatchingPattern(candidatePath, patterns) !== undefined;
}
