# ADR-0032: `architecture` contract block

## Status

Accepted for v0.5.0; not implemented

## Context

The contract can declare commands, environments, path rules, and narrative
instructions, but it cannot expose a maintainable, structured summary of a
repository's architecture to every generated agent-instruction file. Free-form
`instructions.content` remains useful for prose, but cannot validate decision
links or distinguish durable invariants from incidental notes.

## Decision

Add an optional, additive `architecture` block within contract `version: 1`:

```yaml
architecture:
  boundaries:
    - "src/contract/ must not import from src/cli/"
  invariants:
    - "All pipeline stages return DiagnosticResult<T>."
  key_decisions:
    - file: docs/decisions/0001-runtime-and-distribution.md
      summary: ESM-only package; Node.js 20 or newer.
```

- `boundaries` and `invariants` are optional arrays of 1–500-character,
  non-empty strings. They are declarative guidance in v0.5.0, not executable
  policy.
- `key_decisions` is an optional array of `{ file, summary }` objects.
  `file` is a safe, repository-relative Markdown path; `summary` is a
  1–300-character, non-empty string.
- The normalizer preserves declared order for all three lists, because their
  order communicates emphasis. It normalizes only the decision-file paths.
- Semantic validation rejects duplicate decision files and validates their
  path form. `agent-ready analyze` verifies that each decision file exists and
  is Markdown.
- All five adapters render an `## Architecture` section: boundaries as
  "Must not" bullets, invariants as "Always" bullets, and decision links with
  escaped summaries. The section is omitted when the block is absent.
- User-authored strings are passed through `escapeMarkdownText`; only the
  decision file path is rendered as a link target after path validation.

## Alternatives considered

- **Rely only on `instructions.content`:** rejected because structured
  decision links and invariant categories would remain unvalidated.
- **Make boundaries executable in v0.5.0:** rejected. Import-graph analysis
  belongs to the later, separately scoped v0.7.0 work; free-form guidance must
  not be misrepresented as enforcement.
- **Require the block:** rejected. Existing `version: 1` contracts must remain
  valid and produce unchanged output when no new block is present.

## Consequences

Implementation must update the JSON Schema, raw and normalized types,
normalization, semantic analysis, shared adapter rendering, every adapter
fixture, the compatibility corpus, and documentation. It must prove that a
contract without `architecture` yields byte-identical v0.4.0 adapter output.

## Reconsideration trigger

Revisit the `boundaries` syntax when v0.7.0 introduces import-graph analysis;
that work may add a separately structured, machine-readable boundary form
rather than overloading human guidance strings.
