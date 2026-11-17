# vNext branch reconciliation review

**Review date:** 2026-11-16
**Base:** `main` at `4fe524a` (`docs: strengthen open-source readiness and impact evidence`)
**Reviewed branches:** `docs/vnext-phase-0`, `feat/vnext-discovery`,
`feat/vnext-package-workspace-discovery`, `feat/vnext-command-verification-discovery`,
`feat/vnext-provenance-graph`, `feat/vnext-snapshot-conformance`,
`agent/brain-integration-and-adr-0037`

This is a reconciliation record, not a specification. It states what was measured,
what that changes about the integration order, and what must be true before any of
the vNext branches is merged. It introduces no product surface.

## 1. Bottom line

1. The vNext work is real and larger than a documentation phase: the branch tip
   adds **176 files and 40,175 lines across 29 commits**, including a discovery
   engine, a versioned snapshot schema, a conformance corpus, a `twin` query
   command, and ADR-0041 through ADR-0049.
2. **The branch tip cannot be merged as it stands.** On Node 26.13.0 with the
   committed lockfile, `pnpm build` fails, `pnpm typecheck` reports three errors,
   five tests fail in three files, and the repository's own composite-action drift
   guard rejects the new `twin` command. The branch is a research snapshot, not a
   release candidate.
3. **Two incompatible roadmaps exist as branches.** The vNext chain implements
   ADR-0041–0049; `agent/brain-integration-and-adr-0037` implements the superseded
   pre-vNext plan (ADR-0037 architecture-dependency analysis, ADR-0038
   multi-language runtime probing, ADR-0039 external adapter registration, v0.7
   framework examples). Both cannot land; `discover` supersedes most of the first
   one.
4. The documentation-truth item (issue #43) is independent of vNext and is fixed
   on `main` in this change, with a regression test that runs the analyzer over
   the whole hand-written documentation surface.
5. The Phase 1 benchmark protocol has one arithmetic contradiction and one
   evaluator/field-name mismatch that should be corrected before any run, plus a
   task set that measures retrieval far more than it measures change quality.

## 2. Measured state

|                             | `main` @ `4fe524a` (+ this review)      | `feat/vnext-snapshot-conformance` @ `88a0686`        |
| --------------------------- | --------------------------------------- | ---------------------------------------------------- |
| Commits ahead of `main`     | —                                       | 29                                                   |
| Files changed               | —                                       | 176 (+40,175 / −134)                                 |
| `pnpm build`                | passes                                  | **fails** (`src/twin/queryEngine.ts(111,67)` TS2322) |
| `pnpm typecheck`            | passes                                  | **fails** (3 errors)                                 |
| `pnpm test`                 | 562 passed / 42 files                   | **978 passed, 5 failed, 3 skipped** / 56 files       |
| Test count stated in README | 557 / 41 (stale, corrected to 562 / 42) | 668 / 45 (stale; measured 986 / 56)                  |
| ADRs added                  | —                                       | 0041–0049                                            |

Branch chain, verified with `git rev-list --count 4fe524a..origin/<branch>`:

| Branch                                      | Commits | Files | Insertions |
| ------------------------------------------- | ------- | ----- | ---------- |
| `docs/vnext-phase-0`                        | 6       | 18    | 4,807      |
| `feat/vnext-discovery`                      | 9       | 44    | 9,459      |
| `feat/vnext-package-workspace-discovery`    | 14      | 65    | 16,574     |
| `feat/vnext-command-verification-discovery` | 18      | 71    | 20,506     |
| `feat/vnext-provenance-graph`               | 23      | 83    | 29,128     |
| `feat/vnext-snapshot-conformance`           | 29      | 176   | 40,175     |
| `agent/brain-integration-and-adr-0037`      | 8       | 112   | 6,349      |

Each feature branch is a superset of the previous one, so the chain is a single
stacked line of work, not six independent changes.

## 3. Gate failures on the branch tip

Measured after `pnpm install --frozen-lockfile` in a detached worktree of
`88a0686`. Node 26.13.0, TypeScript 5.9.3.

**Build (blocks publishing the package):**

```
src/twin/queryEngine.ts(111,67): error TS2322: Type 'unknown[]' is not assignable to type 'JsonValue'.
```

**Type check (blocks the repository's own `verification.required` gate):**

- `tests/integration/discoveryConformance.test.ts(287,21)`: `Property 'facts' does not exist` on the parsed snapshot type.
- `tests/research/phase1BenchmarkProtocol.test.ts(4,34)`: TS7016, no declaration file for the `.mjs` evaluator module.

**Tests (5 failed of 986):**

| Test                                                                           | Failure                                                          |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `discoveryConformance` — known-inaccurate fixture is byte-identical            | expects `module:dist/helper.js`, produced `module:src/helper.js` |
| `discoveryConformance` — CLI run over a real directory                         | same fixture drift at `.graph.nodes`                             |
| `discoveryConformance` — update path is deterministic                          | same fixture drift on the second write                           |
| `discoverSnapshotSchema` — rejects a conflicted fact carrying a selected value | validator accepts a state the schema test calls impossible       |
| `actionSubcommands` — every wired subcommand is listed in `action.yml`         | `twin` is wired in the CLI but missing from the composite action |

The first three are one defect: the committed `known-inaccurate-fallback-source-universe`
fixture records a source universe that includes `dist/`, while the implementation now
withholds build output. Either the fixture must be regenerated with the branch's own
`scripts/regenerate-discover-fixture.ts` or the behavior change must be documented as a
second known-inaccurate case. Regenerating a "known-inaccurate" fixture without recording
why it is inaccurate would defeat its purpose.

The `actionSubcommands` failure is the repository's drift guard doing its job: a new
command shipped without the composite action, CI-integration documentation, and CLI
reference being updated in the same change.

## 4. What the branch has already settled — do not redo it on `main`

- README repositioning around the vNext direction (`d724710`).
- `ROADMAP-TO-1.0.md` archived to `docs/archive/roadmap-v1.md`, with a supersession
  table and an explicit "archived, not deleted" policy (`3ba76f1`, `83c719c`).
- ROADMAP.md converted to shipped-phase history (`d724710`).
- ADR-0041 (vNext direction), ADR-0042 (v1 freeze and parallel surface), ADR-0043
  (offline core posture and integration quarantine).
- VISION.md, RFC-0001, LANDSCAPE.md, the vNext threat model, and the Phase 1 issue set.

On `main` these files still describe the pre-vNext project. That divergence should be
resolved by merging the branch's documentation commits, **not** by re-writing the same
files on `main`: duplicate edits to `README.md` and `ROADMAP.md` would guarantee merge
conflicts in the very first integration step.

Issue #43 is also already filed on the branch as
`.freebuff/issues/08-historical-adr-links.md`, with an explicit scope that excludes
generated adapter output and the pull-request template. That scope is correct and was
followed here.

## 5. The second roadmap branch

`agent/brain-integration-and-adr-0037` predates and contradicts the vNext direction:

- ADR-0037 architecture-dependency analysis — overlaps `discover`'s module graph.
- ADR-0038 multi-language runtime probing in `doctor` — additive, still plausible.
- ADR-0039 external adapter registration — the same direction as PR #29.
- v0.7 framework-specific examples, plus `docs/LESSONS.md` and `docs/WORK_LOG.md`.

This also explains the ADR numbering gap on `main` (0036 → 0040): 0037–0039 are claimed
by that branch, and the vNext chain deliberately starts at 0041. The next new ADR on
`main` must therefore be **0050**, and the gap must not be back-filled.

Recommendation: decide explicitly between (a) retire that branch and keep 0037–0039
reserved, or (b) salvage ADR-0038 and the examples, and drop ADR-0037/0039 as
superseded by `discover` and the adapter work. Do not merge both roadmaps.

## 6. Benchmark protocol review (verified against the files)

| #   | Finding                                             | Evidence                                                                                                                                                                                        | Correction                                                                                                                            |
| --- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Run count contradicts itself                        | `PROTOCOL.md`: "3 runs per task per condition (90 raw + 90 agent-ready trials at full scale)"; `manifest.json`: `runsPerTaskPerCondition: 3` over 10 tasks = 30 per condition, 60 total         | State 30 per condition / 60 total, or raise the task count; `90` requires 30 tasks                                                    |
| 2   | Primary gate field name contradicts its evaluator   | `decision-rule.json` uses `maxAllowedRelativeDrop: 0.05` described as "5 percentage points"; `evaluate-decision.mjs` compares `arSuccess >= rawSuccess - 0.05`, i.e. absolute percentage points | Rename to `maxAllowedAbsoluteDrop`, or change the comparison to a relative one. Do not leave the name and the description disagreeing |
| 3   | Safety gates are relative, primary is absolute      | `ar <= raw * (1 + maxAllowedRelativeIncrease)` in `evaluate-decision.mjs`                                                                                                                       | Say so in `PROTOCOL.md`; a 10% relative increase at a 10% baseline is one point                                                       |
| 4   | The only write task has a gameable oracle           | `axios-02-add-devdep` uses `file-contains` for `"semver": "^7.6.0"` anywhere in `package.json`; `forbidden` is never scored                                                                     | Use a JSON-path oracle that asserts the key under `dependencies` and the absence of unrelated edits                                   |
| 5   | The task set measures retrieval, not change quality | 9 of 10 tasks are read-only information retrieval; only one edits a file, on one repository                                                                                                     | Add edit-and-verify tasks across at least three repositories before claiming a software-engineering benefit                           |
| 6   | No test enforces the protocol's own invariants      | `phase1BenchmarkProtocol.test.ts` asserts `tasks.length >= 8` and repository-id validity only                                                                                                   | Add an invariant test: tasks × runs per condition equals the documented trial count                                                   |

The protocol has not been run, so it can still be corrected in place under its own
immutability rule ("frozen after the first evaluation run"). Once corrected, freeze it
and run the benchmark before building anything on top of the snapshot.

## 7. Integration sequence

**Slice 0 — branch hygiene (on the vNext branch, before anything is merged).**
Fix the build error, the two type-check errors, the stale conformance fixture, and the
`twin`/action.yml drift; correct the README test counts; add a CI job that runs
`research:benchmark-validate-protocol`. Exit: `build`, `typecheck`, `test`, `lint`,
`format:check` green on Ubuntu, Windows, and macOS for the tip commit.

**Slice 1 — documentation reconciliation.** Merge `docs/vnext-phase-0` (6 commits, no
`src/` changes). Gate: the documentation-link test added on `main` stays green after
the README/ROADMAP rewrite. Do not edit the same files independently on `main` first.

**Slice 2 — decision on 0037–0039 and PR #29.** Record the retirement or salvage
decision in an ADR before the graph work lands, so the repository does not carry two
answers to "how does Agent-Ready understand architecture?".

**Slice 3 — discovery substrate.** Merge the #36–#40 work as five reviewed increments
(or fewer, if the stacked branches squash cleanly), each keeping the phase-0 exit
criteria: offline, no contract required, byte-identical output on unchanged input,
and provenance for every fact. The filesystem-interface changes
(`src/filesystem/types.ts`, `nodeFileSystem.ts`, `inMemoryFileSystem.ts`) touch a
surface ADR-0042 calls frozen — verify no public type leaked into `dist/index`.

**Slice 4 — snapshot and twin.** Only after the conformance corpus is green. `twin
build`/`twin query` must appear in `action.yml`, `docs/specification/cli-reference.md`,
and `docs/specification/ci-integration.md` in the same change.

**Slice 5 — benchmark repair and execution.** Apply section 6, freeze, run, publish raw
data. A negative result is a legitimate stopping point and should be reported as one.

**Slice 6 — native instruction auditing (the plan's Stage 2).** Not represented on any
branch. This is new work and should not be smuggled into the discovery integration.

## 8. Runtime policy

`main` declares Node `>=20.0.0`, pins `.nvmrc` to `20`, and tests 20/22. Node 20 reached
end of life in March 2026. The full pipeline was re-run for this review on **Node
26.13.0**: install, typecheck, 562 tests, and build all pass, so 26 is currently
compatible. This change therefore broadens CI to 20/22/24/26 without dropping support.

Dropping 20 is a support-policy change and should land as an explicit minor-release
decision (engines `>=22`, `.nvmrc` `22`, README requirement, and the contract example's
`environment.runtimes.node`), not as a patch-release side effect.

## 9. Residual risks

- **Fixture regeneration.** Three of the five branch test failures are fixture drift, so
  the corpus needs a documented regeneration workflow and a rule that regeneration is a
  reviewed change, never a `--update` reflex.
- **Committed planning files.** `.freebuff/issues/*.md` and `scripts/commit-phase1-work.ps1`
  couple the repository to one agent tool and to PowerShell; the latter cannot run in
  the existing Ubuntu CI. Consider moving planning records to `docs/vnext/`.
- **Research code in the package surface.** `research/phase1-benchmark/*.mjs` is correct
  to keep out of `files[]`; confirm it also stays out of the published `dist` and of
  `action.yml`'s build inputs.
- **Stale counts.** Both READMEs state test counts that no longer match reality. Counts
  in prose drift by construction; consider dropping the number and keeping "the full
  suite" plus a CI badge.

## 10. Commands run for this review

```
git ls-remote --heads origin
git rev-list --count 4fe524a..origin/<branch>   # for each branch
git diff --stat 4fe524a...origin/feat/vnext-snapshot-conformance
pnpm install --frozen-lockfile                  # main and branch worktree
pnpm build / pnpm typecheck / pnpm test / pnpm lint   # main
pnpm build / pnpm typecheck / pnpm test               # branch worktree
```

Not run: the Phase 1 benchmark, the Windows and macOS CI jobs, a published-package
smoke test on the branch, and any execution of `agent-ready discover` against the
external corpus (the corpus study's pinned checkouts are not present here).
