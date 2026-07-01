import type { Diagnostic } from "../diagnostics/types.js";
import type { DiagnosticCode } from "../diagnostics/codes.js";

/**
 * Path and glob semantics (see docs/specification/paths-and-globs.md).
 *
 * All contract-declared paths are pure string patterns, never resolved
 * against the real file system here. They are normalized to repository-
 * relative, `/`-separated, NFC-normalized strings and rejected outright if
 * they are absolute or attempt to traverse outside the repository root.
 *
 * Supported glob subset (validated, not executed, in this phase):
 *   - `*`   matches within a path segment
 *   - `**`  matches across path segments
 *   - `?`   matches a single character
 *   - `[...]` character classes
 *   - `{a,b}` brace alternation
 *   - leading `!` negation
 * Extglobs (`@(...)`, `+(...)`, etc.) are not supported and are rejected.
 */

const EXTGLOB_PATTERN = /[@?+*!]\(/;

function hasControlCharacters(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

export interface PathValidationOptions {
  /** Whether glob metacharacters are permitted (false for literal file references). */
  readonly allowGlob: boolean;
}

function diagnostic(
  code: DiagnosticCode,
  field: string,
  summary: string,
  detail: string,
  remediation: string,
): Diagnostic {
  return { code, severity: "error", field, summary, detail, remediation };
}

function isAbsoluteLike(raw: string): boolean {
  if (/^[A-Za-z]:[\\/]/.test(raw)) {
    return true; // Windows drive-letter path, e.g. C:\ or C:/
  }
  if (raw.startsWith("/") || raw.startsWith("\\")) {
    return true; // POSIX absolute or UNC (\\server\share, //server/share)
  }
  return false;
}

function hasBalancedBrackets(pattern: string): boolean {
  let bracketDepth = 0;
  let braceDepth = 0;
  for (const char of pattern) {
    if (char === "[") bracketDepth++;
    else if (char === "]") bracketDepth--;
    else if (char === "{") braceDepth++;
    else if (char === "}") braceDepth--;
    if (bracketDepth < 0 || braceDepth < 0) return false;
  }
  return bracketDepth === 0 && braceDepth === 0;
}

/**
 * Normalizes and validates a single repository-relative path pattern.
 * Returns the normalized `/`-separated pattern, or diagnostics explaining
 * why the pattern was rejected.
 */
export function normalizePathPattern(
  raw: string,
  field: string,
  options: PathValidationOptions,
): { readonly normalized: string } | { readonly diagnostics: readonly Diagnostic[] } {
  if (raw.length === 0 || raw.trim().length === 0) {
    return {
      diagnostics: [
        diagnostic(
          "PATH_PATTERN_INVALID",
          field,
          "Path pattern must not be empty.",
          `Field "${field}" contains an empty or whitespace-only path.`,
          "Provide a non-empty repository-relative path.",
        ),
      ],
    };
  }

  if (hasControlCharacters(raw)) {
    return {
      diagnostics: [
        diagnostic(
          "PATH_PATTERN_INVALID",
          field,
          "Path pattern contains control characters.",
          `Field "${field}" contains an unprintable control character.`,
          "Remove control characters from the path pattern.",
        ),
      ],
    };
  }

  if (isAbsoluteLike(raw)) {
    return {
      diagnostics: [
        diagnostic(
          "PATH_ABSOLUTE_DISALLOWED",
          field,
          "Absolute paths are not allowed.",
          `Field "${field}" value "${raw}" is an absolute path (drive-letter, UNC, or POSIX-rooted). ` +
            "All contract paths must be repository-relative.",
          "Rewrite the path relative to the repository root, without a leading slash or drive letter.",
        ),
      ],
    };
  }

  const negated = raw.startsWith("!");
  const body = negated ? raw.slice(1) : raw;

  if (!options.allowGlob && /[*?[\]{}!]/.test(body)) {
    return {
      diagnostics: [
        diagnostic(
          "PATH_PATTERN_INVALID",
          field,
          "Glob syntax is not allowed in this field.",
          `Field "${field}" must reference a literal file path, but "${raw}" contains glob metacharacters.`,
          "Remove glob metacharacters or use a field that accepts glob patterns.",
        ),
      ],
    };
  }

  if (options.allowGlob) {
    if (EXTGLOB_PATTERN.test(body)) {
      return {
        diagnostics: [
          diagnostic(
            "PATH_PATTERN_INVALID",
            field,
            "Extglob syntax is not supported.",
            `Field "${field}" value "${raw}" uses extglob syntax (e.g. "@(...)"), which is not part of the supported glob subset.`,
            "Rewrite using *, **, ?, [...], {a,b}, or a leading ! negation only.",
          ),
        ],
      };
    }
    if (!hasBalancedBrackets(body)) {
      return {
        diagnostics: [
          diagnostic(
            "PATH_PATTERN_INVALID",
            field,
            "Glob pattern has unbalanced brackets or braces.",
            `Field "${field}" value "${raw}" has mismatched [ ] or { } characters.`,
            "Balance every [ with ] and every { with }.",
          ),
        ],
      };
    }
  }

  const normalizedBody = body.normalize("NFC").replace(/\\/g, "/");
  const rawSegments = normalizedBody.split("/");
  const segments: string[] = [];

  for (const segment of rawSegments) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (segments.length === 0 || segments[segments.length - 1] === "..") {
        return {
          diagnostics: [
            diagnostic(
              "PATH_TRAVERSAL_DISALLOWED",
              field,
              "Path escapes the repository root.",
              `Field "${field}" value "${raw}" attempts to traverse above the repository root using "..".`,
              'Remove leading ".." segments so the path stays within the repository.',
            ),
          ],
        };
      }
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  if (segments.length === 0) {
    return {
      diagnostics: [
        diagnostic(
          "PATH_PATTERN_INVALID",
          field,
          "Path pattern resolves to the repository root.",
          `Field "${field}" value "${raw}" normalizes to an empty path.`,
          "Reference a specific file or subdirectory, not the repository root itself.",
        ),
      ],
    };
  }

  const normalized = (negated ? "!" : "") + segments.join("/");
  return { normalized };
}
