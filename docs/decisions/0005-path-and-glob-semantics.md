# ADR-0005: Path and glob semantics

## Status

Accepted

## Context

`paths.protected`/`generated`/`ignored` and `instructions.sources` all
contain repository-relative path or glob strings. These need
unambiguous, cross-platform-tested rules, since Windows and POSIX
represent paths very differently (drive letters, UNC paths, separator
character).

## Alternatives considered

- **Path resolution**: use `node:path` (platform-specific default export)
  vs. a small custom pure-string normalizer.
- **Glob engine**: `micromatch`/`minimatch` (full-featured, larger
  dependency, executes matches against real files) vs. `picomatch`-style
  minimal validation vs. a fully custom glob syntax checker.
- **Category conflict policy**: allow any overlap, forbid all overlap, or
  something in between (e.g. allow `ignored` + `protected` but not
  `protected` + `generated`).

## Decision

- **All contract-declared paths are pure strings, validated and
  normalized without ever touching the real file system** (with the
  single, documented exception of `instructions.sources`, which must
  reference files that actually exist — see "Instruction sources" below).
  This keeps path/glob validation fast, deterministic, and safe against
  path-based side effects.
- **Custom normalizer, not `node:path`.** `node:path`'s default export is
  platform-specific: on Windows it normalizes output to backslashes, on
  POSIX to forward slashes. Because contract patterns must normalize
  identically regardless of the host OS running the CLI (determinism
  requirement), `src/contract/paths.ts` implements a small, fully-tested,
  OS-independent normalizer instead:
  - Backslashes are converted to forward slashes.
  - `.` segments are dropped; `..` segments pop the previous real segment,
    or are rejected (`PATH_TRAVERSAL_DISALLOWED`) if there is no
    preceding segment to pop (i.e. the pattern would escape the
    repository root).
  - Repeated separators collapse.
  - The pattern is Unicode-normalized to NFC before comparison, so
    visually identical paths using different Unicode normalization forms
    compare equal.
  - Absolute forms are rejected outright (`PATH_ABSOLUTE_DISALLOWED`):
    POSIX-rooted (`/etc/passwd`), Windows drive-letter (`C:\...` or
    `C:/...`), and UNC (`\\server\share` or `//server/share`) paths are
    all detected before any separator normalization happens (so a UNC
    path isn't accidentally "fixed" into something that looks relative).
  - The internal repository representation always uses `/` separators,
    per the specification's guidance, regardless of host OS.
- **Supported glob subset: `*`, `**`, `?`, `[...]`, `{a,b}`, and a leading
  `!` for negation.** Extglobs (`@(...)`, `+(...)`, etc.) are explicitly
  rejected (`PATH_PATTERN_INVALID`) rather than silently reinterpreted,
  because their semantics vary across glob implementations — accepting
  them would create exactly the kind of cross-tool inconsistency this
  project is trying to avoid. Bracket/brace balance is checked directly
  (a small, fully-tested structural check) rather than relying on a glob
  library to reject malformed syntax, because empirical testing showed
  `picomatch` does not throw on unbalanced brackets — it degrades
  leniently, which is unsuitable for a validator whose job is to catch
  mistakes.
- **Category conflict policy: exact-normalized-string collisions are
  rejected, wherever they occur.** A given normalized pattern string may
  appear in `paths.protected`, `paths.generated`, or `paths.ignored` at
  most once, total, across all three lists combined (duplicates within
  one list are rejected the same way as duplicates across lists — both
  produce `PATH_CATEGORY_CONFLICT`). This is the simplest predictable rule
  available: it requires no semantic glob-intersection analysis (which is
  generally undecidable for arbitrary glob pairs), is trivial to explain
  and test exhaustively, and catches the most common real mistake (listing
  the same path twice, or under the wrong category). It deliberately does
  **not** attempt to detect that e.g. `dist/**` (ignored) and `dist/output`
  (generated) overlap semantically — only literal, post-normalization
  string equality is checked. This known limitation is documented rather
  than hidden.
- **Instruction sources are literal file paths, not globs**, and glob
  metacharacters in `instructions.sources` are rejected
  (`PATH_PATTERN_INVALID`). Unlike the path categories, instruction
  sources are semantically checked for existence: each must resolve to a
  real, readable file under the repository root (`INSTRUCTION_SOURCE_INVALID`
  otherwise). This is the one place normalization touches the file
  system, because these paths are meant to reference real, already-written
  documents.
- **Case sensitivity: comparisons are exact, case-sensitive string
  comparisons**, matching POSIX file-system semantics. On case-insensitive
  file systems (default on Windows and macOS), two differently-cased
  patterns that would collide on disk are not detected as a conflict by
  Agent-Ready; this is a documented limitation rather than an attempt at
  file-system-aware case folding, which would require real disk access
  this stage deliberately avoids for glob patterns.
- **Symlinks are not specially resolved for path patterns** (they are
  never touched at all, being pure strings); for `instructions.sources`
  existence checks, ordinary `fs.stat` semantics apply (symlinks are
  followed transparently), consistent with ADR-0004's discovery symlink
  policy.

## Consequences

- Path handling behaves identically whether Agent-Ready runs on Linux,
  macOS, or Windows, which is verified by unit tests that construct
  Windows-style inputs (drive letters, UNC, backslashes) and run them
  through the same code path regardless of host OS.
- Authors get a clear, single rejection reason for genuinely ambiguous or
  unsafe path patterns, and a predictable (if intentionally simple) rule
  for category conflicts.

## Reconsideration trigger

If a future phase implements actual path-category _enforcement_ against
real repository contents (not just contract validation), semantic
glob-overlap detection and case-insensitive-filesystem awareness should
be revisited then, informed by real usage rather than speculatively now.
