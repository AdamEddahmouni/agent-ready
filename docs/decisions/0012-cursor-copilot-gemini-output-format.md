# ADR-0012: Cursor, Copilot, and Gemini adapter output format

## Status

Accepted

## Context

`AdapterName` (`src/contract/types.ts`) and the JSON Schema
(`schemas/v1/agent-ready.schema.json`) have declared `cursor`, `copilot`, and
`gemini` since Phase 2, but enabling them only produced an
`ADAPTER_NOT_YET_IMPLEMENTED` warning — no renderer existed. This phase adds
real renderers for all three, following the pure-function/plain-registry
pattern established in [ADR-0011](0011-adapter-rendering-design.md).

Each of these three tools has its own real-world instruction-file
convention, and those conventions aren't uniform:

- **Cursor** has two conventions in active use: a legacy single flat file
  (`.cursorrules` at the repository root) and a newer directory of files
  (`.cursor/rules/*.mdc`).
- **GitHub Copilot** reads a single file, but not at the repository root:
  `.github/copilot-instructions.md`.
- **Gemini** has no strong, widely-adopted official convention; common
  informal practice is a root-level `GEMINI.md`, directly analogous to
  `CLAUDE.md`/`AGENTS.md`.

[ADR-0010](0010-generate-write-boundary.md) built `agent-ready generate`
around a narrow assumption: one adapter produces exactly one flat file,
always at the repository root, written via the single `FileSystem.writeTextFile`
method (no `mkdir`, no directory creation, ever). That ADR's own
reconsideration trigger names the directory-of-Cursor-rule-files case
verbatim as the point where that assumption should be revisited.

## Alternatives considered

- **Implement `.cursor/rules/*.mdc` (directory-based) for Cursor.** This is
  the more modern, more actively documented Cursor convention.
- **Add a Copilot-scoped `mkdir`-if-missing capability** to `FileSystem`, so
  `.github/copilot-instructions.md` can be written even when `.github/`
  doesn't exist yet.
- **Flat single files only for all three adapters**, accepting that Cursor's
  output uses the older `.cursorrules` convention rather than the directory
  form, and that Copilot's write simply fails loudly (via the existing
  `GENERATE_WRITE_FAILED` diagnostic) in the rare case `.github/` doesn't
  already exist.

## Decision

**Flat single files only, no new `FileSystem` capability:**

| Adapter   | Output path                       |
| --------- | --------------------------------- |
| `cursor`  | `.cursorrules` (repository root)  |
| `copilot` | `.github/copilot-instructions.md` |
| `gemini`  | `GEMINI.md` (repository root)     |

- **Cursor renders `.cursorrules`, not `.cursor/rules/*.mdc`.** Building the
  directory-based form now would require: a new `FileSystem` directory-creation
  method (explicitly rejected in ADR-0010 as widening the write surface
  beyond "exactly as wide as the one feature that needs it"); changing
  `AdapterRenderer`'s signature from `(contract) => GeneratedFile` to
  something returning multiple files (contradicting ADR-0011's decision,
  which is itself scoped to "one shared section-renderer, one plain
  registry" until an adapter needs more than one output file); and new
  per-file marker/status semantics in place of the current single-string
  `hasManagedMarker` check. That is a second, larger redesign of
  `src/generate/types.ts`, `generate.ts`, and `marker.ts` together — out of
  scope for a phase whose stated goal is closing the gap between already-declared
  adapter names and existing renderer infrastructure, not rebuilding that
  infrastructure.
- **Copilot's `.github/copilot-instructions.md` needs no new `FileSystem`
  method.** It is still exactly one file. `writeTextFile` already succeeds
  whenever the parent directory exists, which is true for essentially every
  real target repository already using CI (including this one). When
  `.github/` is genuinely absent, the write fails with `ENOENT`, which
  `cli/commands/generate.ts`'s existing write-failure handling already
  surfaces as `GENERATE_WRITE_FAILED` — a diagnostic and remediation path
  that already exists and needed no new code, only a new test case
  confirming the behavior. A Copilot-specific `mkdir`-if-missing helper was
  rejected for the same reason a general one was rejected in ADR-0010: it
  widens a deliberately narrow write surface for a rare case that already
  fails loudly and actionably rather than silently.
- **Gemini renders `GEMINI.md`**, structurally identical to `AGENTS.md`/`CLAUDE.md`,
  since no competing official convention exists to weigh against it.

## Consequences

- All three new adapters reuse the entire existing generation pipeline
  unchanged: `AdapterRenderer`, `RendererRegistry`, `planGeneration`,
  `resolvePlannedOutputs`, the managed-file marker, and `--check`/`--write`/`--force`
  semantics. This is genuinely additive, exactly as ADR-0011 anticipated.
- A Cursor user relying on the newer `.cursor/rules/*.mdc` directory
  convention will not see Agent-Ready populate it; only `.cursorrules` is
  generated. This is a known, documented limitation, not an oversight.
- A repository with no `.github/` directory at all will see `generate --write`
  fail on the `copilot` adapter with `GENERATE_WRITE_FAILED` rather than
  silently creating the directory. The remediation is to create `.github/`
  (or disable the `copilot` adapter) — consistent with every other
  `GENERATE_WRITE_FAILED` case.

## Reconsideration trigger

Revisit the Cursor decision specifically if `.cursor/rules/*.mdc` becomes
load-bearing enough (e.g. Cursor deprecates `.cursorrules` entirely) to
justify the multi-file adapter redesign described in ADR-0010's and
ADR-0011's own reconsideration triggers. Revisit the Copilot decision only if
`.github/`-missing turns out to be common enough in practice that a loud
failure is worse UX than silent directory creation — no evidence of that as
of this phase.
