# ADR-0018: Versioned adapter output compatibility corpus

## Status

Accepted.

## Context

Agent-Ready now renders five agent-specific Markdown files. Golden tests protect
the reference implementation, but their old location and test-specific shape
did not give downstream implementations a published, stable compatibility
target. Phase 8 also made escaping behavior security-relevant, increasing the
cost of subtle renderer divergence.

## Decision

Publish a self-contained corpus in `compatibility/adapter-output/v1` and include
it in the npm package. Its JSON manifest maps input contracts and supporting
files to byte-exact expected outputs. The reference implementation runs the same
corpus in its normal test suite.

Existing inputs and expected bytes are immutable within a corpus version. New
non-conflicting cases may be added. Any intentional change to an existing
expectation creates a new corpus version and is documented in `CHANGELOG.md`.

The corpus is data, not a plugin API or a new runtime abstraction. It does not
execute contract commands and does not expand the trust boundary.

## Consequences

- Downstream implementations can verify renderer compatibility offline.
- Output changes become explicit review events rather than incidental fixture
  rewrites.
- Corpus files duplicate some examples and test fixtures so the published
  artifact remains self-contained.

## Reconsideration trigger

Revisit the manifest shape if a non-Markdown adapter needs structured or binary
expected output, or if multiple independent implementations demonstrate a need
for a reusable corpus runner.
