# ADR-0008: Diagnostic shape, error codes, and exit-code mapping

## Status

Accepted

## Context

Every pipeline stage (parsing, schema validation, semantic validation,
normalization) needs to report failures in a way that is stable for CI
consumers, useful for humans, and independent of how the CLI happens to
render it.

## Alternatives considered

- Throw plain `Error` objects with string messages (simple, but message
  text is not a stable contract, and CI scripts would have to parse
  prose).
- A flat list of error strings per stage (loses structure like severity,
  field, and remediation).
- A structured `Diagnostic` type produced by every stage, rendered by
  separate human/JSON renderers.
- One process exit code per diagnostic code (maximally granular) vs. a
  small, coarse set of exit-code categories.

## Decision

- **A single structured `Diagnostic` shape** (see `src/diagnostics/types.ts`)
  used by every stage: `code` (stable, from a fixed registry), `severity`
  (`error`/`warning`), `summary`, optional `detail`, `field` (JSON
  Pointer into the contract), `sourcePath`, `location` (line/column when
  available), `remediation`, `related`, and `metadata`. Stages return
  `DiagnosticResult<T>` (`{ ok: true, value, diagnostics }` or
  `{ ok: false, diagnostics }`) rather than throwing for expected,
  user-facing failures. Exceptions are reserved for genuinely unexpected
  internal errors (see `INTERNAL_INVARIANT_VIOLATION` below).
- **A fixed, documented registry of diagnostic codes**
  (`src/diagnostics/codes.ts`, mirrored in
  `docs/specification/diagnostics.md`) — the exact set required by the
  project brief, plus none invented beyond it. Codes are stable identifiers
  independent of human message wording, suitable for CI `if` conditions.
- **Schema-validation errors are mapped from generic ajv output to
  friendlier, field-specific codes** based on the ajv error's
  `instancePath` (e.g. anything under `/environment/runtimes` becomes
  `RUNTIME_DECLARATION_INVALID` rather than a generic
  `CONTRACT_SCHEMA_INVALID`). This reuses ajv's mature validation engine
  while still giving CI consumers a stable, domain-specific code to match
  on, rather than forcing them to parse ajv's own `schemaPath`/`keyword`
  fields. Anything not covered by a specific mapping falls back to
  `CONTRACT_SCHEMA_INVALID`.
- **Rendering is a separate concern from diagnostic construction.**
  `renderDiagnosticsHuman` produces intentionally-designed, concise text
  (not a raw object dump); `renderDiagnosticsJson` produces a stable,
  serializable shape. Neither stage constructs diagnostics itself — they
  only format an already-complete list.
- **Exit codes are coarse (5 values), not one-per-diagnostic-code:**

  | Exit code | Meaning                                      |
  | --------- | -------------------------------------------- |
  | 0         | Success                                      |
  | 1         | Validation failed (schema or semantic error) |
  | 2         | Contract not found or unreadable             |
  | 3         | Unsupported contract version                 |
  | 10        | Internal Agent-Ready failure                 |

  `resolveExitCode` picks the most specific/severe category when
  diagnostics span more than one (precedence: internal error > not-found

  > unsupported-version > validation-failed), so a single run always
  > yields exactly one exit code. This keeps shell scripting against exit
  > codes simple, while the JSON diagnostic list still gives full granularity
  > for anything that needs it.

- **No stack traces for expected user mistakes.** Only
  `INTERNAL_INVARIANT_VIOLATION` (an assertion the codebase itself
  believed could never fail) includes the underlying error's message, and
  even then not a raw stack trace in the diagnostic text — the intent is
  "please report this as a bug," not exposing internals.

## Consequences

- CI pipelines can reliably branch on exit code for coarse routing, and on
  `--json` diagnostic `code` fields for fine-grained handling, without
  ever needing to match on human-readable text.
- Every diagnostic-producing code path was authored to point at
  `docs/specification/diagnostics.md` for remediation guidance.

## Reconsideration trigger

If a consumer demonstrates a real need for per-code exit codes (e.g. a
CI system that cannot parse JSON output at all), reconsider a richer exit
code scheme then, rather than speculatively now.
