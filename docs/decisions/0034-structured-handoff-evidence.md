# ADR-0034: Structured handoff evidence

- Status: accepted
- Date: 2026-07-11

## Decision

`agent-ready verify --execute --handoff <path>` reads a bounded JSON object before any verification command runs. The closed shape requires `summary` (string), `filesChanged`, `commandsRun`, `assumptions`, and `knownIssues` (string arrays), and `requiresManualReview` (boolean). Internally the accepted value is versioned as `version: 1`. Summary is limited to 2,000 characters, each array entry to 500 characters, arrays to 100 entries, and the UTF-8 file to 64 KiB.

The file is validated even without `--record`; it is serialized into evidence only when recording is requested. Validation checks structure and limits, never whether a claim is true. Unknown fields are rejected.

## Consequences

Malformed or unreadable files produce `HANDOFF_FILE_INVALID`; oversized fields produce `HANDOFF_FIELD_TOO_LONG`. No contract `handoff` block, automatic authoring, diff inference, or generated summaries are introduced.
