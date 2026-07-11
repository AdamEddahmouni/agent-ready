# ADR-0031: Instruction-source analysis size cap

## Status

Accepted. Implemented in `src/analyze/analyzeDocumentation.ts` with a 5 MB
per-source limit, pre-read file-size inspection, diagnostic
`INSTRUCTION_SOURCE_TOO_LARGE`, and boundary tests.

## Context

`agent-ready analyze` reads every explicitly declared instruction source into
memory to find Markdown links. The number of sources is contract-bounded, but a
single accidentally generated or adversarial file could still consume
unbounded memory. Checking size after reading would not mitigate that risk.

## Decision

- Extend `FileStat` with `sizeBytes` for real and in-memory filesystems.
- Before reading each source, inspect its metadata and reject regular files
  larger than 5,000,000 bytes.
- Accept a source exactly at the limit.
- Emit `INSTRUCTION_SOURCE_TOO_LARGE` with actual and maximum byte counts and
  continue analyzing other declared sources.
- Keep the limit per source rather than aggregate; each diagnostic identifies
  the specific declaration that needs splitting.

## Alternatives considered

- **Check `text.length` after read:** rejected because memory has already been
  allocated and UTF-16 code-unit length is not file byte size.
- **Aggregate cap only:** rejected because one file can still monopolize the
  budget and remediation becomes less precise.
- **Streaming Markdown parser:** deferred; the current parser is small and
  deterministic, and a pre-read cap closes the practical risk.

## Consequences

Analysis now performs one metadata lookup before each source read. Very large
documentation must be split into focused sources. The filesystem abstraction
exposes byte size as generally useful metadata without adding new read methods.

## Reconsideration trigger

Revisit if real documentation commonly exceeds 5 MB or if link extraction is
replaced with a bounded streaming parser.
