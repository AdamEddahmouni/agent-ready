# Roadmap

## Current phase: Foundation (Phase 0/1) — complete

- Public open-source project scaffolding: license, governance,
  contribution guidelines, security policy, CI.
- Minimal `agent-ready.yaml` contract core: project metadata, environment
  (runtimes, package manager), commands, verification, protected/
  generated/ignored paths, instruction sources, adapter declarations.
- Public JSON Schema (`schemas/v1/agent-ready.schema.json`) with strict
  unknown-field rejection.
- Safe YAML parsing, JSON Schema validation, semantic validation
  (reference resolution, path safety, semver validation), and
  deterministic normalization.
- Structured diagnostics (stable codes, human and `--json` rendering,
  stable exit codes).
- `agent-ready validate` and `agent-ready inspect` CLI commands.
- Unit and integration test coverage, including cross-platform path
  handling and adversarial-input cases.

See the [architecture overview](docs/architecture/overview.md) and
[ADRs](docs/decisions/README.md) for exact detail on what was built and
why.

## Phase 2: Agent-instruction generation — complete

- `agent-ready generate` CLI command: compiles the validated,
  normalized contract into `AGENTS.md` (`adapters.agentsMd`) and
  `CLAUDE.md` (`adapters.claude`).
- Defaults to a dry run; `--write` opts in to writing files, `--check`
  supports CI drift detection, `--force` overrides the unmanaged-file
  refusal.
- A managed-file marker so generated files are never silently
  confused with hand-authored ones, and `generate --write` never
  clobbers a file it didn't create (see
  [ADR-0010](docs/decisions/0010-generate-write-boundary.md) and
  [ADR-0011](docs/decisions/0011-adapter-rendering-design.md)).
- Cursor, Copilot, and Gemini adapters remain declarable-but-unimplemented:
  enabling them produces an `ADAPTER_NOT_YET_IMPLEMENTED` warning, not an
  error.

## Phase 3: Cursor, Copilot, and Gemini adapters — complete

- Renderers for the three remaining declared adapter names: `cursor` ->
  `.cursorrules`, `copilot` -> `.github/copilot-instructions.md`, `gemini`
  -> `GEMINI.md`.
- No changes to `planGeneration`'s control flow, the CLI surface, the JSON
  Schema, or the diagnostic-code registry — purely additive, following the
  same pattern as the `agentsMd`/`claude` adapters from Phase 2.
- The output-format tradeoffs (flat `.cursorrules` rather than a
  `.cursor/rules/*.mdc` directory; `.github/copilot-instructions.md`'s
  nested, non-repo-root path) are documented in
  [ADR-0012](docs/decisions/0012-cursor-copilot-gemini-output-format.md).
- `ADAPTER_NOT_YET_IMPLEMENTED` remains in the diagnostic registry, now
  reserved for a future adapter name added to the schema ahead of its
  renderer.

## Long-term open-source direction

The following remain **open-source, local-first roadmap categories** —
not yet implemented, and not committed to any specific phase or date:

- Local command execution and verification evidence (actually running the
  commands declared in `verification.required` and recording results).
- Protected-path enforcement against real Git changes.
- Architecture-dependency and documentation-drift analysis.
- Task packets, completion records, and context manifests.
- Basic CI integrations beyond this repository's own workflow (i.e. a
  reusable action/workflow other repositories can adopt).
- An adapter/plugin interface, once there is more than one concrete
  adapter to justify the abstraction.
- A compatibility test suite for downstream adapter output.
- More example repositories and framework-specific guidance.

These are directional, not scheduled — the project intends to keep
delivering these as open-source, local-first capabilities. Nothing above
requires an account, a hosted service, or a subscription to use.

## Long-term commercial direction (not implemented)

A future **optional** commercial product ("Agent-Ready Cloud" or similar)
may offer capabilities that inherently require centralized
infrastructure:

- Organization dashboards and cross-repository visibility.
- Central policy management and approval workflows.
- Historical verification-evidence retention.
- GitHub organization integration and scheduled hosted checks.
- Team permissions, enterprise authentication, and compliance exports.
- Managed runners, dedicated deployments, and support/SLA agreements.

None of this exists in the current codebase. If and when it is built, the
local contract and CLI must remain fully functional without it — a
canceled subscription, an unreachable hosted service, or the absence of
any account must never break local validation, inspection, or (future)
local verification. See the "open mechanism, paid coordination" principle
referenced from the project brief and enforced by
[ADR-0009](docs/decisions/0009-pre-1.0-stability-policy.md).

## Strict non-goals for the current phase

The following are explicitly **not** implemented right now, by design —
not oversights:

`agent-ready init`/`audit`/`sync`/`verify`/`score` subcommands ·
command or shell execution of any kind · verification-evidence
execution · task packets · completion records · context manifests ·
documentation-drift detection · architecture-dependency analysis ·
protected-path enforcement against Git changes · plugin/adapter loading ·
framework detection · monorepo contract inheritance or nested contracts ·
remote configuration · organization policies · hosted dashboards · user
accounts · authentication · billing · telemetry · analytics · IDE
extensions · a documentation website · GitHub App integration · a
GitHub Action product · cloud APIs · enterprise features · AI-generated
configuration · LLM calls · automatic repository modification · automated
package publication or release.

## Recommended next phase

Not yet decided. See the "Long-term open-source direction" list above for
candidate categories.
