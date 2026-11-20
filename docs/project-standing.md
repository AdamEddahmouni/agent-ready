# Project standing

This document is the honest, current-state entry point for anyone asking
"what actually exists here today, and where is this going." It exists
because Agent-Ready's direction is easy to over- or under-state: the
project is neither a documentation-only proposal nor a finished product.

The [master work inventory](planning/MASTER-WORK-INVENTORY.md) separates active
acceptance criteria, conditional vNext phases, deferred historical proposals
and research hypotheses. It does not override accepted ADRs or research gates.

## What exists today (v0.6.1 published, plus the 0.7.0 source tree on main)

Agent-Ready already ships a real, installable-from-source CLI and
TypeScript package, not just a specification document:

- A canonical contract format, `agent-ready.yaml`, with a public,
  strict JSON Schema
  ([schemas/v1/agent-ready.schema.json](../schemas/v1/agent-ready.schema.json))
  and a full field reference
  ([docs/specification/contract-reference.md](specification/contract-reference.md)).
- A working CLI (`agent-ready`, package bin) with twelve real top-level
  commands: `validate`, `inspect`, `generate`, `check`, `analyze`, `schema`,
  `doctor`, `explain`, `init`, `upgrade`, `discover`, `verify` — plus the
  experimental `twin build` and `twin query` subcommands. See
  [docs/specification/cli-reference.md](specification/cli-reference.md)
  for exact behavior, flags, exit codes, and JSON output shapes.
- An experimental vNext discovery surface on `main` (the source tree declares
  `0.7.0`, while `0.6.1` is the last independently verified public release): Discovery Snapshot Format 1, a provenance-carrying repository
  graph, and `twin build`/`twin query` over a saved snapshot. See
  [ADR-0048](decisions/0048-discovery-snapshot-stability-and-conformance.md)
  and [ADR-0049](decisions/0049-snapshot-build-and-bounded-query.md).
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
  (`.github/workflows/ci.yml`), 49 Architecture Decision Records
  (`docs/decisions/`), a threat model, and a stated pre-1.0
  compatibility policy.
- Offline Phase 1 research tooling on `main` under
  `research/phase1-benchmark/`: the evaluation harness and the
  aggregate/adjudication/report/reproduce pipeline, exercised by
  `pnpm research:benchmark-test` in CI. It invokes no model and has run no
  benchmark.

None of this is aspirational. Run `agent-ready --help` after `pnpm
install && pnpm build` and every command above is real.

## What does not exist yet

- **No CI or API discovery in Discovery Snapshot Format 1.** Format 1 covers
  facts, the graph, commands, and verification; CI workflow and exported-API
  discovery are deferred by
  [ADR-0051](decisions/0051-defer-ci-api-discovery-from-format-1.md).
- **No Phase 1 full benchmark result.** Protocols v1 and v2 are frozen and the
  harness and reporting tooling are on `main`. Pilot runs and real captures
  exist under `runs/` and `research/phase1-benchmark/captures/`, but no official
  78-trial study or Phase 2 decision has been published. The pilot, full run,
  and publication are tracked in milestone
  [#1](https://github.com/AdamEddahmouni/agent-ready/milestone/1).
- **No v1.0 compatibility commitment.** At this review `0.6.1` is the stable npm package
  and Git tag, published with a GitHub-verified signed tag, while the project
  remains pre-1.0 under the documented compatibility policy.
  The composite GitHub Action remains build-from-source and does not depend on
  npm publication.
- **Structured handoff evidence is optional and local.** v0.6.0 validates
  `verify --execute --handoff <path>` and includes it with `--record`; it does
  not infer claims or verify their truth. See
  [docs/specification/evidence.md](specification/evidence.md).
- **No `quality_gates:` or `handoff:` schema blocks.** The v0.5
  `architecture:` and `agents:` blocks are implemented as declarative,
  generated guidance; they are not runtime enforcement. `quality_gates` and
  `handoff` remain non-normative ideas in
  [docs/specification/config-evolution-draft.md](specification/config-evolution-draft.md).
- **No community/plugin adapter mechanism.** The five adapters are a
  fixed, hardcoded registry (`generate/generate.ts`'s `RendererRegistry`)
  by design at this phase — see
  [docs/architecture/overview.md](architecture/overview.md#explicitly-absent-by-design-this-phase).
- **No hosted service of any kind.** Everything above runs locally. A
  possible future commercial product ("Agent-Ready Cloud" or similar)
  is discussed only as direction, not built — see
  [ROADMAP.md](../ROADMAP.md#long-term-commercial-direction-not-implemented).
- **No standalone documentation website.** Repository branding, diagrams, and
  a GitHub social preview exist today; the repository documentation remains
  the canonical public site for the preview line.

## Why a standard is useful even before every command exists

Plain-language instruction files (`AGENTS.md`, `CLAUDE.md`, and similar)
degrade the same way any hand-maintained, unenforced document does: they
drift from what the repository actually requires, and nothing catches
the drift. A structured, validated contract makes a narrower set of
claims — "this command exists," "this path is protected," "this
verification step ran and passed" — checkable rather than merely
asserted. That value exists at `agent-ready validate` and `agent-ready
generate` alone; it does not require every planned contract field, ecosystem
integration, or a hosted product to be worth adopting today.

## Why adoption and hardening are the next evolution

The contract format was the harder design problem and is now
reasonably stable (Phases 0–10, an ADR per consequential decision, a
stated pre-1.0 compatibility policy). The Path A adoption commands are now
complete: `schema`, `doctor`, `explain`, and `init` all ship. The v0.5 source
tree also includes safe contract upgrades, bounded YAML/source analysis, and
release automation. The remaining problem is proving the distribution and
onboarding path in public repositories: publish the preview package and
validate installation and CI use outside this repository. The release
sequence it planned is preserved as history in
[archive/roadmap-v1.md](archive/roadmap-v1.md), which is superseded
for planning by [VISION.md](../VISION.md).

## What the project is doing next

In September 2026 the project selected a **vNext design phase** and froze the
shipped line. The distinction is the single most important thing on this page,
because the vNext documents mix surfaces that now exist on `main` with
capabilities that remain design.

- The v1 contract, the eleven v1 commands, and the adapter-output corpus are
  **frozen and still releasing** as v0.6.x, per
  [ADR-0042](decisions/0042-v1-freeze-and-parallel-vnext-surface.md).
- The vNext direction — a control plane for constitutionally governed autonomous
  software evolution — is documented in [VISION.md](../VISION.md) and
  [RFC-0001](vnext/RFC-0001-autonomous-software-evolution.md), and is
  **partially implemented on `main`, unreleased in npm `0.6.1`**: `discover`,
  Discovery Snapshot Format 1, the provenance graph, and experimental
  `twin build`/`twin query`. The Phase 1 benchmark has not run. Evolution,
  transactions, proof, Constitution, capabilities, MCP, and hosted services are
  **not implemented**.
- vNext is written to be falsifiable. The conditions under which it should be
  abandoned are stated in advance, and the first phase is gated on a research
  question rather than a feature list.
- The trust posture is amended, not abandoned: the deterministic core keeps a
  permanent no-network, no-LLM, no-credentials rule, and networked integrations
  are quarantined behind per-capability design ADRs
  ([ADR-0043](decisions/0043-core-posture-and-integration-quarantine.md)).
- The threat surface this direction creates is enumerated in
  [threat-model-vnext.md](security/threat-model-vnext.md), where **none of the
  control-plane threats is mitigated today**, because the capabilities it treats
  do not exist. The local, read-only discovery and twin surfaces do not
  implement them.

The archived v0.7-to-v1.0 release plan is preserved at
[archive/roadmap-v1.md](archive/roadmap-v1.md). Its planned ADR-0037 through
ADR-0039 were never written and will not be.

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
  `verify --execute --record` established and `upgrade --write` extends with a
  validated, reviewable field-level diff.

## What is intentionally out of scope (unchanged)

See [ROADMAP.md](../ROADMAP.md#strict-non-goals-for-the-current-phase)
for the full list. Nothing in this document changes that list. Proposed
features remain non-normative until they follow the ADR and
specification-change process described above.
