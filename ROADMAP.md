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

## Phase 4: Protected-path enforcement — complete

- `agent-ready check` CLI command: reports whether any file matching the
  contract's `paths.protected` patterns was changed in Git, relative to
  the working tree (default), the Git index (`--staged`), or an explicit
  ref (`--against <ref>`).
- Untracked (never-committed) files are included by default; a fresh
  repository with no commits yet treats all current files as changed
  rather than erroring.
- A new, hand-rolled glob matcher (`src/contract/globMatch.ts`) makes
  `paths.protected`/`generated`/`ignored` load-bearing for the first
  time — previously validated-but-inert data.
- A new `GitClient` abstraction (`src/git/`), mirroring the existing
  `FileSystem` pattern, makes `agent-ready check` the **first command
  whose availability depends on an external binary** (`git` on `PATH`).
  Git is invoked only with Agent-Ready-hardcoded arguments (plus a
  validated `--against` ref) — the "never execute contract-declared
  commands" boundary from Phase 0/1 is unchanged and unaffected. See
  [ADR-0013](docs/decisions/0013-protected-path-enforcement-and-git-invocation.md).
- New diagnostics: `PROTECTED_PATH_MODIFIED`, `GIT_UNAVAILABLE`,
  `GIT_REPOSITORY_NOT_FOUND`, reusing the existing exit-code scheme.

## Phase 5: Verification execution — complete

- `agent-ready verify` CLI command: runs the contract's
  `verification.required` commands, in declared order, and reports a
  pass/fail/timeout status for each. Defaults to a dry run that only
  prints the plan; nothing is executed unless `--execute` is passed.
- This is the **only** Agent-Ready command that executes contract-declared
  content. Every other command remains exactly as non-executing as before
  — this is a narrow, explicit, opt-in exception, not a removal, of the
  boundary [ADR-0006](docs/decisions/0006-command-representation.md)
  established. See
  [ADR-0014](docs/decisions/0014-verification-execution.md) for the full
  design, including why `run` stays a shell-invoked string, why execution
  stops at the first non-passing command, and why command output is never
  captured into diagnostics or `--json` output.
- A new `src/verify/` module (`CommandRunner`, `NodeCommandRunner`,
  `FakeCommandRunner`), mirroring the `src/git/` pattern from Phase 4.
- New diagnostics: `VERIFICATION_NOT_DECLARED`,
  `VERIFICATION_COMMAND_FAILED`, `VERIFICATION_COMMAND_TIMEOUT`,
  `VERIFICATION_COMMAND_SPAWN_FAILED`, reusing the existing exit-code
  scheme.

## Long-term open-source direction

The following remain **open-source, local-first roadmap categories** —
not yet implemented, and not committed to any specific phase or date:

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

`agent-ready init`/`audit`/`sync`/`score` subcommands ·
command or shell execution outside `agent-ready verify --execute` ·
per-command timeout/environment/working-directory declarations ·
capturing or persisting command output as evidence · task packets ·
completion records · context manifests ·
documentation-drift detection · architecture-dependency analysis ·
plugin/adapter loading ·
framework detection · monorepo contract inheritance or nested contracts ·
remote configuration · organization policies · hosted dashboards · user
accounts · authentication · billing · telemetry · analytics · IDE
extensions · a documentation website · GitHub App integration · a
GitHub Action product · cloud APIs · enterprise features · AI-generated
configuration · LLM calls · automatic repository modification · automated
package publication or release.

## Recommended next phase

Not yet decided. See the "Long-term open-source direction" list above for
candidate categories (Phase 5, verification execution, is now
complete — see above).
