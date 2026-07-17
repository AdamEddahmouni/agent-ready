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

## 2026-07-16 — Add framework-specific examples, close out v0.7.0

**Description:** Added the three framework-specific example repositories
v0.7.0 called for (`examples/python-fastapi/`, `examples/rust-cli/`,
`examples/go-service/`), wired them into CI, and fixed a real
`.prettierignore` gap that a pre-existing bug had been hiding.

**Files changed:**

- `examples/python-fastapi/` — `agent-ready.yaml`, `app/main.py`,
  `requirements.txt`, `README.md`, all 5 generated adapter files (new)
- `examples/rust-cli/` — `agent-ready.yaml`, `Cargo.toml`, `src/main.rs`,
  `README.md`, all 5 generated adapter files (new)
- `examples/go-service/` — `agent-ready.yaml`, `go.mod`, `main.go`,
  `main_test.go`, `README.md`, all 5 generated adapter files (new)
- `.github/workflows/ci.yml` — extended "valid examples pass" and "generate
  dry run" to cover all three; added "generate --check (framework examples,
  no drift)" and "doctor warns but does not fail on unprobed runtimes"
- `.prettierignore` — generated adapter output under `examples/*/` excluded,
  matching the existing `compatibility/adapter-output/**/expected/` precedent
- `ROADMAP-TO-1.0.md` — checked off the three examples, documented two
  deviations from the original sketch, updated the v0.7.0 exit criterion
- `CHANGELOG.md` — Unreleased entry

**Deviations from the roadmap's original sketch (both documented in
ROADMAP-TO-1.0.md, not silently substituted):**

- The Python example does not declare `environment.packageManager: pip`.
  `packageManager.name` is schema- and type-restricted to
  `"npm" | "pnpm" | "yarn"` — confirmed by reading the schema, `RawPackageManager`,
  and `doctor.ts`'s `SUPPORTED_PACKAGE_MANAGERS` before writing anything. Widening
  that enum is v0.8.0's ADR-0038 territory. `pip` is declared via
  `commands.install` instead, which needs no schema support.
- No new compatibility-corpus cases were added. `compatibility/adapter-output/v{1,2}/`
  is scoped to byte-exact rendering of specific schema-version field
  combinations, not full example repos, and none of these three examples
  exercises a field the existing corpus doesn't cover. The committed
  per-example adapter output is the golden fixture, matching how
  `examples/complete-phase-1/` already works, and CI's new `generate --check`
  step is what proves it hasn't drifted.

**Real bug found and worked around, not silently fixed:** `generate --check`
against `examples/complete-phase-1/` and `examples/adversarial-content/`
reports drift **today**, independent of anything in this session — their
committed adapter output does not match what `agent-ready generate --write`
produces fresh. Root cause: `src/generate/adapters/shared.ts`'s "Further
Context" section pushes `instructions.content` (a YAML block scalar, which
ends in a trailing newline) followed by its own blank-line separator,
producing a double blank line; Prettier collapses it to one, so the
currently-committed files are Prettier-clean by historical accident while a
fresh regeneration is not. This is why the freshly-generated output for the
three new examples in this session initially failed `format:check`. Rather
than hand-tune committed Markdown to satisfy Prettier (which `generate --check`
would then correctly flag as drift), generated adapter output under
`examples/` was excluded from Prettier's scope, matching how the compatibility
corpus's `expected/` fixtures are already excluded — correctness for these
files is "matches the generator," not "satisfies a style formatter." The
renderer bug itself, and `complete-phase-1`/`adversarial-content`'s existing
drift, are unfixed and flagged separately; fixing `shared.ts` touches
byte-exact output for every adapter project-wide and is out of scope for
"add framework examples."

**Commands run:**

- `pnpm format:check`, `pnpm check:action-pins`, `pnpm lint`, `pnpm typecheck`,
  `pnpm test`, `pnpm build` — all green (586 tests, unchanged from ADR-0037)
- Every new CI step run locally against the built CLI before being trusted:
  `validate`, `generate --json` (ADAPTER_NOT_YET_IMPLEMENTED absence),
  `generate --check`, `doctor --json` (warning present, exit 0) — all four
  examples, matching exactly what `ci.yml` now runs

**Status:** Complete. v0.7.0 exit criteria are now all met. `package.json`
intentionally left at `0.6.1` — that release is still unpublished (blocked on
PR #20's review), so this session does not claim a version it hasn't earned.

## 2026-07-16 — Fix shared.ts/escape.ts spacing bugs, resolve all example drift

**Description:** Fixed the two Markdown-formatting bugs flagged as a follow-up
in the previous session (LESSON-004), found a third closely-related bug while
verifying the fix, and regenerated every example and golden fixture in the
repository so `generate --write`'s raw output now already matches Prettier's
formatting everywhere, with no exclusions needed.

**Root causes fixed, both in the adapter renderer:**

- `src/generate/adapters/shared.ts`: every tight bullet/numbered list that
  followed a heading or lead-in paragraph was missing the blank-line
  separator Prettier requires between a block and a following list.
  Confirmed with a minimal Prettier probe before touching source
  (`### Heading\n- item` → Prettier inserts a blank line). This affected 12
  call sites, not just the two originally reported (Path Rules, Architecture
  Boundaries/Invariants/Key Decisions, Enforced Boundaries, Agent
  Constraints' three lists, instructions.sources, Before Submitting Work).
  Fixed once, at the root, with a new `pushList(lines, items)` helper that
  every list-rendering call site now goes through, rather than patching each
  site individually and risking missing one — which is exactly how the bug
  reached this size in the first place.
- `src/generate/adapters/shared.ts`: `instructions.content` (a YAML block
  scalar, always trailing-newline-terminated) plus the renderer's own
  blank-line push produced a double blank line before "See these files...".
  Fixed by trimming trailing line breaks before pushing.
- `src/generate/adapters/escape.ts` (found during verification, not in the
  original report): `escapeMarkdownText` collapses embedded newlines to
  spaces but didn't trim a _trailing_ one first, so any multi-line
  `description`/`summary`/similar field sourced from a YAML block scalar
  rendered with a trailing space Prettier would silently strip. Confirmed via
  `examples/adversarial-content`, whose `project.description` deliberately
  contains embedded newlines and a marker-lookalike string to test escaping.
  Same fix shape as the first: trim trailing line breaks before collapsing.

**Files changed:**

- `src/generate/adapters/shared.ts`, `src/generate/adapters/escape.ts` — the fixes
- `compatibility/adapter-output/{v1,v2}/cases/*/expected/*` — all 13 golden
  fixture files regenerated via the actual CLI (`generate --write` against a
  synthetic repo built from each case's manifest entry, output copied back),
  not hand-edited
- `tests/fixtures/generate/expected-*.txt` — all 10 golden fixtures, copied
  directly from the freshly-regenerated `examples/complete-phase-1/` and
  `examples/adversarial-content/` (same source contract + inputs, so
  byte-identical by construction; confirmed by the test passing)
- `examples/complete-phase-1/`, `examples/adversarial-content/`,
  `examples/{python-fastapi,rust-cli,go-service}/` — every adapter output
  file regenerated
- `.prettierignore` — removed the `examples/*/AGENTS.md` etc. exclusion added
  last session as a workaround; no longer needed, since raw generator output
  is now already Prettier-clean everywhere it was checked
- `.github/workflows/ci.yml` — widened "generate --check" from the three
  framework examples to all five examples (added `complete-phase-1` and
  `adversarial-content`, the two that were actually stale)

**Verification, in order:**

1. Confirmed each spacing rule with a standalone Prettier probe
   (`npx prettier <minimal .md snippet>`) before writing any fix, rather than
   trusting inference from the earlier diff.
2. `pnpm typecheck`, `pnpm lint` after each of the two source edits.
3. Regenerated the compatibility corpus (`tests/compatibility/adapterOutput.test.ts`,
   5 cases) after each fix; inspected the actual diffs to confirm only the
   intended blank-line insertions and trailing-space removal occurred, no
   unintended content changes.
4. Regenerated `tests/fixtures/generate/expected-*.txt`;
   `tests/integration/generateCli.test.ts` (13 tests) passes.
5. `generate --check` reports `"ok": true` for all five examples.
6. `pnpm format:check` passes repo-wide with the `.prettierignore` workaround
   removed — the stated goal (`generate --write` needs no post-hoc Prettier
   pass) is met, not just claimed.
7. Every new/changed CI command run locally against the built CLI, one at a
   time, before trusting the workflow file.
8. Full required pipeline: `pnpm format:check`, `pnpm check:action-pins`,
   `pnpm lint`, `pnpm typecheck`, `pnpm test` (586 tests), `pnpm build` — all
   green.

**Left alone, deliberately:** `compatibility/adapter-output/**/expected/` is
still excluded from `.prettierignore`. That entry predates this session and
wasn't part of what was asked; it happens to also now pass Prettier cleanly,
but removing it is a separate decision this session didn't make.

**Status:** Complete. LESSON-004's flagged bug and the additional trailing-space
bug it led to are both fixed at the root, not routed around. Not committed —
holding for explicit approval per the task's instruction.
