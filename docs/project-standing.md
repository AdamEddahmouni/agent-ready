# Project standing

This document is the honest, current-state entry point for anyone asking
"what actually exists here today, and where is this going." It exists
because Agent-Ready's direction is easy to over- or under-state: the
project is neither a documentation-only proposal nor a finished product.

## What exists today (v0.2.0, pre-1.0)

Agent-Ready already ships a real, installable-from-source CLI and
TypeScript package, not just a specification document:

- A canonical contract format, `agent-ready.yaml`, with a public,
  strict JSON Schema
  ([schemas/v1/agent-ready.schema.json](../schemas/v1/agent-ready.schema.json))
  and a full field reference
  ([docs/specification/contract-reference.md](specification/contract-reference.md)).
- A working CLI (`agent-ready`, package bin) with six real commands:
  `validate`, `inspect`, `generate`, `check`, `analyze`, `verify` — see
  [docs/specification/cli-reference.md](specification/cli-reference.md)
  for exact behavior, flags, exit codes, and JSON output shapes.
- Five implemented adapters that generate agent-instruction files from
  one contract: `AGENTS.md`, `CLAUDE.md`, `.cursorrules`,
  `.github/copilot-instructions.md`, `GEMINI.md` — with a managed-file
  marker so a regenerate never silently overwrites hand-authored
  content, and Markdown-escaping so contract free text can't corrupt
  generated output.
- Git-based protected-path enforcement (`agent-ready check`), opt-in
  verification-command execution with evidence recording
  (`agent-ready verify --execute --record`), and read-only
  documentation-link drift analysis (`agent-ready analyze`).
- A reusable GitHub composite action (`action.yml`) so another
  repository's CI can adopt all of the above without hand-copying shell
  steps.
- A public, experimental programmatic API (`src/index.ts`) for
  embedding the validation pipeline in another tool — see
  [docs/specification/api-stability.md](specification/api-stability.md).
- Unit and integration tests, a CI pipeline
  (`.github/workflows/ci.yml`), 20 Architecture Decision Records
  (`docs/decisions/`), a threat model, and a stated pre-1.0
  compatibility policy.

None of this is aspirational. Run `agent-ready --help` after `pnpm
install && pnpm build` and every command above is real.

## What does not exist yet

- **No `agent-ready init` command.** Adopting Agent-Ready today means
  hand-authoring the first `agent-ready.yaml` (with the examples in
  [examples/](../examples/) as a starting point), not scaffolding one
  with a CLI command.
- **No `agent-ready doctor`, `agent-ready explain`, or `agent-ready
schema` commands.** These are proposed, not built — see
  [docs/implementation-scope-cli-package.md](implementation-scope-cli-package.md).
- **No richer, structured "handoff evidence"** (summary, assumptions,
  known issues, risks) beyond the command-level pass/fail/timeout
  evidence `verify --execute --record` already writes today. See
  [docs/specification/evidence.md](specification/evidence.md) for the
  distinction between what's recorded now and what's proposed.
- **No schema fields for `agents:`, `quality_gates:`, `handoff:`, or
  `architecture:` blocks.** Ideas for these are sketched, non-normative,
  in [docs/specification/config-evolution-draft.md](specification/config-evolution-draft.md),
  but adding them to the schema requires an ADR and a maintainer
  sign-off per [GOVERNANCE.md](../GOVERNANCE.md) — they are not decided.
- **No community/plugin adapter mechanism.** The five adapters are a
  fixed, hardcoded registry (`generate/generate.ts`'s `RendererRegistry`)
  by design at this phase — see
  [docs/architecture/overview.md](architecture/overview.md#explicitly-absent-by-design-this-phase).
- **No hosted service of any kind.** Everything above runs locally. A
  possible future commercial product ("Agent-Ready Cloud" or similar)
  is discussed only as direction, not built — see
  [ROADMAP.md](../ROADMAP.md#long-term-commercial-direction-not-implemented).
- **No visual identity, website, or branding.** Deliberately deferred
  until the project is ready for a public 1.0 — see
  [ROADMAP.md](../ROADMAP.md#branding-and-visual-design--deliberately-deferred).

## Why a standard is useful even before every command exists

Plain-language instruction files (`AGENTS.md`, `CLAUDE.md`, and similar)
degrade the same way any hand-maintained, unenforced document does: they
drift from what the repository actually requires, and nothing catches
the drift. A structured, validated contract makes a narrower set of
claims — "this command exists," "this path is protected," "this
verification step ran and passed" — checkable rather than merely
asserted. That value exists at `agent-ready validate` and
`agent-ready generate` alone; it does not require `init`, `doctor`, or a
hosted product to be worth adopting today.

## Why the CLI/package is the right next evolution

The contract format was the harder design problem and is now
reasonably stable (Phases 0–10, an ADR per consequential decision, a
stated pre-1.0 compatibility policy). The natural next problem is
adoption friction: today, adopting Agent-Ready means reading the spec
and hand-writing YAML. A more complete CLI (starter scaffolding,
environment diagnostics, plain-language explanations of a contract, a
`schema` introspection command) reduces that friction without changing
what the contract _means_ — which is why
[docs/implementation-scope-cli-package.md](implementation-scope-cli-package.md)
scopes new commands, not new contract semantics, as the next
increment.

## How the project should evolve responsibly

- Preserve the existing non-goals discipline
  ([ROADMAP.md](../ROADMAP.md#strict-non-goals-for-the-current-phase)):
  a new command is only in scope if it doesn't quietly reintroduce
  something already rejected (arbitrary command execution, hosted
  state, telemetry).
- Route schema changes through an ADR, per
  [GOVERNANCE.md](../GOVERNANCE.md#decision-making-process) — a new CLI
  command must not smuggle in a new required contract field without
  that process.
- Keep every new command safe by default: dry-run first, explicit flags
  for anything that writes or executes, and no silent overwrite of
  hand-authored content — the same discipline `generate --write` and
  `verify --execute --record` already established.

## What is intentionally out of scope (unchanged)

See [ROADMAP.md](../ROADMAP.md#strict-non-goals-for-the-current-phase)
for the full list. Nothing in this document changes that list; it
narrows in on one candidate revision — reconsidering `init` and adding
`doctor`/`explain`/`schema` — which is proposed direction, not a
decision, until it goes through the ADR process described above.
