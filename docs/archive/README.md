# Archive

Superseded planning documents, kept for historical accuracy rather than for
guidance. Nothing in this directory is authoritative for current work.

Documents are archived, not deleted. A project that rewrites its own history cannot
show how it reached its current position, and a reader comparing the two positions
has no way to audit the change. The story of how Agent-Ready moved from a
repository-contract experiment to a proposal for autonomous software evolution
infrastructure is part of the record ([VISION.md §45](../../VISION.md)).

## Contents

| Document                       | Archived   | Superseded by                                                                | Still useful for                                        |
| ------------------------------ | ---------- | ---------------------------------------------------------------------------- | ------------------------------------------------------- |
| [roadmap-v1.md](roadmap-v1.md) | 2026-09-25 | [ADR-0041](../../docs/decisions/0041-vnext-autonomous-software-evolution.md) | The release sequence and planned ADRs v0.4 through v1.0 |

Two other documents describe shipped work rather than planned work, and stay where
they are: the [v0.5.0 implementation plan](../v0.5.0-implementation-plan.md) and
the [v0.6.0 implementation plan](../v0.6.0-implementation-plan.md).

## Reading an archived document

Archived means the _forward-looking_ content is stale, not that the content is
wrong. Each archived plan mixes three kinds of statement:

- **What shipped** — still accurate, and cross-checked by the release history and
  the ADRs it cites.
- **What was planned** — stale. Treat as a record of intent at the time.
- **What was claimed about the future** — stale, and the reason for archiving.

When an archived plan and a current document disagree about what exists today, the
current document wins. [README.md](../../README.md),
[docs/project-standing.md](../../docs/project-standing.md), and
[docs/adoption-and-impact.md](../../docs/adoption-and-impact.md) are the
authoritative statements of current reality.
