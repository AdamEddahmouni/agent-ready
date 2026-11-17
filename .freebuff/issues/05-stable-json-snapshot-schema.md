Part of [Phase 1: Repository Intelligence](https://github.com/AdamEddahmouni/agent-ready/blob/docs/vnext-phase-0/docs/vnext/PHASE-1-ISSUES.md).

**Depends on:** #39. **Blocks:** #41.

## Deliverable

The snapshot format versioned independently of the `agent-ready.yaml` contract, per the version-taxonomy rule in [ADR-0040](https://github.com/AdamEddahmouni/agent-ready/blob/docs/vnext-phase-0/docs/decisions/0040-release-and-version-taxonomy.md), with a small conformance corpus.

## Acceptance criteria

- [ ] A published statement of which snapshot fields a consumer may rely on in the first release and which are provisional.
- [ ] A conformance corpus of representative repositories with their expected output, **including the known-inaccurate cases**, so heuristic regressions are detectable.
- [ ] The stability statement is written before any external consumer depends on the format, and is specific enough to fail a future change.
- [ ] A recorded ADR exists before the format ships, per [GOVERNANCE.md](https://github.com/AdamEddahmouni/agent-ready/blob/docs/vnext-phase-0/GOVERNANCE.md).

## Explicit non-goals

Do not let this format leak into the frozen v1 `agent-ready.yaml` contract. The two are versioned separately by design.
