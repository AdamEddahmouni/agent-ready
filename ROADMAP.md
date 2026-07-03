# Roadmap

## Foundation (Phase 0/1) — complete

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

## Phase 6: Verification evidence recording — complete

- `agent-ready verify --execute --record`: writes the run's result to a
  fixed, hardcoded file at the repository root
  (`agent-ready-verify-result.json`), overwritten on every run — a
  durable, local artifact proving verification ran and what happened,
  closing the gap ADR-0014 named in its own reconsideration trigger.
- `--record` requires `--execute`; the evidence file's shape is the same
  structured `{ ok, contractPath, repoRoot, mode, commands, diagnostics }`
  body `verify --json` already produced, plus one new field,
  `recordedAt`. Still never captures a command's actual stdout/stderr —
  only the same non-sensitive status fields already exposed today.
- Unlike `generate --write`, there is no managed-file-marker protection:
  every `--record` run overwrites its target unconditionally, since the
  evidence file is inherently ephemeral, per-run data rather than
  content a user might hand-author. See
  [ADR-0015](docs/decisions/0015-verification-evidence-recording.md) for
  the full design, including why this is deliberately scoped away from
  the "historical verification-evidence retention" category reserved
  below for a future commercial product — this phase persists exactly one
  local file, with no history, aggregation, or central storage.
- New diagnostic code: `VERIFICATION_RECORD_WRITE_FAILED`.

## Phase 7: Reusable CI integration — complete

- A GitHub composite action (`action.yml` at the repository root) other
  repositories can `uses:` in their own CI, instead of hand-copying this
  repository's own `.github/workflows/ci.yml` shell steps.
- The action builds Agent-Ready from source inside its own checkout
  (`github.action_path`) and invokes the resulting `dist/cli/index.js`
  against the caller's repository — no npm publish required, sidestepping
  the "automated package publication or release" non-goal entirely. See
  [ADR-0016](docs/decisions/0016-reusable-ci-action.md).
- Typed inputs mirror every CLI flag `validate`/`inspect`/`generate`/
  `check`/`verify` already accept; inputs reach the action's shell step
  only via `env:`-mapped variables, never interpolated directly into the
  script body, avoiding the standard GitHub Actions script-injection
  footgun.
- No new diagnostics, exit codes, or schema changes — this phase adds no
  lines to `src/`. See
  [docs/specification/ci-integration.md](docs/specification/ci-integration.md)
  for adoption instructions, including the pinning caveat until a Git tag
  exists.
- This repository's own CI (`dogfood-action` job in
  `.github/workflows/ci.yml`) exercises the action via `uses: ./` on every
  PR.

## Phase 8: Adapter output Markdown escaping — complete

- `src/generate/adapters/shared.ts` and all five adapters
  (`agentsMd`/`claude`/`cursor`/`copilot`/`gemini`) now escape
  contract-supplied free text before interpolating it into generated
  Markdown, closing a previously untested gap: `project.name`,
  `project.description`, `command.description`, `command.run`,
  `runtime.range`, `packageManager.version`, `paths.*` glob patterns, and
  `instructions.sources` paths could all contain Markdown-significant
  characters (a leading `#`, an unbalanced backtick, a `)`/space in a link
  target, or an embedded newline) that would silently corrupt the
  rendered file's structure.
- A new module, `src/generate/adapters/escape.ts`, exports three pure
  functions — `escapeMarkdownText` (plain-text positions),
  `wrapCodeSpan` (inline-code positions, using a CommonMark-correct
  backtick-fence-length algorithm), and `renderMarkdownLink`
  (`instructions.sources`, using CommonMark's angle-bracket destination
  form when needed) — following the same pure-function, no-templating-
  engine style [ADR-0011](docs/decisions/0011-adapter-rendering-design.md)
  already established.
- **No schema change.** Tightening `project.description`/
  `command.description`'s JSON Schema `pattern` to forbid these
  characters was deliberately rejected in favor of a pure rendering-side
  fix — see [ADR-0017](docs/decisions/0017-adapter-output-markdown-escaping.md)
  for the full reasoning, including why this avoids the heavier
  specification-change governance bar and a breaking change to
  already-valid contracts.
- No new diagnostic code: escaping is silent and deterministic, with no
  new failure mode.
- New adversarial-input test coverage: `tests/unit/adaptersEscaping.test.ts`,
  a new example (`examples/adversarial-content/`), and five new
  byte-exact golden fixtures (`tests/fixtures/generate/expected-adversarial-*.txt`)
  exercised via `tests/integration/generateCli.test.ts` — extending the
  adversarial-input testing discipline Phase 0/1 established for contract
  _parsing_ to contract _rendering_ for the first time. All five
  pre-existing golden fixtures remain byte-identical, since neither
  example contract in `examples/` contains a Markdown-significant
  character in any free-text field.

## Phase 9: Adapter output compatibility corpus — complete

- A self-contained, versioned corpus under
  `compatibility/adapter-output/v1` maps representative contracts and
  supporting files to byte-exact output for all five adapters.
- The corpus is included in the npm package so downstream implementations can
  test compatibility without importing internal modules or using network
  services.
- The reference implementation runs the public corpus in its own test suite;
  existing expectations are immutable within a corpus version. See
  [ADR-0018](docs/decisions/0018-versioned-adapter-output-compatibility.md)
  and the
  [compatibility specification](docs/specification/adapter-output-compatibility.md).

## Phase 10: Instruction-source documentation drift analysis — complete

- A read-only `agent-ready analyze` command checks repository-relative Markdown
  links in the files explicitly declared by `instructions.sources`.
- The bounded parser recognizes inline/image links and reference definitions,
  ignores fenced/inline code and remote/root-relative destinations, strips
  fragments and queries, and reports deterministic source locations.
- Broken targets and lexical traversal outside the repository produce stable
  diagnostics and non-zero exit status; JSON output includes per-source counts
  and ordered findings.
- No schema change, Git invocation, command execution, network access, LLM call,
  or automatic documentation rewrite. See
  [ADR-0020](docs/decisions/0020-instruction-source-link-analysis.md).

## Long-term open-source direction

The following remain **open-source, local-first roadmap categories** —
not yet implemented, and not committed to any specific phase or date:

- Broader architecture-dependency analysis beyond Phase 10's instruction-source
  link check.
- Task packets and context manifests; richer completion records beyond
  the single-run evidence file `agent-ready verify --execute --record`
  now writes (Phase 6).
- An adapter/plugin interface, once there is more than one concrete
  adapter to justify the abstraction.
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
capturing or persisting a command's actual stdout/stderr as evidence
(only structured status is persisted, via `verify --execute --record`) ·
historical/multi-run verification-evidence retention · task packets ·
context manifests ·
architecture-dependency analysis beyond declared documentation links ·
plugin/adapter loading ·
framework detection · monorepo contract inheritance or nested contracts ·
remote configuration · organization policies · hosted dashboards · user
accounts · authentication · billing · telemetry · analytics · IDE
extensions · a documentation website · GitHub App integration · a
GitHub Action product · cloud APIs · enterprise features · AI-generated
configuration · LLM calls · automatic repository modification · automated
package publication or release.

## Recommended next phase

Stabilize and release Phase 10 as `v0.2.0` before selecting another feature phase. After
release, use a focused ADR to choose between broader architecture-dependency
analysis, task/context packets, and framework-specific examples; no Phase 11
scope is committed yet.
