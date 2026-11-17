# ADR-0042: Freeze the v1 contract and shipped CLI; add vNext as a parallel surface

## Status

Accepted

## Context

[ADR-0041](0041-vnext-autonomous-software-evolution.md) changes where
the project is going without changing anything about v0.6.1. That creates a
sequencing risk that is easy to underestimate: a vNext design that reaches into
the shipped surface will either erode the stable contract or leave the v1 line in
an ambiguous half-state.

The constraints that make this concrete:

- [ADR-0009](0009-pre-1.0-stability-policy.md) commits to additive-only schema
  evolution within contract `version: 1`, and requires a `version: 2` bump before
  any field is removed, retyped, or made required.
- [GOVERNANCE.md](../../GOVERNANCE.md) requires specification and reference
  implementation to change in the same pull request. The specification is not
  allowed to run ahead of the code that keeps it honest.
- `compatibility/adapter-output/v1` and `compatibility/adapter-output/v2` are
  versioned output corpora with recorded expectations. Adapter output is a
  published compatibility surface, not an internal rendering detail.
- The eleven shipped commands, their diagnostic codes, and their `--json` shapes
  are consumed by the reusable GitHub Action and by anyone who adopted the
  package.

A control plane introduces concepts with no existing expression in the contract:
system state, desired state, an evolution under way, a transaction, capabilities,
evidence binding, and post-deployment outcomes. None of them belong in
`version: 1`. Forcing them in would turn an additive evolution into a breaking
one, and would make the first experiment's contract indistinguishable from a
speculative redesign.

## Decision

Freeze the shipped line and build vNext beside it.

Frozen, unchanged, and still releasing as v0.6.x:

- `schemas/v1/agent-ready.schema.json` and contract `version: 1`.
- The eleven existing commands, their flags, diagnostic codes, exit codes, and
  `--json` output shapes.
- The programmatic API surface tracked by
  [docs/specification/api-stability.md](../specification/api-stability.md).
- The `compatibility/adapter-output` corpora and their expectations.

Rules for vNext:

- vNext ships under its own specification namespaces, versioned independently of
  the contract, per [ADR-0040](0040-release-and-version-taxonomy.md).
- vNext is reached only through new, additive CLI surface. New subcommands may be
  added; no existing command, flag, diagnostic code, or output field is renamed,
  removed, or retyped.
- vNext **reads** the v1 contract as an input. It never mutates, extends, or
  redefines it, and it does not require a repository to have one.
- No v1 field is removed, retyped, or made required without a contract `version: 2`
  bump and its own ADR, exactly as [ADR-0009](0009-pre-1.0-stability-policy.md)
  already requires.
- No monorepo restructuring, workspace split, or package reorganization is
  performed to host vNext. The package layout sketched in
  [VISION.md](../../VISION.md) is directional; a workspace conversion requires
  its own decision when there is a working implementation that justifies it.

## Consequences

- A repository that adopted v0.6.1 keeps working unchanged, and v0.6.x continues
  to release with its own compatibility guarantees while vNext is developed.
- Two documented surfaces coexist. The cost is explicit: users must be told which
  one a given command belongs to, and the CLI help and documentation index have to
  make the boundary visible rather than implying one unified product.
- The v1 line still receives ordinary maintenance — bug fixes, security fixes,
  documentation corrections, and dependency updates. "Frozen" means the public
  shape does not move, not that it stops being maintained.
- vNext work cannot reuse v1 by mutating it. New concepts require new structures,
  which means more code before the first vNext capability ships, and makes the
  first one slower to deliver.
- A future `version: 2` remains available. This decision defers that question
  rather than answering it.

## Reconsideration trigger

Revisit if v1.0.0 is released, if a contract `version: 2` is proposed, or if a
vNext concept cannot be expressed without changing the v1 schema or CLI surface.
At that point the correct move is an explicit `version: 2` decision with its own
ADR, not a quiet widening of `version: 1`.
