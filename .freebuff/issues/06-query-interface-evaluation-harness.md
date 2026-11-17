Part of [Phase 1: Repository Intelligence](https://github.com/AdamEddahmouni/agent-ready/blob/docs/vnext-phase-0/docs/vnext/PHASE-1-ISSUES.md).

**Depends on:** #38, #40, **and the protocol in #42**. **Blocks:** everything after Phase 1.

## Deliverable

`twin build` writes a snapshot to a path the user names; `twin query` answers bounded structural questions from the snapshot alone, never re-scanning the repository behind the caller's back. Then run the evaluation required by #42.

## Acceptance criteria

- [ ] Query answers are derived from the snapshot only.
- [ ] The evaluation is run with the protocol agreed in #42, unchanged, and published with its raw data.
- [ ] A null or negative result is a publishable outcome. The issue does not close because the model looked helpful.
- [ ] A recorded ADR exists before the commands ship, per [GOVERNANCE.md](https://github.com/AdamEddahmouni/agent-ready/blob/docs/vnext-phase-0/GOVERNANCE.md).

## Explicit non-goals

Agent orchestration, capability models, identity, and any agent invocation. This is a query surface over a snapshot, not a platform.
