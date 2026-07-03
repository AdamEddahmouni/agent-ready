# ADR-0020: Instruction-source link analysis

## Status

Accepted.

## Context

ADR-0019 selects local architecture and documentation drift analysis as the
Phase 10 direction, but deliberately leaves the public surface and first checks
to a separate design decision.

The contract already identifies authoritative repository documentation through
`instructions.sources`. Those files are validated for existence, but links
inside them can silently drift as files move or are deleted. Broken local links
are objective repository evidence: they can be checked deterministically
without interpreting prose, adding schema fields, invoking Git, or calling an
AI model.

Broader checks—inferring architecture from prose, parsing programming-language
dependency graphs, or searching every Markdown file—introduce substantial
false-positive and configuration questions. They should not be bundled into the
first public drift-analysis surface.

## Decision

Add a read-only `agent-ready analyze` command. It runs the normal contract
pipeline, reads only the files explicitly listed in `instructions.sources`, and
checks inline Markdown links and reference-definition destinations that point
to repository-relative files or directories.

The analyzer ignores URI-scheme destinations, protocol-relative URLs,
root-relative URLs, and fragment/query-only destinations. It strips a local
destination's fragment and query before checking the filesystem. Lexical
traversal outside the repository is an error. Fenced and inline code are not
scanned. The parser intentionally implements only this bounded Markdown link
subset rather than becoming a general Markdown renderer.

The command adds four stable diagnostics:

- `DOCUMENTATION_SOURCE_READ_FAILED`
- `DOCUMENTATION_LINK_CHECK_FAILED`
- `DOCUMENTATION_LINK_BROKEN`
- `DOCUMENTATION_LINK_OUTSIDE_REPOSITORY`

Human output reports checked source/link counts. JSON output additionally
includes deterministic per-source counts and broken-link findings. Findings are
ordered by `instructions.sources` declaration order and then source position.

No contract-schema field is added. The command never writes, executes contract
commands, invokes Git, follows remote links, or silently repairs documentation.

## Consequences

- Repositories gain an immediately useful drift check using declarations they
  may already have.
- The first Phase 10 feature has a low false-positive policy and no migration
  cost for existing contracts.
- Markdown constructs outside the documented subset are deliberately ignored;
  this trades completeness for predictable behavior.
- Architecture dependency checks remain future Phase 10 work and require their
  own evidence and design decision.

## Reconsideration trigger

Revisit the parser boundary if real repositories need additional CommonMark
link forms, or if repeated architecture-drift cases establish a small,
language-neutral dependency rule worth adding to the contract.
