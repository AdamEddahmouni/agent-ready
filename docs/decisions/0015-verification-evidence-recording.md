# ADR-0015: Verification evidence recording

## Status

Accepted

## Context

[ADR-0014](0014-verification-execution.md) implemented `agent-ready verify
--execute`, but explicitly declined to persist its results anywhere:
`verify`'s per-command outcome exists only for the duration of one CLI
invocation, printed to stdout and discarded. That ADR's own
reconsideration trigger named the gap directly: "A future phase wants to
capture and persist command output as evidence (e.g. a completion
record)." `ROADMAP.md`'s pipeline diagram has also always shown
"verification evidence" as the step after execution, and the project's
own framing (`README.md`) is "define once, guide every agent, **verify
the work**" — a `verify --execute` result that vanishes the moment the
terminal scrolls past it does not yet let a contract author or a CI job
prove, after the fact, that verification actually happened.

This phase closes that gap with a narrow addition: `agent-ready verify
--execute --record` writes the run's structured result to a single JSON
file at the repository root.

This must not be confused with `ROADMAP.md`'s commercial-direction
category, "**Historical** verification-evidence retention" (multi-run
history, cross-repository dashboards, hosted storage). This phase
implements neither history nor aggregation: `--record` overwrites the
same file every time it runs, reflecting only the most recent invocation,
entirely local, with no account, service, or opt-out required to use it.
It is exactly as "local-first, open-source" as `generate --write` and
`verify --execute` before it.

It also must not reopen the question ADR-0014 deliberately avoided:
capturing a command's actual stdout/stderr as evidence, which could
contain secrets. This phase persists only the fields `verify --json`
already prints today — `id`, `run`, `status`, `exitCode`, `durationMs`,
plus the diagnostics array — never captured process output.

## Alternatives considered

- **Contract-configurable output path** (e.g. a new
  `verification.recordPath` schema field): rejected for v1. It would be
  the first case of contract content influencing a write destination,
  reopening a path-safety question (`GENERATE_OUTSIDE_REPO_ROOT`-style)
  that a hardcoded filename avoids by construction. It also requires a
  schema change, additional maintainer sign-off per `GOVERNANCE.md`, and
  there is no concrete need yet driving it. Noted as a reconsideration
  trigger below.
- **CLI-supplied output path** (`--record <path>`, caller-trusted like
  `check --against <ref>`): rejected for v1 for the same "no concrete
  need yet" reason — a plain `--record` boolean is the smallest mechanism
  that satisfies the current ask. Also a reconsideration trigger.
- **A `.agent-ready/` output directory**: rejected. `FileSystem.writeTextFile`
  deliberately has no `mkdir` capability (ADR-0010) — a subdirectory
  default would fail on every first run for every adopter. The evidence
  file is instead a flat, repo-root file
  (`agent-ready-verify-result.json`), consistent with where the existing
  adapter outputs (`AGENTS.md`, `CLAUDE.md`, etc.) already live.
- **Managed-file-marker protection, mirroring `generate --write`**:
  rejected. `generate`'s marker exists because `AGENTS.md`/`CLAUDE.md` are
  plausible filenames for content a user might hand-author, and silently
  destroying that would be a real harm. `agent-ready-verify-result.json`
  is not a plausible pre-existing hand-authored filename, and its content
  is inherently ephemeral, re-derivable, per-run data — closer to a
  coverage report or JUnit XML file than to a generated instructions
  file. `--record` therefore overwrites its target unconditionally, every
  run, with no `--force` flag and no `GENERATE_TARGET_UNMANAGED`-style
  refusal.
- **Allowing `--record` during a dry run**: rejected. A dry run's
  per-command status is `"planned"` for every command — nothing was
  actually verified, so persisting it as "evidence" would misrepresent
  what happened. `--record` therefore requires `--execute`; passing
  `--record` without `--execute` is a CLI usage error (`ExitCode.VALIDATION_FAILED`),
  handled the same way `generate.ts` rejects `--check` + `--write`
  together — an early, pre-`loadContract` return with a plain message,
  not a new `Diagnostic` code.
- **Adding `recordedAt` to the live `--json` stdout shape unconditionally**:
  rejected. It would be an additive, minor-version-safe change under
  ADR-0009, but there is no reason to touch the already-stable, tested
  `verify --json` output for invocations that never asked to record
  anything. `recordedAt` exists only inside the evidence file itself.

## Decision

- **New `--record` boolean flag on `agent-ready verify`**, requiring
  `--execute`. `VerifyArgs.record` (`src/cli/commands/verify.ts`).
- **Hardcoded output filename**, exported as
  `VERIFICATION_RECORD_FILENAME = "agent-ready-verify-result.json"`,
  joined against the already-verified `repoRoot` via `joinPath` — never
  contract-supplied, never a subdirectory.
- **Evidence file content**: the same `{ ok, contractPath, repoRoot,
mode, commands, diagnostics }` shape `verify --json` already produces,
  plus one new field, `recordedAt` (ISO-8601, from an injectable `now: ()
=> Date` parameter on `runVerify`, defaulting to `() => new Date()` in
  real CLI use and overridable in tests for determinism).
- **Unconditional overwrite.** No managed-file marker, no `--force` flag,
  no refusal path — every `--record` run replaces the file with the
  latest result.
- **Recording happens inside `finish()`**, the single funnel every
  `runVerify` return path already goes through, gated on `args.record &&
mode === "execute" && context.repoRoot !== undefined`. This naturally
  excludes contract-load failures (no `repoRoot` yet) and dry runs
  without additional branching, and naturally includes the
  zero-`verification.required`-commands case (`VERIFICATION_NOT_DECLARED`)
  — an honest "0 commands, nothing to verify" file is still written.
- **New diagnostic code, `VERIFICATION_RECORD_WRITE_FAILED`** (error),
  pushed if `fs.writeTextFile` throws. This flips the run's own `ok`/exit
  code, mirroring how `GENERATE_WRITE_FAILED` already behaves for
  `generate --write`. Maps to `ExitCode.INTERNAL_ERROR` (10), the same
  bucket as `GENERATE_WRITE_FAILED`/`GENERATE_OUTSIDE_REPO_ROOT` — a
  write failure is an environment problem, not "your contract is wrong."
- **No new exit-code value.** Per ADR-0009, the 5-value scheme stays
  stable.
- **CLI output gains `recordedTo: <absolutePath>`** (in `--json`) and a
  matching human-output line, only when a record was actually written —
  independent of whether `--json` was also passed.

## Consequences

- `agent-ready verify --execute --record` gives a contract author or a CI
  job a durable, local, structured artifact proving verification ran and
  what happened — closing the exact gap ADR-0014 named in its own
  reconsideration trigger.
- `FileSystem.writeTextFile` now has two call sites (`generate --write`
  and `verify --execute --record`) instead of one; its doc-comment in
  `src/filesystem/types.ts` is updated accordingly. It remains the
  interface's only write method — no `mkdir`/`unlink`/`chmod` was added.
- `agent-ready check`'s protected-path enforcement is unaffected: nothing
  about this phase changes what `check` reads or how `paths.protected`/
  `paths.generated` behave. A contract author who commits the evidence
  file may choose to list it under `paths.generated`, but Agent-Ready
  does not require or assume this.
- This repository's own `.gitignore` now excludes
  `agent-ready-verify-result.json`, the same treatment as `dist/`/`coverage/`.
- `ROADMAP.md`'s strict non-goals list is narrowed: "capturing or
  persisting command **output** as evidence" (raw stdout/stderr) remains
  out of scope; capturing and persisting the already-non-sensitive
  structured **status** fields `verify --json` already exposes is now
  implemented.

## Reconsideration trigger

Revisit this decision if:

- A concrete need emerges for a configurable output path — either
  contract-declared (`verification.recordPath`, a schema change) or
  CLI-supplied (`--record <path>`, no schema change, caller-trusted like
  `--against`).
- A concrete need emerges for retaining more than the single most-recent
  run's evidence (history, append-only logs, multiple named runs) — at
  that point, revisit whether this still belongs in the open-source local
  tool or is better served by the commercial "historical
  verification-evidence retention" category `ROADMAP.md` already reserves
  for centralized infrastructure.
- A future phase wants a public JSON Schema for the evidence file's own
  shape (today it is documented only as "the same shape as `verify
--json`, plus `recordedAt`," with no independent schema or
  compatibility guarantee beyond ADR-0009's existing `--json`-output
  policy).
