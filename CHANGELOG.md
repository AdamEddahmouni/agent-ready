# Changelog

All notable changes to Agent-Ready are documented here. The project follows
[Semantic Versioning](https://semver.org/) while remaining pre-1.0.

## 0.4.0-beta.2 - Unreleased

### Added

- `agent-ready init`, a dry-run-first command that inspects a repository and
  scaffolds a starter `agent-ready.yaml` only when `--write` is supplied.
- Hand-authored `instructions.content` support across the schema,
  normalization pipeline, adapters, compatibility corpus, and documentation.
- Public-project branding and community files, a roadmap to 1.0, CodeQL, and
  tag-triggered npm publication infrastructure.
- `agent-ready upgrade`, a dry-run-first, evidence-backed contract
  modernization command with `--write` opt-in, field-level diffs, and
  pre-write validation.
- Five ADRs covering package publication, contract upgrades, YAML depth,
  immutable Action pins, and instruction-source size limits.
- GitHub Release automation that attaches the npm tarball and the adapter
  compatibility corpus, plus post-publish clean-install verification.

### Changed

- Expanded generated adapter output with grouped commands, verification,
  path rules, and completion guidance.
- Pinned third-party GitHub Actions to immutable commit SHAs and tightened
  Dependabot configuration.
- Prepared package metadata and documentation for the scoped
  `@adameddahmouni/agent-ready` `0.4.0-beta.2` public preview rather than
  presenting post-`v0.3.0` work as version `0.3.0`.
- Added an immutable Action-pin check to the local and CI quality gates.

### Fixed

- Corrected composite-action setup and CI expression failures discovered
  after the `v0.3.0` tag.
- Made integration-test temporary-directory cleanup retry bounded Windows
  `EBUSY`/`EPERM` release races.
- Reject deeply nested YAML before conversion and oversized instruction sources
  before they are read into memory.

## 0.3.0 - 2026-07-06

### Added

- `agent-ready schema`, a read-only CLI command that prints the bundled
  Agent-Ready contract JSON Schema (path, contract version, JSON Schema
  `$schema`/`$id`/`title`, byte count) and optionally (`--content`)
  the parsed schema body. Requires no contract, repository, or Git
  working tree. See
  [ADR-0022](docs/decisions/0022-agent-ready-schema-command.md);
  selected as the first Path A increment by
  [ADR-0021](docs/decisions/0021-cli-package-maturity-direction.md).
- `agent-ready doctor`, a read-only CLI command that inspects the host
  environment for fitness to run Agent-Ready against the contract:
  declared Node range (`runtime-node`), declared package manager
  (`package-manager`), each declared non-`node` runtime
  (`runtime-other-<name>`, warn-only), Git on `PATH` (`git-on-path`,
  required iff `paths.protected` is non-empty), and Git working-tree
  membership (`git-repository`, informational). Loads and validates
  through the same contract pipeline as `agent-ready validate`; emits a
  `{ ok, contractPath, repoRoot, checks, diagnostics }` envelope with a
  uniform per-check row shape. Read-only: never executes
  contract-declared commands, never invokes Git for state-changing
  operations, never modifies the repository. See
  [ADR-0023](docs/decisions/0023-agent-ready-doctor-command.md),
  [ADR-0021](docs/decisions/0021-cli-package-maturity-direction.md).
- New [`src/binary/`](src/binary/) module exporting the `BinaryClient`
  boundary (`probe(target, root)` over the `git | pnpm | npm | yarn`
  target union), the real
  [NodeBinaryClient](src/binary/nodeBinaryClient.ts) (execFile-backed,
  ADR-0013 invariant: hardcoded `[<target>, "--version"]` argv; ENOENT
  resolves to `undefined`), and the
  [FakeBinaryClient](src/binary/fakeBinaryClient.ts) test double. Mirrors
  [`src/git/`](src/git/) in shape, so a future ADR adding a new probed
  runtime (e.g. `python`, `rust`) extends the `BinaryTarget` union and
  one probe mapping rather than introducing a parallel abstraction.
- Five new doctor-raised diagnostic codes
  (`RUNTIME_VERSION_MISMATCH`,
  `RUN_DECLARED_BUT_DOCTOR_UNSUPPORTED`,
  `PACKAGE_MANAGER_UNAVAILABLE`,
  `PACKAGE_MANAGER_VERSION_MISMATCH`,
  `GIT_REQUIRED_BUT_UNAVAILABLE`) added to
  [src/diagnostics/codes.ts](src/diagnostics/codes.ts), additive per
  [ADR-0009](docs/decisions/0009-pre-1.0-stability-policy.md).
- Vitest unit ([`tests/unit/doctor.test.ts`](tests/unit/doctor.test.ts))
  and integration
  ([`tests/integration/doctorCli.test.ts`](tests/integration/doctorCli.test.ts))
  suites exercising the ADR-0023 §Tests matrix: all-pass happy path,
  node-version mismatch, declared-but-unsupported non-Node runtimes,
  package-manager absent / version mismatch / probe throw, Git missing
  with `paths.protected` empty vs declared (warn vs fail), `git --version`
  unexpected throw surfaces as `GIT_UNAVAILABLE` and exit 10.
- `agent-ready explain`, a read-only CLI command that prints extended
  human-readable explanations for Agent-Ready diagnostic codes (`--code`),
  with structured `what` / `why` / `fix` / `related` fields, optional
  contract-field context (`--config`), and machine-readable JSON output
  (`--json`). Requires no contract or repository without `--config`; uses
  the same `loadContract` pipeline as `validate`/`doctor` when `--config`
  is given. See
  [ADR-0024](docs/decisions/0024-agent-ready-explain-command.md).
- [`src/cli/commands/explainRegistry.ts`](src/cli/commands/explainRegistry.ts)
  with extended explanations for all 40 diagnostic codes, each carrying
  `what` / `why` / `fix` / `fields` / `related` properties. Includes a
  registry-invariant test ensuring every `DiagnosticCode` has an entry.
- Vitest unit ([`tests/unit/explain.test.ts`](tests/unit/explain.test.ts))
  and integration
  ([`tests/integration/explainCli.test.ts`](tests/integration/explainCli.test.ts))
  suites exercising the ADR-0024 acceptance criteria: recognized-code
  human/JSON output, unknown-code exit 1, contract-field context when
  `--config` loads successfully, missing-field '(not declared)' note,
  contract-load failure short-circuits.
- Vitest integration test
  [`tests/integration/actionSubcommands.test.ts`](tests/integration/actionSubcommands.test.ts)
  asserting that every CLI subcommand wired in
  [`src/cli/index.ts`](src/cli/index.ts) is listed in
  [`action.yml`](action.yml)'s `inputs.command.description`, and
  vice versa. Locks the action's accepted-subcommand allowlist in
  lockstep with the wired CLI surface so a future Path A ship widens
  both in one PR.

### Changed

- Widened the composite action's [`action.yml`](action.yml) `command`
  input to accept `schema`, `doctor`, and `explain`, fulfilling the
  follow-up ADR requirements. The action's typed inputs (`command:` /
  `config:` / `json:` / …) stay data-driven — no shell-quoting or
  string interpolation into the bash step. The
  [`ci-integration.md`](docs/specification/ci-integration.md) reference
  mirrors the accepted list and adds a `command: schema` example; the
  [`.github/workflows/ci.yml`](.github/workflows/ci.yml) `dogfood-action`
  matrix now exercises `schema` through the action as well, with
  `config:` intentionally empty for that one entry
  (`agent-ready schema` does not accept `--config` —
  [ADR-0022](docs/decisions/0022-agent-ready-schema-command.md)).
  Future Path A commands (`init`) will widen this action's `command`
  input in the same PR that adds the command, so the composite action
  supports every shipped CLI subcommand without lag.
- New [`action-fail-fast`](.github/workflows/ci.yml) CI smoke job
  asserts `action.yml`'s bash `case` block rejects an unknown
  subcommand (`command: bogus`) with exit 3 and a `::error::`
  annotation. Guards against regression of the action-subcommand
  allowlist.
- De-duplicated the accepted-subcommands list in
  [`docs/specification/ci-integration.md`](docs/specification/ci-integration.md)'s
  Inputs section into a single "Accepted subcommands" subsection,
  referenced by the Inputs table's `command` row. Fixed a
  prettier-spacing sentence-join bug in the closing Path A prose.

### Documentation

- Selected Path A (CLI/package maturity) as the next increment via
  [ADR-0021](docs/decisions/0021-cli-package-maturity-direction.md)
  and updated ROADMAP.md's "Recommended next phase" and "CLI/package
  maturity direction" sections accordingly; the first command to ship
  is `agent-ready schema` (read-only, no contract-schema changes, no
  new diagnostic codes).
- Drafted [ADR-0023](docs/decisions/0023-agent-ready-doctor-command.md)
  and [ADR-0024](docs/decisions/0024-agent-ready-explain-command.md)
  — per-command designs for `agent-ready doctor` (second Path A ship)
  and `agent-ready explain` (third Path A ship). Sequenced `doctor` →
  `explain` → `init` from ADR-0021. Doctor is the first contract-loading
  Path A command (compares detected tooling against declared
  `environment.runtimes`/`environment.packageManager` and
  required-`paths.protected` git); explain is the first documentation/
  rendering-only command (no new diagnostic codes, no new abstractions).
  Both ADRs were accepted and implemented in this release.

## 0.2.0 - 2026-07-03

### Added

- `agent-ready analyze`, a read-only documentation drift check for local
  Markdown links in declared `instructions.sources`, with human and structured
  JSON output.
- Stable documentation-analysis diagnostics for unreadable sources, target
  inspection failures, broken links, and repository-escaping links.

### Fixed

- Enforced LF working-tree line endings across platforms so formatting checks
  and the byte-exact adapter compatibility corpus remain deterministic on
  Windows.

### Documentation

- Corrected stale architecture and threat-model claims and selected local
  architecture/documentation drift analysis as the Phase 10 direction.
- Added ADR-0020 and full CLI, CI-action, security, and architecture
  documentation for Phase 10's bounded link-analysis design.

### Security

- Documentation analysis rejects lexical traversal above the repository root
  and never follows remote or root-relative link destinations.

## 0.1.0 - 2026-07-03

### Added

- Contract discovery, safe YAML parsing, JSON Schema validation, semantic
  validation, deterministic normalization, and structured diagnostics.
- `validate`, `inspect`, `generate`, `check`, and `verify` CLI commands.
- Generated instructions for AGENTS.md, Claude, Cursor, GitHub Copilot, and
  Gemini, including managed-file protection and Markdown-safe rendering.
- Git-based protected-path enforcement.
- Opt-in verification execution, timeouts, and local JSON evidence recording.
- A reusable GitHub composite action.
- A versioned adapter-output compatibility corpus for downstream consumers.

### Security

- Contract-declared commands remain inert except for the explicit
  `verify --execute` path.
- Generated Markdown escapes contract-supplied text, code spans, and links.
