# Specification overview

Agent-Ready defines a canonical, repository-relative contract file named
`agent-ready.yaml`. This document is the entry point into the version 1
specification; see the other files in this directory for full detail on
each area.

## Canonical file

- **Filename**: `agent-ready.yaml` (exact name; alternate filenames are
  not supported in this phase — see
  [discovery.md](discovery.md)).
- **Format**: YAML, parsed safely (see
  [../security/threat-model.md](../security/threat-model.md)).
- **Schema**: [schemas/v1/agent-ready.schema.json](../../schemas/v1/agent-ready.schema.json),
  JSON Schema draft 2020-12. See [ADR-0002](../decisions/0002-json-schema-design.md).

## Pipeline

A contract goes through five distinct stages before it is considered
valid and usable (see [../architecture/overview.md](../architecture/overview.md)
for the full module-level breakdown):

1. **Discovery** — find the repository root and the contract file
   ([discovery.md](discovery.md)).
2. **Parsing** — read the file and parse it as YAML into a plain JS value,
   with a 1 MB byte cap, 100-level nesting cap, duplicate-key detection, and
   no tag execution.
3. **Schema validation** — validate the parsed value against the public
   JSON Schema; unknown fields are rejected.
4. **Semantic validation** — cross-field checks JSON Schema cannot express:
   command-reference resolution, path safety, semver validation,
   instruction-source existence, architecture/agent reference safety, and
   path-category conflicts.
5. **Normalization** — produce a deterministic, strongly-typed
   `NormalizedContract`, with defaults resolved and stable ordering
   applied.

Every stage that can fail produces structured diagnostics (see
[diagnostics.md](diagnostics.md)) rather than throwing; a stage only
throws for something the codebase considers an internal invariant
violation (a bug, not a user mistake).

## What the version 1 contract covers

See [contract-reference.md](contract-reference.md) for exact field
semantics. In summary:

- **Contract identity** — `version`.
- **Project metadata** — `project.name`, `project.description`.
- **Environment** — `environment.runtimes`, `environment.packageManager`.
- **Commands** — `commands`, a map of named, inert command declarations.
- **Verification** — `verification.required`, an ordered list of command
  references.
- **Paths** — `paths.protected`, `paths.generated`, `paths.ignored`.
- **Instruction sources** — `instructions.sources`.
- **Architecture guidance** — `architecture.boundaries`,
  `architecture.invariants`, and `architecture.key_decisions`.
- **Agent guidance** — `agents.disallowed_actions`,
  `agents.approval_required_for`, and `agents.context_files`.
- **Adapter declarations** — `adapters`; all five declared adapters drive
  `agent-ready generate` when enabled.

## What is explicitly out of scope

See [../../ROADMAP.md](../../ROADMAP.md) for the full, explicit list of
strict non-goals for this phase. Contract commands remain inert except for the
explicit, opt-in `agent-ready verify --execute` boundary described in
[ADR-0014](../decisions/0014-verification-execution.md).
