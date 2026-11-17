# ADR-0049: Snapshot build and bounded twin query

## Status

Accepted

Builds on [ADR-0048](0048-discovery-snapshot-stability-and-conformance.md). Does not
change Discovery Snapshot Format 1 semantics.

## Decision

### `twin build`

- Runs the same pipeline as `discover --json`: `discoverRepository` → canonical JSON.
- Validates against `schemas/discovery/snapshot-v1.schema.json` before write.
- Writes **only** to `--output <path>`; creates parent directories; atomic replace via temp + rename.
- Refuses to overwrite unless `--force`.
- Does not add repository mutation beyond that explicit file.

### `twin query`

- Reads **only** the `--snapshot` file via `FileSystem.readTextFile`.
- Validates snapshot version and schema before answering.
- Fixed query kinds in `src/twin/queryEngine.ts`; parameters use Snapshot Format 1 identities (package path, `module:…` ids).
- Preserves epistemic facts (does not flatten incomplete/conflict to a single value).
- `--json` emits a **query result** object (`queryVersion: 1`), not a snapshot.
- `--limit` bounds list output; reports `truncated: true` when clipped.

### Non-goals

- No repository rescan, Git, network, or LLM interpretation.
- No evaluation orchestration in product code (research tooling lives under `research/phase1-benchmark/`).

## Consequences

- New CLI surface: `agent-ready twin build`, `agent-ready twin query`.
- Evaluation harness may consume snapshots and query results; benchmark execution remains gated on merged protocol v1 (#42).
