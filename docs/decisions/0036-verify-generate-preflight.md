# ADR-0036: Generated-file drift preflight for verify

- Status: accepted
- Date: 2026-07-11

## Decision

`agent-ready verify --execute --check-generate` runs the same read-only domain check as `agent-ready generate --check` before the first declared repository command. Enabled adapters determine the checked files. Missing, unmanaged, or stale output fails with `GENERATED_FILES_OUT_OF_DATE`, executes zero repository commands, and records an explicit `generatePreflight` object when requested.

The preflight is not represented as a user-declared command. The implementation calls shared domain logic and never invokes the CLI recursively. For v0.6.0 this option is CLI-only; the composite Action does not add a parity input.
