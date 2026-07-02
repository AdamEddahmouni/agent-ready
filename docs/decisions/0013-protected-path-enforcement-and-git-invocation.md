# ADR-0013: Protected-path enforcement and Git invocation

## Status

Accepted

## Context

`paths.protected` has existed since Phase 0/1 as a validated, normalized
glob-pattern list, but nothing has ever matched it against a real file —
it has been purely inert data. `agent-ready check` makes it do something:
report when a file matching `paths.protected` was actually changed,
relative to the working tree, the Git index, or an explicit ref.

This requires two capabilities the project has never had before:

1. Matching a contract-declared glob pattern against a real path.
2. Asking Git which files changed — which means, for the first time
   anywhere in this codebase, invoking an external process.

Both existing ADRs that touch adjacent ground need to be reconciled
explicitly, not silently worked around:

- [ADR-0006](0006-command-representation.md) establishes that
  **contract-declared `run` commands are never executed** — a hard,
  load-bearing security boundary. `agent-ready check` does not change
  this: it never reads, parses, or executes anything from `commands` or
  `verification`. The only process it ever spawns is `git`, with
  Agent-Ready-hardcoded argv arrays; contract content never reaches an
  argument list.
- [ADR-0004](0004-repository-and-contract-discovery.md) establishes that
  **the `git` executable is never invoked for repository discovery** —
  only a `.git` entry's presence is `stat`-checked. That decision is
  scoped specifically to _discovery_ (finding the repository root and
  contract file) and remains unchanged: `check` still discovers the
  contract exactly as `validate`/`inspect`/`generate` do, without
  invoking `git`. Git is invoked only afterward, for the new, narrower
  purpose of reading changed-file state — a materially different
  operation this ADR now documents on its own terms.

## Alternatives considered

**Glob matching:**

- A third-party glob library (`micromatch`, `minimatch`, `picomatch`):
  mature and battle-tested, but imports far more grammar than this
  project's schema supports (extglobs, POSIX character classes, brace
  numeric ranges) — a new dependency whose surface area is mostly unused,
  against the project's "no unused abstractions" principle.
- **Hand-rolled matcher, chosen.** The supported subset (`*`, `**`, `?`,
  `[...]`, `{a,b}`, leading `!`) is small, closed, and already fully
  specified and validated in-house by `contract/paths.ts`
  (`normalizePathPattern`). Compiling exactly that grammar to a `RegExp`
  is a few dozen lines and keeps the matcher's behavior provably
  consistent with what validation already accepts — the same rationale
  already used for this project's custom `pathJoin.ts` and YAML-safety
  configuration.

**Reading Git state:**

- **Parsing `.git` internals directly** (refs, packed-refs, the index):
  rejected — reimplements fragile, versioned binary/text formats Git
  itself does not treat as a stable public API.
- **A pure-JS Git library** (e.g. `isomorphic-git`): rejected — a
  substantial new dependency whose write-path surface (commits, packing,
  network transports) this feature does not need, for a read-only
  "what changed" query real `git` already answers well.
- **Require the caller to supply changed files explicitly** (a flag or
  stdin list), with no Git invocation at all: considered as the _primary_
  mode and rejected, because it defeats the point of a zero-config
  `agent-ready check` that works the same way `git status` does. Kept in
  mind as a possible future escape hatch (e.g. for environments with no
  `git` binary), not built now — no concrete need has surfaced yet.
- **`node:child_process.execFile` with fixed argv arrays, chosen.**
  `execFile` (not `exec`) never invokes a shell and never interpolates a
  string into a shell command line; every argument is a discrete argv
  element. This is the same trust model the project already uses to reason
  about safety elsewhere (structured data in, no string concatenation into
  anything interpreted).

## Decision

- **New `src/contract/globMatch.ts`**: `matchesGlobPattern`,
  `findMatchingPattern`, and `matchesAnyPattern`, operating purely on
  strings (never touching the file system), applying last-match-wins `!`
  negation semantics across an ordered pattern list — consistent with how
  `paths.protected`/`generated`/`ignored` are stored.
- **New `src/git/` module**: a `GitClient` interface
  (`isRepository`, `getChangedFiles`), mirroring the existing
  `FileSystem`/`NodeFileSystem`/`InMemoryFileSystem` pattern —
  `NodeGitClient` (real, `execFile`-backed) and `FakeGitClient`
  (deterministic test double, no process ever spawned in tests).
- **Every Git argument is either hardcoded or a validated discrete argv
  element.** The only caller-influenced value is `--against <ref>`, which
  is passed after Git's own `--end-of-options` marker
  (`git diff --no-color --name-status --end-of-options <ref>`), so Git
  treats it strictly as a revision — never as an option — even if the
  ref string happens to start with `-`. No contract-declared string ever
  reaches a `git` argument list.
- **A fresh repository with no commits is not an error.** `check`
  treats every currently staged/working/untracked file as "changed" in
  that case, rather than failing — new files are exactly the case
  protected-path enforcement should catch, and a brand-new repository is
  the most common time to be creating files that might land under a
  protected pattern.
- **New diagnostics** (`PROTECTED_PATH_MODIFIED`, `GIT_UNAVAILABLE`,
  `GIT_REPOSITORY_NOT_FOUND`) reuse the existing five-value exit-code
  scheme (ADR-0008) rather than introducing new exit codes: a Git-related
  failure to even get inputs to compare maps to the same exit code as
  `CONTRACT_NOT_FOUND` (2); a protected-path violation maps to the same
  exit code as any other validation failure (1).

## Consequences

- `agent-ready check` is the **first command whose availability depends
  on an external binary** (`git` on `PATH`) — unlike `validate`,
  `inspect`, and `generate`, which need only Node.js. This is called out
  explicitly in `docs/specification/cli-reference.md` and
  `docs/security/threat-model.md`, not left implicit.
- The "never execute contract-declared commands" boundary (ADR-0006) is
  unchanged and remains absolute: nothing in `check` reads `commands` or
  `verification` at all.
- `paths.protected` becomes load-bearing for the first time — a contract
  author now gets real enforcement, not just schema validation, from
  declaring a pattern there.
- `ROADMAP.md`'s "strict non-goals for the current phase" list is updated
  in the same change that introduces this feature, moving "protected-path
  enforcement against Git changes" into a new Phase 4 entry — required by
  `GOVERNANCE.md`, since a PR implementing a listed non-goal would
  otherwise be closed regardless of code quality.

## Reconsideration trigger

Revisit this decision if a future phase needs Git _write_ operations (this
feature is read-only), or needs to run in an environment where no `git`
binary is guaranteed to be present (at which point the "caller supplies
changed files explicitly" alternative above becomes worth building, rather
than staying a documented alternative).
