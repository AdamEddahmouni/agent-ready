# Implementation scope: CLI/package maturity

**Status: committed — ADR-0021 accepted, all four commands shipped.**
This document scoped the CLI/package maturity direction selected by
[ADR-0021](decisions/0021-cli-package-maturity-direction.md). All four
commands — `agent-ready schema` ([ADR-0022](decisions/0022-agent-ready-schema-command.md)),
`agent-ready doctor` ([ADR-0023](decisions/0023-agent-ready-doctor-command.md)),
`agent-ready explain` ([ADR-0024](decisions/0024-agent-ready-explain-command.md)),
and `agent-ready init` ([ADR-0025](decisions/0025-agent-ready-init-command.md))
— are implemented and shipped. Path A is complete. See
[docs/project-standing.md](project-standing.md) for current state and
[ROADMAP.md](../ROADMAP.md) for committed phase history.

## Purpose

Reduce the friction of adopting Agent-Ready in a new repository, without
changing what the contract means or reopening non-goals already decided
(arbitrary command execution, hosted state, telemetry). The contract
format and its existing commands (`validate`, `inspect`, `generate`,
`check`, `analyze`, `schema`, `doctor`, `explain`, `verify`) are the stable
foundation this scope builds on top of, not something it replaces.

## Goals

- Make the first `agent-ready.yaml` in a repository fast to produce
  correctly, without hand-copying an example file.
- Make it easy to answer "why did validation fail, and in plain
  language, what do I do about it" beyond the existing diagnostic text.
- Make the schema and its version history introspectable from the CLI
  itself, rather than requiring a source checkout.
- Make environment/tooling problems (missing `git`, wrong Node version,
  missing package manager) diagnosable with one command instead of
  reading a stack trace from `check` or `verify`.
- Do all of this while keeping every new command as safe-by-default as
  the existing ones: dry-run first, explicit opt-in for anything that
  writes.

## Non-goals

- Re-litigating the contract's existing shape. This is a CLI-surface
  scope, not a schema-design scope.
- A hosted service, account system, or telemetry of any kind.
- Executing arbitrary repository commands. `verify --execute` remains
  the sole, narrowly-scoped exception described in
  [ADR-0014](decisions/0014-verification-execution.md); nothing in this
  scope widens it.
- A plugin/adapter-loading mechanism. The adapter registry stays a fixed,
  reviewed set until there is a concrete second-party adapter to justify
  the abstraction (see
  [docs/architecture/overview.md](architecture/overview.md#explicitly-absent-by-design-this-phase)).
- Renaming or removing any of the existing commands. `agent-ready
generate` already does what a tool called "sync" would do (compile a
  contract into adapter output, with dry-run/`--check`/`--write`
  semantics) — this scope does not introduce a competing `sync` command
  under a different name.

## Target users

- A maintainer adopting Agent-Ready in an existing repository for the
  first time, who currently must read the spec and hand-write YAML.
- A CI author who wants a single command to sanity-check that the local
  toolchain (Node, package manager, Git) matches what the contract
  declares, before running `validate`/`check`/`verify`.
- A contributor debugging a validation failure who wants more than a
  diagnostic code and a one-line remediation string.

## Core user stories

1. As a maintainer with no `agent-ready.yaml` yet, I can generate a
   starter contract from what's actually in my repository (detected
   package manager, detected test/lint/build scripts from
   `package.json`), review it, and adjust it — without starting from a
   blank file.
2. As a maintainer, I can ask the CLI to explain, in plain language,
   what a specific diagnostic code means and what part of my contract
   triggered it, beyond the one-line remediation text already shown.
3. As a CI author, I can run one command that reports whether the
   environment this job is running in satisfies what the contract
   declares (`environment.runtimes`, `environment.packageManager`, `git`
   availability) before spending time on `validate`/`check`/`verify`.
4. As a tool author, I can print the schema Agent-Ready validates
   against — and which version it corresponds to — without cloning this
   repository.

## Proposed command surface

| Command               | Status             | Purpose                                                                                                                                                                                                                                                       |
| --------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent-ready init`    | shipped (ADR-0025) | Scaffold a starter `agent-ready.yaml` from repository inspection. Never overwrites an existing contract file.                                                                                                                                                 |
| `agent-ready doctor`  | shipped (ADR-0023) | Report whether the local environment (Node/runtime versions, package manager, `git`) satisfies the contract's `environment` block and the requirements of each existing command. Read-only.                                                                   |
| `agent-ready explain` | shipped (ADR-0024) | Given a diagnostic code (or the output of a previous run), print an extended, plain-language explanation and the relevant contract field. Read-only.                                                                                                          |
| `agent-ready schema`  | shipped (ADR-0022) | Print the bundled JSON Schema (and its version) that `validate`/`inspect`/etc. validate against, for tooling that wants it without a source checkout. Read-only, no network access — it prints the same file already at `schemas/v1/agent-ready.schema.json`. |

Full per-command detail (inputs, outputs, flags, exit codes, safety
notes) belongs in
[docs/specification/cli-reference.md](specification/cli-reference.md)
once each command has an ADR — this document only scopes intent. See
that file's existing sections for the pattern every new command should
follow (dry-run default, explicit `--write`/`--execute` opt-in,
`--json` for machine consumption, `--config` for explicit contract
path).

## Expected package shape

No change from today: a single npm package (`agent-ready`), `bin` entry
pointing at `dist/cli/index.js`, a public programmatic API from
`src/index.ts`, and the bundled schema at `schemas/v1/agent-ready.schema.json`
(see [docs/specification/api-stability.md](specification/api-stability.md)).
New commands are new files under `src/cli/commands/`, following the
existing pattern: a plain, directly-testable async function returning
`{ exitCode, stdout, stderr }`, with no I/O logic living in `src/cli/index.ts`
itself.

## Expected config file

Unchanged: `agent-ready.yaml`, contract `version: 1`, validated against
the existing schema. `agent-ready init` would produce a file conforming
to that same schema — it is a generator of valid input, not a new
format. Any new top-level block (see
[docs/specification/config-evolution-draft.md](specification/config-evolution-draft.md))
is out of scope for this document and requires its own ADR.

## Expected generated files

Unchanged from today's five adapters (`AGENTS.md`, `CLAUDE.md`,
`.cursorrules`, `.github/copilot-instructions.md`, `GEMINI.md`) via
`agent-ready generate`. `agent-ready init` would generate exactly one
new file, `agent-ready.yaml` itself, and would refuse to run if that
file already exists (mirroring `generate --write`'s refusal to
overwrite an unmanaged file — see
[ADR-0010](decisions/0010-generate-write-boundary.md)).

## Validation model

Unchanged. `agent-ready doctor`, `explain`, and `schema` are read-only
and do not participate in the validation pipeline's pass/fail semantics
— `doctor` reports environment fitness, not contract validity;
`explain` narrates an existing diagnostic; `schema` prints static data.

## Evidence model

Unchanged from today (see
[docs/specification/evidence.md](specification/evidence.md)): command-level
pass/fail/timeout status via `verify --execute --record`. A richer,
structured "handoff evidence" model (summary, assumptions, known
issues) is a distinct, larger proposal tracked in that same document
and is not assumed by any command in this scope.

## Adapter model

Unchanged: the fixed five-adapter registry. Out of scope for this
document.

## Safety model

Every new command follows the same rules already load-bearing across
the existing commands:

- Read-only by default; a command that writes (`init`) refuses to
  overwrite existing content without an explicit override flag.
- No network access, ever.
- No execution of contract-declared or arbitrary shell content —
  `doctor`'s environment checks (Node version, `git --version`) run
  Agent-Ready-hardcoded commands only, exactly like `check`'s Git
  invocations today (see
  [ADR-0013](decisions/0013-protected-path-enforcement-and-git-invocation.md)).
- Deterministic, scriptable `--json` output for every new command, with
  human output explicitly uncovered by any compatibility guarantee (see
  [docs/specification/api-stability.md](specification/api-stability.md)).

## Implementation phases

1. **Scope decision via ADR** — ✅ done ([ADR-0021](decisions/0021-cli-package-maturity-direction.md))
2. **`agent-ready schema`** — ✅ shipped ([ADR-0022](decisions/0022-agent-ready-schema-command.md))
3. **`agent-ready doctor`** — ✅ shipped ([ADR-0023](decisions/0023-agent-ready-doctor-command.md))
4. **`agent-ready explain`** — ✅ shipped ([ADR-0024](decisions/0024-agent-ready-explain-command.md))
5. **`agent-ready init`** — ✅ shipped ([ADR-0025](decisions/0025-agent-ready-init-command.md)); highest risk
   (the only second writer after `generate --write`), sequenced last.
   Path A is now complete.

## Testing strategy

Same discipline as existing commands: unit tests for any new pure logic
(e.g. environment-requirement comparison for `doctor`), integration
tests exercising the CLI end-to-end against a temporary directory
(mirroring `tests/integration/cli.test.ts` and siblings), and — for
`init` specifically — adversarial-input tests mirroring
`tests/unit/adaptersEscaping.test.ts`'s discipline for anything that
writes generated content.

## Release strategy

No change to the existing pre-1.0 policy
([ADR-0009](decisions/0009-pre-1.0-stability-policy.md)). Each new
command ships as an additive minor version once merged; none of them
requires a schema major-version bump on their own, since none of them
(as scoped here) adds a required contract field.

## Acceptance criteria

A command in this scope is ready to build once, and only once, it has:

- An accepted ADR.
- A `docs/specification/cli-reference.md` section written in the same
  format as the existing commands (status, purpose, flags, examples,
  exit codes, safety notes).
- A test plan covering both success and failure paths.
- No new required contract field, or — if one is genuinely needed — a
  separate ADR for that schema change, reviewed independently.
