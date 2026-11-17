Part of [Phase 1: Repository Intelligence](https://github.com/AdamEddahmouni/agent-ready/blob/docs/vnext-phase-0/docs/vnext/PHASE-1-ISSUES.md).

**Depends on:** #36. **Blocks:** #38, #39.

## Deliverable

Package boundaries, workspace roots, and the package manager, derived from the workspace configuration and the manifests themselves.

## Acceptance criteria

- [ ] A pnpm workspace monorepo, an npm workspace monorepo, and a single-package repository are each classified correctly.
- [ ] Package identity comes from the manifest, not from directory naming convention.
- [ ] Internal versus external dependency is distinguishable at this stage, even though the full graph is #39.
- [ ] An unrecognized workspace layout is reported as unrecognized, not coerced into a shape that happens to fit.
- [ ] A recorded ADR exists before the fields ship, per [GOVERNANCE.md](https://github.com/AdamEddahmouni/agent-ready/blob/docs/vnext-phase-0/GOVERNANCE.md).

## Explicit non-goals

Full module/dependency graph (#39). Commands and verification (#38). No embeddings, no LLM analysis, no telemetry, no Twin persistence, no orchestration, no monorepo restructuring.
