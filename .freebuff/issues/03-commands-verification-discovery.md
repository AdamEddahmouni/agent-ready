Part of [Phase 1: Repository Intelligence](https://github.com/AdamEddahmouni/agent-ready/blob/docs/vnext-phase-0/docs/vnext/PHASE-1-ISSUES.md).

**Depends on:** #37. **Blocks:** #39, #41.

## Deliverable

Declared commands, test entry points, and the build, lint, and typecheck commands a contributor would actually run — plus which verification surface already exists.

## Acceptance criteria

- [ ] Commands are reported with the package that declares them.
- [ ] A test command is distinguished from a build command, and a script that runs neither is not silently reported as either.
- [ ] The output answers "how do I verify this?" for a package without asking a human.
- [ ] Heuristics that cannot be made accurate enough to be trustworthy are removed rather than shipped with a confidence disclaimer.
- [ ] A recorded ADR exists before the fields ship, per [GOVERNANCE.md](https://github.com/AdamEddahmouni/agent-ready/blob/docs/vnext-phase-0/GOVERNANCE.md).

## Explicit non-goals

The module/dependency graph (#39). No embedding, no LLM analysis, no telemetry, no agent invocation.
