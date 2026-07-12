# Evidence and verification model

`agent-ready verify --execute` runs `verification.required` in order and reports
`passed`, `failed`, `timed-out`, `spawn-failed`, or `skipped`. Each report records
the resolved `timeoutSeconds`; `--record` writes the result and timestamp to
`agent-ready-verify-result.json` in the repository root.

This evidence proves which declared command ran and its process outcome. It does
not prove correctness and never captures stdout or stderr.

## Structured handoff

`verify --execute --handoff <path>` validates a JSON file before any repository
command runs. The closed object requires:

- `summary`: string, at most 2,000 characters;
- `filesChanged`, `commandsRun`, `assumptions`, and `knownIssues`: arrays of at
  most 100 strings, each at most 500 characters;
- `requiresManualReview`: boolean.

The UTF-8 file is capped at 64 KiB. Validation happens even without `--record`.
When recording is enabled, the value is stored as `handoff` with internal
`version: 1`. Agent-Ready checks structure and limits, never whether claims are
true. See [ADR-0034](../decisions/0034-structured-handoff-evidence.md).

## Generated-file preflight

`verify --execute --check-generate` applies the same drift calculation as
`generate --check` before executing any declared command. Drift causes every
declared command to be skipped. Recorded evidence contains a separate
`generatePreflight` result; it is not presented as a declared command. See
[ADR-0036](../decisions/0036-verify-generate-preflight.md).

## Non-goals

- Proving code or handoff claims correct.
- Capturing command stdout or stderr.
- Inferring a handoff from Git changes.
- Multi-run history or hosted evidence retention.
