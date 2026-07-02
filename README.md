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

This is the **Phase 0/1/2/3/4/5 foundation**: a minimal contract core, a
local CLI, agent-instruction generation for `AGENTS.md`, `CLAUDE.md`,
`.cursorrules`, `.github/copilot-instructions.md`, and `GEMINI.md`,
protected-path enforcement against real Git changes, and local execution
of a contract's declared verification commands. Concretely, right now
Agent-Ready can:

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
- Generate `AGENTS.md`, `CLAUDE.md`, `.cursorrules`,
  `.github/copilot-instructions.md`, and `GEMINI.md` from the enabled
  `agentsMd`/`claude`/`cursor`/`copilot`/`gemini` adapters
  (`agent-ready generate`), with an opt-in `--write`, a `--check` mode for
  CI drift detection, and a managed-file marker so a re-run never silently
  overwrites a file you wrote by hand.
- Report every failure as a structured, stable diagnostic with a code,
  severity, field, and remediation — in both human-readable and `--json`
  form.
- Check whether any file matching the contract's `paths.protected`
  patterns was actually changed in Git — working tree, staged, or
  relative to an explicit ref (`agent-ready check`). This is the first
  command that requires a Git working tree and the `git` executable.
- Run the contract's `verification.required` commands, in declared order,
  and report pass/fail/timeout evidence for each (`agent-ready verify`).
  Defaults to a dry run that only prints the plan; nothing is executed
  unless `--execute` is passed. This is the **only** Agent-Ready command
  that executes contract-declared content — see
  [ADR-0014](docs/decisions/0014-verification-execution.md).

**What it deliberately does _not_ do yet:**

- It does **not** execute any repository command, **except**
  `agent-ready verify --execute`, which runs exactly the commands declared
  in `verification.required` and nothing else. Every other command
  (`validate`, `inspect`, `generate`, `check`, and `agent-ready verify`
  without `--execute`) treats `commands`/`verification` as inert,
  validated data and never invokes a shell. `agent-ready check` never
  reads `commands` or `verification` at all; the only process it ever
  spawns is `git`, with Agent-Ready-hardcoded arguments.
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
validation and normalization
        |
        v
AGENTS.md / CLAUDE.md / .cursorrules /
.github/copilot-instructions.md / GEMINI.md generation
        |
        v
protected-path enforcement against Git changes
        |
        v
local verification execution and evidence   <-- this phase
        |
        v
CI policies, richer evidence retention   <-- future phases
```

Agent-Ready does not compete with `AGENTS.md`, `CLAUDE.md`, Cursor rules,
Copilot instructions, or Gemini instructions. The intent is for those to
be **generated outputs** of one structured source of truth, not for
Agent-Ready to replace them — all five are.

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

agent-ready generate                       # dry run: show what would be generated
agent-ready generate --write               # write the enabled adapters' output files
agent-ready generate --write --force       # also overwrite hand-authored files
agent-ready generate --check               # CI mode: exit non-zero if output is stale
agent-ready generate --json

agent-ready check                          # protected-path violations vs the working tree
agent-ready check --staged                 # ...vs the Git index
agent-ready check --against origin/main    # ...vs an explicit ref
agent-ready check --json

agent-ready verify                         # dry run: print the verification.required plan
agent-ready verify --execute               # actually run those commands, in order
agent-ready verify --execute --timeout 60  # override the per-command timeout (seconds)
agent-ready verify --json

agent-ready --help
agent-ready --version
```

None of the above writes to your repository — except `agent-ready
generate --write`, which writes only the adapter-hardcoded files it plans
to generate (`AGENTS.md`, `CLAUDE.md`, `.cursorrules`,
`.github/copilot-instructions.md`, `GEMINI.md`), and refuses to overwrite
an existing file that doesn't carry its own managed-file marker unless
`--force` is also passed. None of the above executes a command declared
in the contract — except `agent-ready verify --execute`, which runs
exactly the commands declared in `verification.required`, as real shell
commands, and nothing else (see
[ADR-0014](docs/decisions/0014-verification-execution.md)). `agent-ready
check` is the one command that requires a Git working tree and the `git`
executable on `PATH`; it only ever invokes `git` with Agent-Ready-hardcoded
arguments, never anything contract-supplied.

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
