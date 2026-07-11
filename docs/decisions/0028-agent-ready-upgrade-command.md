# ADR-0028: `agent-ready upgrade` safe contract modernization

## Status

Accepted. Implemented by `src/upgrade/upgrade.ts`,
`src/cli/commands/upgrade.ts`, CLI/action wiring, diagnostics, and unit tests.

## Context

Contracts created against early Agent-Ready releases remain schema version 1,
but newer tooling can recommend optional fields that improve protection,
generation, and documentation analysis. Maintainers need a reviewable way to
modernize those contracts without replacing hand-authored policy.

This is the third write pattern in the CLI. `generate --write` owns marked,
reproducible outputs; `init --write` creates a missing contract and refuses an
existing one. Upgrade edits an existing, hand-authored source-of-truth file, so
its safety boundary must be stricter than either.

## Decision

- Add `agent-ready upgrade [--config] [--json] [--write]`.
- Dry run is the default. It reports structured changes and a field-level diff.
- Only already-valid contracts are eligible. Upgrade is not a syntax or schema
  repair tool.
- Automatic transformations are additive and evidence-backed:
  - protect `.env*` when `.gitignore` already excludes environment files;
  - classify `node_modules/**`, `dist/**`, and `coverage/**` when declared
    package-manager/command evidence supports them;
  - declare `README.md` as an instruction source when it exists.
- Never delete a field, replace a maintainer-declared scalar, or add a path
  pattern that exactly conflicts with another path category.
- An old Node range is reported as `UPGRADE_MANUAL_REVIEW_REQUIRED`; it is not
  silently raised to Node 20.
- Render with the YAML document model so comments are preserved. Validate the
  complete proposal through schema and semantic validation before writing.
- `UPGRADE_NO_CHANGES_NEEDED` and `UPGRADE_MANUAL_REVIEW_REQUIRED` are warnings
  and exit successfully. `UPGRADE_WRITE_FAILED` is an internal-error exit.

## Alternatives considered

- **Rewrite from normalized JSON:** rejected because it discards comments,
  ordering, and author formatting.
- **Automatically update runtime ranges:** rejected because runtime support is
  project policy, not a mechanically inferable fact.
- **Apply changes by default:** rejected; an existing contract is
  hand-authored configuration and requires explicit write opt-in.
- **General migration scripting/plugin system:** rejected as premature. v0.4
  has a small, explicit registry of safe recommendations.

## Consequences

The CLI gains an in-place writer, but every proposed semantic change is shown
before opt-in and validated before disk mutation. YAML serialization may
normalize formatting around changed nodes; comments and all declarations are
retained. New migration rules require tests and must meet the same additive,
evidence-backed bar.

## Reconsideration trigger

Revisit when contract version 2 introduces required renames/removals, when
users need interactive conflict resolution, or when formatting preservation is
insufficient for real-world contracts.
