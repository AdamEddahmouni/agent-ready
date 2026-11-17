# ADR-0050: Retire the unmerged v0.7 analysis roadmap (ADR-0037–0039)

- **Status:** Accepted
- **Date:** 2026-11-17
- **Supersedes:** ADR-0037, ADR-0038, ADR-0039 (accepted only on an unmerged branch)
- **Related:** ADR-0041, ADR-0042, ADR-0043, ADR-0044, ADR-0047

## Context

Before the vNext design phase, a second roadmap was developed on
`agent/brain-integration-and-adr-0037` and opened as PR #29: an "Agentic
Development Brain" session protocol, ADR-0037 (architecture dependency
analysis), ADR-0038 (multi-language runtime probing in `doctor`), ADR-0039
(external adapter registration), v0.7 framework-specific examples, and renderer
spacing fixes. It was rebased onto `main` in July 2026 and has since been
conflicted; it has never merged.

The vNext phase replaced that roadmap. ADR-0041 scoped the next surface as
repository discovery; ADR-0042 froze the v1 contract and CLI; ADR-0043
quarantined integrations outside the deterministic core; ADR-0044 through
ADR-0049 defined the discovery model, the package/command/graph semantics, and
the snapshot and query surfaces. In that design, dependency and language facts
are discovery facts with provenance, not separate analysis commands.

Two roadmaps cannot both be current. The repository currently lists no ADR
between 0036 and 0040, which is the visible symptom: readers cannot tell whether
0037–0039 were rejected, lost, or pending.

## Decision

1. **ADR-0037 is superseded** by ADR-0044 and ADR-0047. Dependency edges and
   scope classification are discovery facts carried with provenance in the
   snapshot; no separate architecture-dependency analysis command is planned.
2. **ADR-0038 is deferred, not adopted.** Runtime probing of other languages is
   out of scope for the deterministic core while discovery is JavaScript
   ecosystem first. If it returns, it returns as a discovery fact source under
   ADR-0044's fact boundary, with its own ADR in the current sequence.
3. **ADR-0039 is superseded** by ADR-0043. External adapter registration would
   place third-party code inside the deterministic core; integrations stay
   quarantined.
4. **PR #29 is closed unmerged.** Its branch is retained as history. The
   framework-specific examples (Python, Rust, Go) and the renderer spacing fixes
   are orthogonal to the ADRs and may be salvaged later as a separate,
   docs-only change; nothing in this decision blocks that.
5. **ADR numbers 0037–0039 are retired and are not reused.** The next decision
   in the current sequence is this one, 0050.
6. The Agentic Development Brain session protocol is not adopted as project
   process; the repository's `AGENTS.md` and governance documents remain the
   source of contributor process.

## Consequences

- `docs/decisions/README.md` records the retirement so the gap is legible.
- No code, schema, or CLI surface changes: the affected work was never merged.
- Contributors must not cite ADR-0037–0039 as current decisions.
- The vNext discovery work is the only active roadmap.

## Reconsideration trigger

Revisit if a maintainer needs dependency or runtime facts that discovery cannot
express with provenance, or if a third-party adapter model arrives with a
security boundary that ADR-0043's quarantine cannot accommodate. Either case
requires a new ADR, not a revival of 0037–0039.
