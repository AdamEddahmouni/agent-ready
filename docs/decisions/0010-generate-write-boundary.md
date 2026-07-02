# ADR-0010: Write boundary for `agent-ready generate`

## Status

Accepted

## Context

Through Phase 0/1, `FileSystem` (`src/filesystem/types.ts`) was
read-only, and `README.md`, `docs/specification/cli-reference.md`, and
`docs/security/threat-model.md` all asserted that Agent-Ready never
writes to the repository it inspects. Phase 2 (`agent-ready generate`,
compiling the normalized contract into `AGENTS.md`/`CLAUDE.md`)
necessarily breaks that invariant — this is the project's first write
capability. That claim needs to be narrowed, not silently dropped, and
the write path needs its own explicit safety design so it doesn't erode
the project's "no unrequested destructive action" posture the same way
ADR-0006 treats command execution as a deliberate, load-bearing boundary
rather than an incremental feature to fill in.

## Alternatives considered

- **General write surface**: add `writeFile`, `mkdir`, `unlink` to
  `FileSystem`, letting future adapters do whatever they need.
- **Narrow, single-purpose write method**: add exactly one
  `writeTextFile(absolutePath, content)` method, with no directory
  creation or deletion capability anywhere.
- **Write-on-by-default vs. opt-in**: should `agent-ready generate`
  write immediately, matching how `validate`/`inspect` run without extra
  flags, or default to a dry run?
- **Overwrite policy**: always overwrite an existing target silently
  (simplest), always refuse an existing target (safest but annoying on
  every re-run), or distinguish "we generated this before" from
  "something else is here."

## Decision

- **Exactly one new `FileSystem` method: `writeTextFile`.** No `mkdir`,
  `unlink`, or `chmod` anywhere in the codebase. `AGENTS.md`/`CLAUDE.md`
  are always repository-root files, and the repository root is already
  known to exist (it's where the contract was discovered), so directory
  creation is never needed. This keeps the write surface exactly as wide
  as the one feature that needs it, not a general-purpose file-management
  API. `NodeFileSystem.writeTextFile` wraps `node:fs/promises.writeFile`
  with the same `FileSystemError` pattern the other methods already use;
  `InMemoryFileSystem.writeTextFile` sets into the existing in-memory
  `files` map, so tests exercise the same interface without touching
  disk.
- **`generate` defaults to a dry run.** Running `agent-ready generate`
  with no flags never writes anything — it only reports what would be
  generated. Writing requires the explicit `--write` flag. This mirrors
  tools like `prettier --check`/`eslint --fix` rather than `validate`/
  `inspect`, which are read-only regardless of flags, precisely because
  `generate` is the one command capable of mutating the repository.
- **A managed-file marker distinguishes generated content from
  hand-authored content.** Every file Agent-Ready generates begins with
  a machine-checkable HTML comment banner
  (`src/generate/marker.ts`). `--write` refuses to overwrite an existing
  target that lacks this marker (`GENERATE_TARGET_UNMANAGED`, a
  `VALIDATION_FAILED`-class error) unless `--force` is also passed. A
  target that already carries the marker is freely overwritten —
  re-running `--write` is idempotent and doesn't require `--force` on
  every invocation.
- **`--check` is read-only and reuses `VALIDATION_FAILED`.** For CI, a
  drift check should never write; `--check` and `--write` together are
  rejected up front, before the contract pipeline even runs, with a
  plain usage message (not a `Diagnostic`) — this is caught by
  `runGenerate` itself (not commander's `program.error`), keeping the
  command's zero-direct-I/O `CliOutcome` pattern (see
  `src/cli/commands/validate.ts`) intact rather than introducing a
  process-exiting side channel used nowhere else in the CLI.
- **No new `ExitCode` value.** Per ADR-0009's pre-1.0 stability policy,
  the 5-value exit-code scheme is treated as stable. `GENERATE_TARGET_UNMANAGED`
  and `--check` drift map to the existing `VALIDATION_FAILED` (1) —
  user-actionable, "fix your repo state" conditions. `GENERATE_WRITE_FAILED`
  and `GENERATE_OUTSIDE_REPO_ROOT` join the existing `INTERNAL_ERROR` (10)
  branch, alongside `INTERNAL_INVARIANT_VIOLATION`.
- **Output paths are always adapter-hardcoded, never contract-supplied.**
  `planGeneration` (`src/generate/generate.ts`) joins a fixed filename
  per adapter (`AGENTS.md`, `CLAUDE.md`) against the already-verified
  `repoRoot`, then re-checks the joined path still resolves inside
  `repoRoot` before it is ever used (`GENERATE_OUTSIDE_REPO_ROOT`) — this
  is defense in depth, expected unreachable in practice, since nothing in
  the contract can influence the output filename.

## Consequences

- `validate` and `inspect` remain provably read-only: `writeTextFile` is
  never called from either command's code path, and grepping for
  `writeTextFile` call sites is a straightforward audit for "does
  anything write."
- A user who runs `agent-ready generate --write` twice in a row without
  touching the generated files sees no diagnostics and no changes the
  second time — writes are genuinely idempotent, not just permitted to
  overwrite.
- A user with a hand-written `AGENTS.md` predating Agent-Ready adoption
  is protected by default: `--write` fails loudly with a clear
  remediation (`--force`) instead of silently discarding their content.
- Symlink write-through is not specially defended against (see
  `docs/security/threat-model.md`) — consistent with this project's
  existing discovery-time symlink policy, and low-risk here specifically
  because output filenames are never contract-supplied.

## Reconsideration trigger

Revisit this decision if a future adapter needs to write more than one
flat file per adapter (e.g. a directory of Cursor rule files), since the
current design assumes "one adapter, one file, no directories."
