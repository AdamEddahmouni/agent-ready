# Governance

Agent-Ready is an early-stage open-source project. This document
describes how it is currently governed and how that is expected to
evolve as the contributor base grows.

## Current maintainer authority

The project currently operates under a **benevolent-maintainer** model: a
small set of maintainers (initially, the project's founding
author/authors) has final authority over what gets merged, how the
specification evolves, and how releases are cut. This is a deliberate,
lightweight structure appropriate for a project with few contributors; it
is expected to evolve (see "Adding maintainers" below) as the contributor
base grows, not to remain fixed forever.

## Contributor expectations

- Follow [CONTRIBUTING.md](CONTRIBUTING.md) and the
  [Code of Conduct](CODE_OF_CONDUCT.md).
- Respect the documented [strict non-goals](ROADMAP.md) for the current
  phase — a pull request implementing an explicitly out-of-scope feature
  will be closed regardless of code quality, to keep the foundation
  focused.
- Prefer opening an issue before large changes, so scope and design can be
  discussed before code is written.

## Decision-making process

- **Routine changes** (bug fixes, test additions, documentation
  corrections, dependency bumps): reviewed and merged by any maintainer.
- **Consequential technical decisions** (anything that would need an ADR
  per the criteria below): proposed via pull request that includes the
  ADR itself; merged once at least one maintainer approves.
- **Specification changes** (anything altering `schemas/v1/agent-ready.schema.json`'s
  public shape, or introducing a new contract version): require an ADR,
  a schema-example update, and explicit maintainer sign-off, since these
  changes affect every consumer of the contract, not just this repository.

## When an ADR is required

An Architecture Decision Record (`docs/decisions/`) is required for a
change that:

- Is hard to reverse once other code or external consumers depend on it.
- Affects the public contract, JSON Schema, CLI surface, or diagnostic
  codes.
- Chooses between multiple reasonable technical alternatives where the
  reasoning would not be obvious to a future contributor reading the code
  alone.

An ADR is **not** required for formatting/style choices, internal
refactors with no external-facing effect, or straightforward bug fixes.

## When a broader RFC may eventually be required

Once the project has an established external user base, larger
specification changes (e.g. a new major contract version, or a change
affecting how downstream adapters are expected to consume the contract)
should go through a public RFC process (a proposal document open for
community comment before implementation) rather than being decided
solely via ADR. This project is not yet at that stage; today, an ADR plus
maintainer review is sufficient. This section exists so contributors know
that the process is expected to formalize further, and roughly when.

## Adding maintainers

New maintainers may be added by existing maintainer consensus, based on
sustained, high-quality contribution and demonstrated judgment consistent
with this document and the project's core principles (see the top-level
project brief referenced in `ROADMAP.md`). There is no fixed contribution
count or tenure requirement at this stage; this will be formalized as the
contributor base grows.

## Compatibility commitments before 1.0

See [ADR-0009](docs/decisions/0009-pre-1.0-stability-policy.md) for the
detailed, per-surface pre-1.0 compatibility policy (JSON Schema,
diagnostic codes, normalized contract shape, CLI `--json` output, and the
public programmatic API).

## Specification vs. reference implementation

This repository contains both the specification (the JSON Schema and its
accompanying documentation under `docs/specification/`) and the reference
implementation (the `agent-ready` CLI and library). They are versioned
and released together in this phase. A specification change always
requires a corresponding reference-implementation change (schema,
validation logic, tests, and documentation) in the same pull request —
Agent-Ready does not accept "spec-only" changes that leave the reference
implementation out of sync, since the reference implementation is what
keeps the specification honest (see the "evidence over claims" principle
referenced in `ROADMAP.md`).

## Security governance

See [SECURITY.md](SECURITY.md) for the vulnerability-reporting process.
