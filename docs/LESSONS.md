# Verified Lessons

Reusable findings, patterns, and pitfalls discovered during development of
Agent-Ready. Each entry is a candidate for brain memory curation.

## Index

| Date       | ID         | Title                                                    | Status    |
| ---------- | ---------- | -------------------------------------------------------- | --------- |
| 2026-07-13 | LESSON-001 | Brain integration follows startup/completion protocol    | candidate |
| 2026-07-16 | LESSON-002 | A roadmap written before a field ships can contradict it | candidate |
| 2026-07-16 | LESSON-003 | An ADR is a hypothesis until the boundary is checked     | candidate |
| 2026-07-16 | LESSON-004 | Committed generated output can be stale and pass anyway  | candidate |
| 2026-07-16 | LESSON-005 | A reported bug is a sample, not the full defect          | candidate |

---

## LESSON-001 — Brain integration follows startup/completion protocol

**Date:** 2026-07-13
**Status:** candidate

**Finding:** When integrating a repository with the Agentic Development Brain,
the CLAUDE.md and AGENTS.md files should contain the startup and completion
protocols without duplicating the full knowledge base. The knowledge base
(commands, paths, restrictions, architecture) lives in `agent-ready.yaml`.
The protocol files reference the knowledge base — they don't replicate it.

**Applied in:** `CLAUDE.md`, `AGENTS.md`

**Verification:** The protocol files are under 100 lines each and delegate
all factual claims (commands, paths, schema shape) to `agent-ready.yaml` and
the files it references.

---

## LESSON-002 — A roadmap written before a field ships can contradict it

**Date:** 2026-07-16
**Status:** candidate

**Finding:** ROADMAP-TO-1.0.md planned v0.7.0's import-graph analysis against
`architecture.boundaries` before v0.5.0 had shipped that field. When it shipped
(ADR-0032) it was free-form 1–500-character prose. The roadmap still assumed a
parseable `from → to` syntax "validated at contract-load time," which would have
retyped a shipped field and broken both ADR-0009 and the roadmap's own
additive-only guiding principle. The roadmap's dogfooding exit criterion was
likewise unmeetable: it required zero false positives against this repository's
own `boundaries`, which are concepts ("CLI presentation modules"), not paths.

The mismatch was invisible from the roadmap alone. It only surfaced by reading
the shipped schema (`$defs.architectureGuidanceList`) and the repo's own
contract next to the plan.

**How to apply:** When a roadmap milestone builds on a field from an earlier
milestone, re-read the field's shipped schema and the ADR that landed it before
trusting the roadmap's description of it. Prefer the earlier ADR's
reconsideration trigger over the roadmap's forward guess — ADR-0032's trigger
had already called for "a separately structured, machine-readable boundary form
rather than overloading human guidance strings," which is exactly what ADR-0037
adopted, and it predated the roadmap text that contradicted it.

**Corollary:** ADR numbers reserved by a roadmap are not reserved in reality.
ADR-0040 was accepted out of sequence (release/version taxonomy) while the
roadmap's table still assigned 0040 to the 1.0 public API freeze. Allocate an
ADR number from `docs/decisions/`, never from a plan document.

**Applied in:** `docs/decisions/0037-architecture-dependency-analysis.md`,
`ROADMAP-TO-1.0.md`

**Verification:** ADR-0037 keeps `boundaries` untouched and adds
`boundary_rules` as an additive sibling; both of this repository's prose
boundaries are expressible as structured rules, making the v0.7.0 exit
criterion meetable.

---

## LESSON-003 — An ADR is a hypothesis until the boundary is checked

**Date:** 2026-07-16
**Status:** candidate

**Finding:** ADR-0037 was written against the contract and the roadmap, and it
specified a directory-scoped rule (`from: src/contract`) without checking
whether the `FileSystem` interface could enumerate a directory. It cannot — the
interface exposes `cwd`, `readTextFile`, `stat`, `realPath`, and
`writeTextFile`, and nothing else, by design. The gap only surfaced when
implementation started, and it forced a real decision (widen a deliberately
narrow, publicly exported boundary) that the ADR had silently assumed away.

A second instance of the same shape: the ADR said analysis would exclude
`paths.ignored` and `paths.generated`, which sound like prefixes but are globs
(`dist/**`). Prefix comparison would have silently excluded nothing.

**How to apply:** Before an ADR is accepted, check every interface it implies a
call against, not just the contract fields it adds. Ask "what does this need
from the boundaries it does not own?" — file system, git, process, matcher. In
this repository the narrow interfaces in `filesystem/`, `git/`, and `verify/`
are the ones most likely to lack what a new feature assumes.

**Corollary:** Amend the ADR when the gap is found, before the code lands.
ADR-0037 was still unmerged, so the FileSystem change went into its Decision and
Consequences sections rather than being discovered later as undocumented drift.
An ADR that describes what was built is worth more than one that describes what
was planned.

**Also verified:** A clean analysis run proves nothing on its own. `analyze
--architecture` reported zero violations on this repository's real rules, which
is indistinguishable from a scanner that scans nothing. Detection was confirmed
separately by declaring a rule known to be violated (`src/contract` must not
import `src/diagnostics`) and checking that every crossing import was reported
with file, line, and column. This is the same reasoning that motivates
`ARCHITECTURE_ANALYSIS_SCAN_FAILED` existing at all.

**Applied in:** `docs/decisions/0037-architecture-dependency-analysis.md`,
`src/filesystem/types.ts`, `src/analyze/analyzeArchitecture.ts`

**Verification:** 586 tests pass; `pnpm format:check`, `lint`, `typecheck`, and
`build` are green; the CLI dogfoods its own two boundaries with zero findings
and correctly reports a deliberately introduced violation.

---

## LESSON-004 — Committed generated output can be stale and pass anyway

**Date:** 2026-07-16
**Status:** candidate

**Finding:** `examples/complete-phase-1/` and `examples/adversarial-content/`
have committed `AGENTS.md`/`CLAUDE.md`/etc. that do not match what
`agent-ready generate --write` produces today — confirmed with
`generate --check`, which reported `"would-write"` for 4-5 of 5 adapters in
each. Nothing in CI catches this: the existing "generate dry run" step only
checks for `ADAPTER_NOT_YET_IMPLEMENTED`, never diffs content. The drift was
invisible because the stale committed files happened to already satisfy
Prettier, so `format:check` gave no signal either — two different checks, each
blind to the exact thing the other would have caught.

Root cause: `shared.ts`'s "Further Context" section pushes
`instructions.content` (a YAML block scalar, trailing-newline-terminated) and
then its own blank-line separator, so any contract combining `instructions.content`
with `instructions.sources` renders a double blank line that Prettier
collapses to one on the next format pass — but `generate --write` never runs
Prettier, so regenerating reintroduces the double blank line every time.

**How to apply:** A file being "clean" under one tool (Prettier) says nothing
about whether it still matches its own generator. When a repository has both
a formatter and a generator writing to the same files, verify both
independently — `format:check` and `generate --check` are not substitutes for
each other. This project's own `verify --execute --check-generate`
(ADR-0036) exists for exactly this reason at the contract-consumer level; it
just isn't yet applied to the example repositories that ship inside this one.

**Corollary:** When a generator's raw output conflicts with the formatter's
opinion, don't hand-edit the generated file to satisfy the formatter — that
edit is exactly the drift `generate --check` exists to catch, and it will
flag your own fix as staleness on the next run. Either fix the generator, or
exclude generated output from the formatter's scope (as this repository
already does for `compatibility/adapter-output/**/expected/`) and let the
generator alone govern correctness.

**Applied in:** `.prettierignore` (generated example output excluded);
`src/generate/adapters/shared.ts`'s bug and `complete-phase-1`'s/
`adversarial-content`'s existing drift were found but deliberately left
unfixed — flagged separately, since a renderer change affects byte-exact
output for every adapter project-wide.

**Verification:** All three new framework examples pass both `format:check`
and `generate --check` simultaneously; confirmed by running each locally
before trusting the CI wiring that exercises the same commands.

**Resolution (2026-07-16, follow-up session):** The renderer bug is fixed at
the root — see LESSON-005. The `.prettierignore` workaround is removed; raw
`generate --write` output now already matches Prettier everywhere, and every
example's committed output was regenerated and confirmed drift-free by both
checks independently.

---

## LESSON-005 — A reported bug is a sample, not the full defect

**Date:** 2026-07-16
**Status:** candidate

**Finding:** The follow-up task named two specific spacing bugs in
`shared.ts`'s `renderContractSections`: a double blank line before "See these
files..." and a missing blank line before the `paths.protected` bullet list.
Auditing every list-rendering call site in the function (12 total) found the
missing-blank-line pattern in 10 more places — Architecture
Boundaries/Invariants/Key Decisions, Enforced Boundaries, all three Agent
Constraints lists, `instructions.sources`, and Before Submitting Work — not
just the one named. Verifying the fix then surfaced a _third_, structurally
identical bug in a different file (`escape.ts`'s `escapeMarkdownText` leaving
a trailing space from a YAML block scalar's trailing newline), found only
because `examples/adversarial-content` — the one example whose contract
happens to declare a multi-line `description` — was still non-Prettier-clean
after the first two fixes were applied and regenerated.

**How to apply:** When a bug report names one or two instances of a pattern
inside a function with many structurally similar call sites, grep or read the
whole function for the same shape before fixing only what was named. Two
named instances of "paragraph directly followed by a list, no blank line" was
a strong signal that every other list in the same file had the same
construction. Fixing all of them with one shared helper (`pushList`) also
prevents the next contributor from reintroducing instance #13.

**Corollary:** Verify a fix's completeness against reality, not against the
reported symptom. "Both spacing issues are fixed" was falsifiable —
regenerating every example and running `pnpm format:check` with the
`.prettierignore` workaround removed is what actually proved it, and it took
finding a third bug to make that true. A minimal, standalone reproduction
(`npx prettier <snippet>`) confirmed each spacing rule _before_ writing the
fix, rather than trusting the pattern inferred from a single diff — this is
what caught that a heading-then-list also needs a blank line, a case the
original diff hadn't shown.

**Applied in:** `src/generate/adapters/shared.ts` (`pushList` helper, 12 call
sites), `src/generate/adapters/escape.ts` (`escapeMarkdownText` trailing-newline
trim)

**Verification:** All five examples' generated output, all 13 compatibility-corpus
golden fixtures, and all 10 `tests/fixtures/generate/expected-*.txt` fixtures
regenerated via the actual CLI (never hand-edited) and diffed to confirm only
the intended blank-line/trailing-space changes occurred. `pnpm format:check`
passes repo-wide with no generated-output exclusion in `.prettierignore`.
