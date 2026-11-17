Part of [Phase 1: Repository Intelligence](https://github.com/AdamEddahmouni/agent-ready/blob/docs/vnext-phase-0/docs/vnext/PHASE-1-ISSUES.md).

**Depends on:** nothing, and must be agreed **before** #41 runs. **Blocks:** #41.

## Why this issue exists

This is the easiest issue to defer and the one that most determines whether Phase 1 produces an answer or a feature. Agreeing the protocol after the model exists invites metrics chosen because they flatter it. It is filed first-in-time and last-in-sequence for exactly that reason.

## Deliverable

A written, published protocol for comparing:

```text
raw filesystem + shell
vs.
Agent-Ready repository model
```

on the same tasks, with the same model, in the same environment.

## Metrics

- task success
- unnecessary file reads
- tool calls
- tokens
- invalid assumptions (statements about the repository that turn out false)
- incorrect dependency reasoning
- verification selection (did it run the right checks)
- time to first correct modification

## Protocol requirements

- [ ] A fixed, public task set over a fixed set of public TypeScript/Node repositories.
- [ ] The model, agent configuration, and task set are held constant across both conditions. If they cannot be held constant, that is reported as a limitation on the result rather than papered over.
- [ ] Multiple runs per condition, with variance reported rather than a single best-of.
- [ ] Raw data published, not only a conclusion.
- [ ] A pre-declared decision rule: what result counts as "the model helps", stated before the run.

## Acceptance criteria

- [ ] The protocol is merged and immutable before the first evaluation run.
- [ ] Any later change to it is a new protocol version, with the original results kept.
- [ ] Null results are publishable and expected.
