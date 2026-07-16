# Work Log

Session history for the Agent-Ready repository.

---

## 2026-07-13 — Brain Integration Setup

**Description:** Integrated repository with the Agentic Development Brain. Created session protocol files, brain registration, and supporting scripts.

**Files changed:**

- `agent-ready.yaml` — Added instructions content, updated sources and context files
- `CLAUDE.md` — Created session protocol (new)
- `AGENTS.md` — Created session protocol (new)
- `docs/STATUS.md` — Created status snapshot (new)
- `docs/WORK_LOG.md` — Created work log (new)
- `docs/LESSONS.md` — Created lessons registry (new)
- `docs/SESSION_LOGS/` — Created directory (new)
- `.devbrain/project.yaml` — Created brain registration (new)
- `scripts/register-project.mjs` — Created (new)
- `scripts/refresh-graph.mjs` — Created (new)
- `scripts/check-graph-freshness.mjs` — Created (new)
- `scripts/project-context-preview.mjs` — Created (new)
- `scripts/record-session-summary.mjs` — Created (new)
- `scripts/validate-repo-memory.mjs` — Created (new)

**Commands run:**

- `agent-ready validate` — validated contract
- `pnpm format:check` — format check
- `pnpm check:action-pins` — action pin check
- `pnpm lint` — lint
- `pnpm typecheck` — type check
- `pnpm test` — tests
- `pnpm build` — build

**Status:** All verification commands passed. Integration complete.

## 2026-07-13 — Brain integration setup

**Files changed:**

- `.devbrain/project.yaml`
- `.devbrain/.gitkeep`
- `agent-ready.yaml`
- `CLAUDE.md`
- `AGENTS.md`
- `docs/STATUS.md`
- `docs/WORK_LOG.md`
- `docs/LESSONS.md`
- `eslint.config.js`
- `scripts/register-project.mjs`
- `scripts/refresh-graph.mjs`
- `scripts/check-graph-freshness.mjs`
- `scripts/project-context-preview.mjs`
- `scripts/record-session-summary.mjs`
- `scripts/validate-repo-memory.mjs`

**Commands run:**

- `agent-ready validate`
- `pnpm format:check`
- `pnpm check:action-pins`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`

**Status:** Completed.

## 2026-07-16 — ADR-0037 and v0.7.0 roadmap reconciliation

**Description:** Opened Milestone 3 (v0.7.0) by writing ADR-0037 for
architecture-dependency drift analysis, and reconciled two conflicts found
between ROADMAP-TO-1.0.md and the repository's actual state. No implementation
yet — ADR only, per guiding principle #1.

**Files changed:**

- `docs/decisions/0037-architecture-dependency-analysis.md` — Created (new)
- `docs/decisions/README.md` — Indexed ADR-0037
- `ROADMAP-TO-1.0.md` — Rewrote the v0.7.0 boundary-analysis section and exit
  criteria around `architecture.boundary_rules`; renumbered the v0.9.0/v1.0.0
  ADR identifiers (0040–0045 → 0041–0046) around the already-accepted ADR-0040
- `docs/WORK_LOG.md` — This entry
- `docs/LESSONS.md` — LESSON-002

**Decisions:**

- `architecture.boundaries` (v0.5.0, free-form prose) is **not** parsed. A new
  additive `architecture.boundary_rules` field carries structured, machine-checked
  rules. The roadmap's original plan to validate `boundaries` syntax at
  contract-load time would have retyped a shipped field, breaking ADR-0009.
- v0.7.0 is bounded to repository-relative import checking. Bare module
  specifiers and inverse "only X may import Y" rules are reconsideration
  triggers, not deliverables.

**Commands run:**

- `node scripts/check-graph-freshness.mjs` — reported stale (83.9h)
- `node scripts/refresh-graph.mjs` — Graphify CLI absent; wrote placeholder only
- `pnpm format:check` — surfaced pre-existing failures (see below)
- `npx prettier --write ROADMAP-TO-1.0.md docs/decisions/README.md docs/decisions/0037-*.md`

**Status:** ADR accepted; implementation pending. `pnpm format:check` does not
pass repo-wide because untracked `graphify-out/` and `docs/WORK_LOG.md` fail it —
pre-existing, not introduced by this session. The three files changed here all
pass Prettier.

## 2026-07-16 — Implement ADR-0037 (`analyze --architecture`)

**Description:** Implemented the first v0.7.0 deliverable: the
`architecture.boundary_rules` contract field and the opt-in
`agent-ready analyze --architecture` import-graph check.

**Files changed:**

- `schemas/v1/agent-ready.schema.json` — `architecture.boundary_rules`
- `src/contract/types.ts` — raw and normalized boundary-rule types
- `src/contract/normalize.ts` — normalizes rule path forms, preserves order
- `src/contract/semantic.ts` — rule validation (duplicate origin, duplicate
  target, self-forbidding rule, path form)
- `src/contract/paths.ts` — `isPathWithin`, shared segment-aware prefix match
- `src/filesystem/types.ts` — `DirectoryEntry`, `FileSystem.readDirectory`
- `src/filesystem/nodeFileSystem.ts`, `src/filesystem/inMemoryFileSystem.ts` —
  `readDirectory` implementations
- `src/analyze/importSpecifiers.ts` — bounded import scanner (new)
- `src/analyze/analyzeArchitecture.ts` — boundary checking (new)
- `src/cli/commands/analyze.ts`, `src/cli/index.ts` — `--architecture` flag
- `src/diagnostics/codes.ts`, `src/cli/commands/explainRegistry.ts` — 3 codes
- `src/generate/adapters/shared.ts` — "Enforced Boundaries" rendering
- `agent-ready.yaml` — dogfooded rules for both real boundaries
- `docs/decisions/0037-*.md` — amended for the FileSystem change; status
  updated to implemented
- `docs/architecture/overview.md`, `docs/specification/{contract-reference,cli-reference,diagnostics}.md`,
  `CHANGELOG.md` — documentation
- Tests: `tests/unit/{importSpecifiers,analyzeArchitecture,filesystem,semantic,normalize}.test.ts`,
  `tests/integration/analyzeCli.test.ts` (+29 tests, 557 → 586)

**Decisions made during implementation:**

- The ADR missed that `FileSystem` cannot enumerate directories. Rather than
  break the rule that only `nodeFileSystem.ts` performs real I/O, the interface
  gained a read-only `readDirectory`. The ADR was amended before the code
  landed rather than retrofitted after. This widens a public API export, so
  ADR-0041's 1.0 freeze must categorize it.
- Exclusions use the existing `globMatch` matcher, not prefix matching:
  `paths.ignored`/`paths.generated` hold globs (`dist/**`), which no prefix
  comparison would match.
- A malformed `from` no longer hides that rule's `must_not_import` errors; every
  problem in a rule is reported in one pass. Caught by a test written against
  the ADR, not against the implementation.

**Commands run:**

- `pnpm format:check`, `pnpm check:action-pins`, `pnpm lint`, `pnpm typecheck`,
  `pnpm test`, `pnpm build` — all green
- `node dist/cli/index.js analyze --architecture` — dogfooded: 2 rules,
  16 files, 58 imports, zero violations
- Detection verified against a deliberately-true rule
  (`src/contract` must not import `src/diagnostics`), which correctly reported
  every crossing import with file, line, and column

**Status:** Complete. 586 tests pass. v0.7.0's first exit criterion is met; the
framework-specific examples (Python/Rust/Go) remain.
