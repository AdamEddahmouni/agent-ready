# ADR-0019: Phase 10 direction: architecture and documentation drift

## Status

Accepted.

## Context

After the v0.1.0 stabilization and release work, the roadmap calls for a
focused choice among three open-source directions: architecture/documentation
drift analysis, task/context packets, or broader framework-specific examples.

The release review supplied direct evidence for the first option. The threat
model still described contract-driven process execution as structurally
impossible after `verify --execute` had shipped, its heading stopped at Phase
8, the ADR index described only the Phase 0/1/2 foundation, and the architecture
overview omitted two CLI command dependencies. These are documentation defects
today and examples of the class of defect a local drift analyzer should make
cheaper to detect.

Task/context packets would expand the public data model before the project has
evidence for the right packet boundary. Framework examples are useful adoption
work, but they do not strengthen the specification's central promise that
repository claims should be backed by deterministic evidence.

## Decision

Select local architecture-dependency and documentation-drift analysis as the
Phase 10 direction.

Phase 10 begins with discovery and a separate design ADR. That design work must
define the smallest deterministic checks, their inputs, false-positive policy,
and CLI/diagnostic implications before implementation. This selection ADR does
not itself add a command, alter the contract schema, or reserve diagnostic
codes.

The capability must remain local-first, read-only by default, deterministic,
and independent of an AI model or hosted service. Initial design should prefer
checks grounded in repository evidence, such as documented module or command
inventories that can be compared with source-controlled structure. It must not
silently rewrite documentation.

Task/context packets and framework-specific examples remain valid later roadmap
categories; this decision orders the work rather than rejecting them.

## Consequences

- The next feature-design work has a concrete problem statement supported by
  defects found during release review.
- A second ADR is required before adding any public CLI surface, diagnostic
  codes, configuration, or schema fields.
- Phase 10 can start without weakening local-only operation or introducing an
  LLM dependency.
- Framework examples and task/context packets are deferred until the analyzer's
  initial scope is designed and evaluated.

## Reconsideration trigger

Reconsider the ordering if user research shows task handoff or framework
adoption is a materially more urgent blocker, or if discovery cannot identify
useful drift checks with acceptably low false-positive rates.
