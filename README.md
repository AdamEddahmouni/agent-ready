# Agent-Ready Repository Standard

**Define once. Guide every agent. Verify the work.**

Agent-Ready is an open, vendor-neutral specification and CLI for
describing how AI coding agents should work inside a software repository:
its commands, environment, instructions, restrictions, verification
requirements, and completion evidence — defined once, in one canonical
file, and validated deterministically.

```text
agent-ready.yaml
```

## What this foundation actually does today

This is the **Phase 0/1 foundation**: a minimal contract core and a local
CLI. Concretely, right now Agent-Ready can:

- Discover a repository's `agent-ready.yaml` (see
  [docs/specification/discovery.md](docs/specification/discovery.md)).
- Parse it as YAML safely (rejecting duplicate keys, oversized files, and
  never evaluating custom tags — see
  [docs/security/threat-model.md](docs/security/threat-model.md)).
- Validate it against a public JSON Schema
  ([schemas/v1/agent-ready.schema.json](schemas/v1/agent-ready.schema.json)),
  rejecting unknown fields.
- Perform semantic validation beyond what JSON Schema can express:
  command-reference resolution, path-traversal and category-conflict
  checks, semver validation, and instruction-source existence.
- Normalize the validated contract into a deterministic, strongly-typed
  form and print it (`agent-ready inspect`).
- Report every failure as a structured, stable diagnostic with a code,
  severity, field, and remediation — in both human-readable and `--json`
  form.

**What it deliberately does _not_ do yet:**

- It does **not** execute any repository command. `commands` and
  `verification` are inert, validated data — never a shell invocation.
- It does **not** generate `AGENTS.md`, `CLAUDE.md`, Cursor rules,
  Copilot instructions, Gemini instructions, or any other downstream
  format yet. `adapters` in the contract is configuration only.
- It does **not** include, require, or phone home to any hosted service.
  Everything above runs locally, in your terminal or CI runner.
- It is **pre-1.0** and follows the compatibility policy in
  [ADR-0009](docs/decisions/0009-pre-1.0-stability-policy.md).

## Why

AI coding agents are only as dependable as the repository environment they
operate in. Plain-language instruction files (`AGENTS.md`, `CLAUDE.md`,
and similar) are valuable, but on their own they cannot prove that a
command still exists, that a test actually passed, or that a protected
path was respected. Agent-Ready's long-term goal is to turn that guidance
into an executable, verifiable contract:

```text
agent-ready.yaml
        |
        v
validation and normalization   <-- this phase
        |
        v
agent-specific instructions, CI policies, verification evidence   <-- future phases
```

Agent-Ready does not compete with `AGENTS.md`, `CLAUDE.md`, Cursor rules,
Copilot instructions, or Gemini instructions. The intent is for those to
become **generated outputs** of one structured source of truth, not for
Agent-Ready to replace them.

## Installation

```bash
pnpm install
pnpm build
```

Node.js `>=20.0.0` and pnpm are required (see
[ADR-0001](docs/decisions/0001-runtime-and-distribution.md)). Requires
network access to install dependencies from the npm registry.

## Usage

```bash
agent-ready validate                       # discover + validate the contract in the current repo
agent-ready validate --json                # machine-readable diagnostics
agent-ready validate --config path/to/agent-ready.yaml

agent-ready inspect                        # print the normalized contract
agent-ready inspect --json

agent-ready --help
agent-ready --version
```

None of the above ever executes a command declared in the contract, and
none of it writes to your repository.

## A minimal contract

```yaml
version: 1

project:
  name: example-project
  description: Example application

commands:
  lint:
    run: pnpm lint
  test:
    run: pnpm test

verification:
  required:
    - lint
    - test
```

See [docs/specification/contract-reference.md](docs/specification/contract-reference.md)
for every supported field, and [examples/](examples/) for complete, valid,
and intentionally invalid contracts.

## Documentation

- [Specification overview](docs/specification/overview.md)
- [Minimal contract reference](docs/specification/contract-reference.md)
- [CLI reference](docs/specification/cli-reference.md)
- [Diagnostic and error-code reference](docs/specification/diagnostics.md)
- [Repository and contract discovery](docs/specification/discovery.md)
- [Path and glob semantics](docs/specification/paths-and-globs.md)
- [Schema versioning policy](docs/specification/schema-versioning.md)
- [Public API stability](docs/specification/api-stability.md)
- [Architecture overview](docs/architecture/overview.md)
- [Threat model](docs/security/threat-model.md)
- [Architecture Decision Records](docs/decisions/README.md)
- [Roadmap](ROADMAP.md)
- [Governance](GOVERNANCE.md)

## Project status and roadmap

Agent-Ready follows an open-core strategy: the specification, JSON
Schema, CLI, validation, normalization, local inspection, and local
verification are and will remain part of this open-source project. A
future _optional_ commercial product may add organization-wide
coordination (dashboards, cross-repository policy, hosted scheduled
checks, and similar) without ever making the local contract or CLI
dependent on it — see [ROADMAP.md](ROADMAP.md) for details and explicit
non-goals for this phase.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security issues should be
reported per [SECURITY.md](SECURITY.md), not as public GitHub issues.

## License

Apache License 2.0 — see [LICENSE](LICENSE).
