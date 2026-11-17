Part of [Phase 1: Repository Intelligence](https://github.com/AdamEddahmouni/agent-ready/blob/docs/vnext-phase-0/docs/vnext/PHASE-1-ISSUES.md).

**Depends on:** #37, #38. **Blocks:** #40.

## Deliverable

Internal module edges derived from imports and resolved to packages; dependency edges from manifests and the lockfile, distinguishing declared from resolved versions; ownership edges from `CODEOWNERS` with an explicit "unowned" state rather than a guess.

## Design constraint

Every node and edge carries the provenance of the fact it encodes. If a fact cannot be traced to a file and a line, it does not enter the graph. Missing ownership must be representable and reported as missing.

## Acceptance criteria

- [ ] Every edge reports its source file, and the source is verifiable.
- [ ] A graph built from this repository demonstrably has a defect, and the defect is either fixed or documented as a known limitation.
- [ ] Import resolution failures are surfaced, not swallowed.
- [ ] A recorded ADR exists before the fields ship, per [GOVERNANCE.md](https://github.com/AdamEddahmouni/agent-ready/blob/docs/vnext-phase-0/GOVERNANCE.md).

## Explicit non-goals

A stored graph database or System Twin persistence. The snapshot is emitted, not persisted, until #41 says otherwise.
