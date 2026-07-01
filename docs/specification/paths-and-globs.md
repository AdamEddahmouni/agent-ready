# Path and glob semantics

See [ADR-0005](../decisions/0005-path-and-glob-semantics.md) for full
rationale; this document is the user-facing reference.

## General rules (all path fields)

- Paths must be **repository-relative**. Absolute paths are always
  rejected (`PATH_ABSOLUTE_DISALLOWED`):
  - POSIX-rooted: `/etc/passwd`
  - Windows drive-letter: `C:\Windows`, `C:/Windows`
  - UNC: `\\server\share`, `//server/share`
- Paths attempting to escape the repository root via `..` are rejected
  (`PATH_TRAVERSAL_DISALLOWED`), e.g. `../outside`. A `..` that stays
  within the pattern (e.g. `a/tmp/../b` → `a/b`) is allowed and collapsed
  during normalization.
- Backslashes are accepted as input and normalized to forward slashes;
  the normalized, stored form always uses `/`, regardless of host OS.
- `.` segments and repeated separators are collapsed during
  normalization.
- Patterns are Unicode-normalized to NFC before comparison, so visually
  identical paths using different Unicode normalization forms compare
  equal.
- Comparisons are exact and **case-sensitive** (POSIX semantics), even
  though this may not match the default case-insensitive behavior of the
  underlying file system on Windows or macOS — this is a documented,
  accepted limitation, not file-system-aware case folding.
- Empty, whitespace-only, or control-character-containing patterns are
  rejected (`PATH_PATTERN_INVALID`).

## `paths.protected` / `paths.generated` / `paths.ignored`: glob patterns

Supported subset:

| Syntax      | Meaning                               |
| ----------- | ------------------------------------- |
| `*`         | Matches within a single path segment. |
| `**`        | Matches across path segments.         |
| `?`         | Matches a single character.           |
| `[...]`     | Character class.                      |
| `{a,b}`     | Brace alternation.                    |
| Leading `!` | Negation.                             |

**Not supported**, and rejected outright (`PATH_PATTERN_INVALID`) rather
than silently reinterpreted:

- Extglobs: `@(...)`, `+(...)`, `?(...)`, `!(...)`, `*(...)`.
- Unbalanced `[`/`]` or `{`/`}`.

## `instructions.sources`: literal paths, not globs

Entries here must be literal repository-relative file paths — glob
metacharacters (`* ? [ ] { } !`) are rejected. Each entry must resolve to
a file that actually exists under the repository root
(`INSTRUCTION_SOURCE_INVALID` if missing). This is the one place path
handling touches the real file system; `paths.*` categories are pure
string validation with no existence check.

## Category conflict policy

**A given normalized pattern string may appear in at most one of
`protected`/`generated`/`ignored`, once, across all three lists
combined.** Both of the following are rejected as `PATH_CATEGORY_CONFLICT`:

```yaml
paths:
  ignored:
    - "dist/**"
    - "dist/**" # duplicate within one category
```

```yaml
paths:
  protected:
    - "dist/**"
  generated:
    - "dist/**" # same normalized pattern in two categories
```

This is a deliberately simple, predictable, and exhaustively-tested rule.
It does **not** attempt semantic glob-overlap detection — e.g.
`paths.ignored: ["dist/**"]` and `paths.generated: ["dist/output"]` are
allowed even though `dist/output` matches the `ignored` glob too. Full
glob-intersection analysis is generally undecidable for arbitrary pattern
pairs; only exact, post-normalization string equality is checked.

## Symlinks and file-vs-directory

Glob patterns are pure strings in this phase — never resolved against the
real file system, so symlink and file-vs-directory distinctions do not
apply to `paths.*`. For `instructions.sources`, the existence check uses
ordinary `stat` semantics (symlinks followed transparently) and requires
the target to be a regular file.
