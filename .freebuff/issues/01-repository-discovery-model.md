Part of [Phase 1: Repository Intelligence](https://github.com/AdamEddahmouni/agent-ready/blob/docs/vnext-phase-0/docs/vnext/PHASE-1-ISSUES.md).

**Depends on:** nothing. **Blocks:** #37.

## Why this is the first issue

Phase 1 is defined by one falsifiable thesis:

> Can Agent-Ready construct a useful, deterministic machine model of an arbitrary TypeScript/Node repository without requiring the maintainer to manually describe that repository?

If the answer is no, the project should learn that before building anything on top of the model. The cost of finding out late is the entire control plane. This is the narrowest executable slice of that question, and it must produce value on an arbitrary repository before anyone is asked to adopt anything.

## Deliverable

`agent-ready discover --json` emitting a deterministic snapshot. Initially: repository identity, languages/runtime, package manager, and the presence or absence of a declaration surface. No guessing beyond what is directly readable.

## Decisions this issue must record in its ADR

[GOVERNANCE.md](https://github.com/AdamEddahmouni/agent-ready/blob/docs/vnext-phase-0/GOVERNANCE.md) requires an ADR before adding a command, schema field, or diagnostic code. The ADR comes first.

- What the repository model is, in the smallest form that is still useful.
- Which fields are **declared** (present in a file such as `package.json`, `CODEOWNERS`, or CI configuration) versus **derived** (determined deterministically from repository content), and how a snapshot marks the difference. Never conflate them.
- Whether an existing `agent-ready.yaml` may contribute facts, and if so, whether those facts are declared or merely author-declared.
- The false-positive policy: a snapshot confidently wrong about a repository is worse than one reporting "unknown".
- CLI surface and diagnostic-code implications, including the reserved-code policy used by earlier commands.

## Non-goals

Packages, workspaces, commands, graphs. No writing. No network.

## Acceptance criteria

- [ ] Runs read-only with networking disabled, on a repository with no `agent-ready.yaml`, and says clearly that no contract was found.
- [ ] Running it twice on an unchanged repository produces byte-identical output.
- [ ] Every field is traceable to a file and line, or is explicitly marked unknown.
- [ ] "Found nothing", "partially discovered", and "could not determine" produce distinct diagnostics. Silence is not an acceptable answer.
- [ ] No field is present whose derivation is not deterministic and testable.
- [ ] A recorded ADR exists before the command ships, per [GOVERNANCE.md](https://github.com/AdamEddahmouni/agent-ready/blob/docs/vnext-phase-0/GOVERNANCE.md).

## Constraints carried from Phase 0

- [ADR-0042](https://github.com/AdamEddahmouni/agent-ready/blob/docs/vnext-phase-0/docs/decisions/0042-v1-freeze-and-parallel-vnext-surface.md): Phase 1 adds new additive CLI surface only. The v1 contract, the eleven shipped commands, and the adapter-output corpus are untouched.
- [ADR-0043](https://github.com/AdamEddahmouni/agent-ready/blob/docs/vnext-phase-0/docs/decisions/0043-core-posture-and-integration-quarantine.md): Phase 1 is entirely offline. Every command must work with networking disabled, no API key, and no `agent-ready.yaml` present.
